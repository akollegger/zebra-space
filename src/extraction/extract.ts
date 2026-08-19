import { Effect } from "effect"
import { requestStructuredCompletion } from "./provider.ts"
import {
  CriticRejected,
  ExtractedCsp,
  extractedCspJsonSchema,
  type ExtractionAttempt,
  type ExtractionError,
  FidelityCritique,
  fidelityCritiqueJsonSchema,
  type ProviderError,
  type SchemaRejected,
  type SchemaViolation,
} from "./types.ts"

// ADR-004 §2.5 defaults — overridable via ExtractOptions (ADR-003 §2.6's --model/--frontier-model
// and ZEBRA_MODEL/ZEBRA_FRONTIER_MODEL, resolved by the CLI layer before calling extract()).
// Cheap tier was google/gemini-2.5-flash-lite; switched after live measurement showed it failing
// 2 of 4 identical requests (one timeout, one 18.9s) against gpt-4o-mini's 4/4 at ~1.5s — see
// ADR-004 §2.5's Consequences for the full comparison and why this stays a cross-vendor pair.
const DEFAULT_MODEL = "openai/gpt-4o-mini"
const DEFAULT_FRONTIER_MODEL = "anthropic/claude-sonnet-4.5"

// ADR-004 §2.4: up to 2 informed revisions per tier — 3 total attempts per tier (1 initial + 2
// revisions) before escalating.
const MAX_REVISIONS_PER_TIER = 2

export interface ExtractOptions {
  readonly model?: string | undefined
  readonly frontierModel?: string | undefined
}

export interface ExtractionResult {
  readonly extractedCsp: ExtractedCsp
  readonly model: string
}

interface RevisionContext {
  readonly extractedCsp: ExtractedCsp
  readonly issues: readonly string[]
}

interface TierOutcome {
  readonly attempts: readonly ExtractionAttempt[]
  readonly accepted?: { readonly extractedCsp: ExtractedCsp }
}

function extractionSystemPrompt(): string {
  return (
    "You are extracting a constraint-satisfaction-problem representation from a " +
    "natural-language logic puzzle. Produce the entities, decision-variable domains, and " +
    "constraints exactly as described by the prose — represent every clue, invent nothing, " +
    "and never guess at a clue you can't confidently translate.\n\n" +
    "Three easily-confused clue shapes need different constraint kinds — pick by what the " +
    "clue actually asserts, not by superficial similarity:\n" +
    '- Exclusion/negation ("The culprit is not Colonel Mustard", "not the Revolver"): use ' +
    '`arithmetic` with comparator "!=" against the excluded value. This is NOT ' +
    "`linkedAttributes` — the clue rules one value out, it does not link two values together.\n" +
    '- Attribute co-occurrence with NO entity ever named ("The Englishman lives in the red ' +
    'house"): use `linkedAttributes` — it links two-or-more attribute values on some ' +
    "unspecified entity. Do not use this for exclusion/negation clues, and do not use it to " +
    "represent an entity ruling out a value.\n" +
    '- A specific, already-known entity ("the first house", or one named directly): use ' +
    "`assignment`.\n\n" +
    "A clue comparing two computed quantities, or one entity's value against another's " +
    '("the sum of these three cells equals the sum of those three", "Drug B is at least 4 ' +
    'hours after Drug A", "the color of house A differs from house B\'s"): use `arithmetic` ' +
    "with a structured `target` (an `ArithmeticExpression`, not just a plain value). Never " +
    'invent a compound variable name like "houseA.color" or "time(DrugB)" to smuggle an ' +
    "entity reference into a plain string — `variableRef` has its own `variable` (the domain " +
    "name) and `entity` (null for a scalar domain, or the specific entity id) fields for " +
    "exactly this."
  )
}

function extractionUserPrompt(prose: string): string {
  return `Puzzle:\n\n${prose}`
}

function revisionUserPrompt(prose: string, context: RevisionContext): string {
  const issueList = context.issues.map((issue) => `- ${issue}`).join("\n")
  return (
    `Puzzle:\n\n${prose}\n\n` +
    `Your previous extraction was:\n${JSON.stringify(context.extractedCsp)}\n\n` +
    `A critic rejected it for these reasons:\n${issueList}\n\n` +
    "Produce a corrected extraction that addresses every reason above."
  )
}

