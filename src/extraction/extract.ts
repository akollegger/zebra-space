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

/** Context for retrying a schema-invalid tool call — distinct from `RevisionContext` because
 * there's no decoded `ExtractedCsp` to echo back, only the raw arguments and the validation
 * error that rejected them. */
interface SchemaRepairContext {
  readonly raw: string
  readonly detail: string
}

interface TierOutcome {
  readonly attempts: readonly ExtractionAttempt[]
  readonly accepted?: { readonly extractedCsp: ExtractedCsp }
  // Carried so `extract()` can surface a real diagnostic instead of an empty `CriticRejected`
  // when every attempt across both tiers failed schema validation and none ever decoded.
  readonly lastSchemaViolation?: SchemaViolation
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
    "exactly this.\n\n" +
    "`arithmetic`'s `comparator` field (e.g. \"=\", \"!=\", \">=\") is ALWAYS separate from " +
    "`expression`'s `op` — `op` is only ever one of the arithmetic operators " +
    '(+ - * / min max abs), never a comparator. For "Drug B is at least 4 hours after Drug ' +
    'A": `expression` is `{kind: "binaryOp", op: "-", operands: [timeB, timeA]}`, ' +
    '`comparator` is ">=", `target` is `{kind: "literal", value: 4}` — do NOT put ">=" inside ' +
    "`expression.op`. For a symmetric \"at least N (hours/units) away from\" clue, wrap the " +
    'difference in `abs`: `expression` is `{kind: "binaryOp", op: "abs", operands: [{kind: ' +
    '"binaryOp", op: "-", operands: [a, b]}]}`, with the threshold still in the top-level ' +
    "`comparator`/`target`.\n\n" +
    "A derivedRule's two condition shapes each have their OWN entity-reference convention in " +
    "thenConstraints — don't mix them up:\n" +
    '- `condition: {kind: "relation", name: ...}` (fact-driven — paired with separate `relation` ' +
    'facts elsewhere, e.g. "France shares a border with Spain"): thenConstraints reference the ' +
    'matched fact\'s two entities via `target: "$a"` or `target: "$b"` — a literal STRING value, ' +
    "not a `variableRef` object. Leave `expression`'s own `variableRef.entity` as `null`.\n" +
    '- `condition: {kind: "comparison", variable, operator, value}` (variable-conditioned, ' +
    'evaluated per entity — see below): use `"$this"`/`"$outer"` inside `variableRef.entity` ' +
    "instead. Never use `\"$a\"`/`\"$b\"` here, and never use `\"$this\"`/`\"$outer\"` as a bare " +
    "`target` string for a relation-conditioned rule.\n\n" +
    'A derivedRule\'s condition is evaluated per entity ("if THIS entity\'s attribute has ' +
    'some value, then..."), e.g. "the green house\'s owner drinks milk" or "if a house is ' +
    'green, its position is one more than the ivory house\'s". Inside that derivedRule\'s ' +
    '`thenConstraints`, use the literal entity id `"$this"` for `variableRef.entity` (or ' +
    "`assignment.entity`) wherever you mean \"the entity currently satisfying this rule's " +
    'condition" — never invent another placeholder name or the entity\'s attribute value ' +
    'itself (e.g. not `entity: "green"`). Reference a different, already-named entity by its ' +
    "real id as usual.\n\n" +
    'When a clue relates TWO entities that are BOTH unnamed, each identified only by its own ' +
    'attribute ("whoever smokes Chesterfields lives next to whoever owns the fox" — neither ' +
    'house is ever named directly), nest a second derivedRule inside the first one\'s ' +
    '`thenConstraints`: the outer derivedRule\'s condition picks out the first entity ' +
    '("cigarette == Chesterfields"), the inner nested derivedRule\'s condition picks out the ' +
    'second ("pet == fox"). Inside the INNER rule\'s own `thenConstraints`, use `"$this"` for ' +
    'the inner entity (the one satisfying the inner condition) and `"$outer"` for the outer ' +
    "entity (the one satisfying the outer condition) — never reuse `\"$this\"` for both."
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

function schemaRepairUserPrompt(prose: string, repair: SchemaRepairContext): string {
  return (
    `Puzzle:\n\n${prose}\n\n` +
    `Your previous tool call did not match the required schema.\n\n` +
    `Raw arguments you sent:\n${repair.raw}\n\n` +
    `Validation error:\n${repair.detail}\n\n` +
    "Call the tool again with corrected arguments that strictly satisfy the schema — fix only " +
    "the structural problem described above; keep everything else faithful to the puzzle."
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
  repair?: SchemaRepairContext,
): Effect.Effect<ExtractedCsp, ProviderError | SchemaRejected | SchemaViolation> {
  const userPrompt =
    repair !== undefined
      ? schemaRepairUserPrompt(prose, repair)
      : context !== undefined
        ? revisionUserPrompt(prose, context)
        : extractionUserPrompt(prose)
  return requestStructuredCompletion({
    model,
    systemPrompt: extractionSystemPrompt(),
    userPrompt,
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
 *
 * A schema-invalid tool call (`SchemaViolation`) is treated the same way as a critic rejection —
 * consumed as one of the `MAX_REVISIONS_PER_TIER + 1` rounds, retried with a repair prompt
 * showing the model its own raw arguments and the validation error — rather than propagating out
 * and aborting the whole extraction. It previously did exactly that: `resolvedModel` was `null`
 * for 100% of `SchemaViolation` failures across every `eval/results.md` run, meaning the frontier
 * tier was never even attempted when the cheap tier produced a malformed payload.
 */
function runTier(
  model: string,
  prose: string,
): Effect.Effect<TierOutcome, ProviderError | SchemaRejected | SchemaViolation> {
  return Effect.gen(function* () {
    const attempts: ExtractionAttempt[] = []
    let context: RevisionContext | undefined
    let repair: SchemaRepairContext | undefined
    let lastSchemaViolation: SchemaViolation | undefined

    for (let round = 0; round <= MAX_REVISIONS_PER_TIER; round++) {
      const attempt = yield* extractOnce(model, prose, context, repair).pipe(
        Effect.map((extractedCsp) => ({ ok: true as const, extractedCsp })),
        Effect.catchTag("SchemaViolation", (violation) => Effect.succeed({ ok: false as const, violation })),
      )

      if (!attempt.ok) {
        lastSchemaViolation = attempt.violation
        repair = { raw: attempt.violation.raw, detail: attempt.violation.detail }
        context = undefined
        continue
      }

      repair = undefined
      const critique = yield* critiqueOnce(model, prose, attempt.extractedCsp)
      attempts.push({ model, extractedCsp: attempt.extractedCsp, critique })

      if (critique.accepted) {
        return { attempts, accepted: { extractedCsp: attempt.extractedCsp } }
      }
      context = { extractedCsp: attempt.extractedCsp, issues: critique.issues }
    }

    return { attempts, lastSchemaViolation }
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

    const attempts = [...cheapOutcome.attempts, ...frontierOutcome.attempts]

    // Neither tier ever decoded a candidate to critique — every round was a schema violation.
    // Surface the frontier tier's last one (the more relevant, final diagnostic) rather than a
    // CriticRejected carrying zero attempts, which would hide why extraction actually failed.
    const lastSchemaViolation = frontierOutcome.lastSchemaViolation ?? cheapOutcome.lastSchemaViolation
    if (attempts.length === 0 && lastSchemaViolation !== undefined) {
      return yield* Effect.fail(lastSchemaViolation)
    }

    return yield* Effect.fail(new CriticRejected({ attempts }))
  })
}