function critiqueSystemPrompt(): string {
  return (
    "You are judging whether a candidate structured extraction is an isomorphic, faithful " +
    "translation of a natural-language logic puzzle's prose — every clue represented, nothing " +
    "invented, nothing misinterpreted. Solvability is irrelevant to this judgment: a faithful " +
    "translation of a puzzle that is genuinely unsatisfiable, or that has more than one " +
    "solution, is still a faithful translation and must be accepted.\n\n" +
    "Judge fidelity to the prose, not house style: `arithmetic` with comparator \"!=\" against " +
    'a named value (not just a number) is this schema\'s correct, intended way to express ' +
    'exclusion/negation ("X is not Y") — reject a translation for what it actually gets wrong ' +
    "against the prose, not for using a constraint kind whose name sounds unfamiliar for the " +
    "job. Do not require a specific naming/kind convention the schema doesn't define.\n\n" +
    "Represent only what is stated, not what a solver would infer from it. If three clues " +
    'say "not A", "not B", leave it there — do not require the extraction to also assert "is ' +
    'C" for the remaining option; that conclusion follows from solving the constraints, which ' +
    "is a downstream step this extraction is not responsible for and must not pre-compute. " +
    "Reject only for clues the extraction dropped, contradicted, or invented — never for " +
    "declining to state an unstated inference."
  )
}

function critiqueUserPrompt(prose: string, candidate: ExtractedCsp): string {
  return `Puzzle prose:\n\n${prose}\n\nCandidate extraction:\n${JSON.stringify(candidate)}`
}

function extractOnce(
  model: string,
  prose: string,
  context?: RevisionContext,
): Effect.Effect<ExtractedCsp, ProviderError | SchemaRejected | SchemaViolation> {
  return requestStructuredCompletion({
    model,
    systemPrompt: extractionSystemPrompt(),
    userPrompt: context === undefined ? extractionUserPrompt(prose) : revisionUserPrompt(prose, context),
    schemaName: "ExtractedCsp",
    jsonSchema: extractedCspJsonSchema,
    schema: ExtractedCsp,
  })
}

function critiqueOnce(
  model: string,
  prose: string,
  candidate: ExtractedCsp,
): Effect.Effect<FidelityCritique, ProviderError | SchemaRejected | SchemaViolation> {
  return requestStructuredCompletion({
    model,
    systemPrompt: critiqueSystemPrompt(),
    userPrompt: critiqueUserPrompt(prose, candidate),
    schemaName: "FidelityCritique",
    jsonSchema: fidelityCritiqueJsonSchema,
    schema: FidelityCritique,
  })
}

/**
 * One model tier's extract→critique→revise cycle (ADR-004 §2.4): up to
 * `MAX_REVISIONS_PER_TIER + 1` attempts, the critic running on the same tier as the extractor.
 * Returns the accepted result *or* every attempt made, rather than failing outright, so a caller
 * can escalate to another tier and still report the full attempt history if that tier also fails
 * (ADR-004 §2.6's CriticRejected carries attempts from every tier, not just the last).
 */
function runTier(
  model: string,
  prose: string,
): Effect.Effect<TierOutcome, ProviderError | SchemaRejected | SchemaViolation> {
  return Effect.gen(function* () {
    const attempts: ExtractionAttempt[] = []
    let context: RevisionContext | undefined

    for (let round = 0; round <= MAX_REVISIONS_PER_TIER; round++) {
      const extractedCsp = yield* extractOnce(model, prose, context)
      const critique = yield* critiqueOnce(model, prose, extractedCsp)
      attempts.push({ model, extractedCsp, critique })

      if (critique.accepted) {
        return { attempts, accepted: { extractedCsp } }
      }
      context = { extractedCsp, issues: critique.issues }
    }

    return { attempts }
  })
}

/**
 * ADR-004's fidelity critic loop, end to end: cheap-tier extract→critique→revise, escalating to
 * the frontier tier on exhaustion, failing with CriticRejected (carrying every attempt from both
 * tiers) only once the frontier tier is also exhausted (ADR-004 §2.4/§2.5).
 */
export function extract(prose: string, options?: ExtractOptions): Effect.Effect<ExtractionResult, ExtractionError> {
  const cheapModel = options?.model ?? DEFAULT_MODEL
  const frontierModel = options?.frontierModel ?? DEFAULT_FRONTIER_MODEL

  return Effect.gen(function* () {
    const cheapOutcome = yield* runTier(cheapModel, prose)
    if (cheapOutcome.accepted !== undefined) {
      return { extractedCsp: cheapOutcome.accepted.extractedCsp, model: cheapModel }
    }

    const frontierOutcome = yield* runTier(frontierModel, prose)
    if (frontierOutcome.accepted !== undefined) {
      return { extractedCsp: frontierOutcome.accepted.extractedCsp, model: frontierModel }
    }

    return yield* Effect.fail(
      new CriticRejected({ attempts: [...cheapOutcome.attempts, ...frontierOutcome.attempts] }),
    )
  })
}
