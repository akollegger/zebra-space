// SPIKE-008: the per-clue extraction loop itself. Stage 1 (vocabulary) reuses the real
// pipeline's requestStructuredCompletion + ExtractedVocabulary schema directly (already small
// and reliable — 865 chars, src/extraction/types.ts) rather than duplicating a stage-1 prompt;
// stage 2 replaces the monolithic constraints call with one requestClueConstraints call per
// clue (tool-call.ts), each offered the full nine-tool set generated from stage 1's vocabulary
// (clue-schema.ts).

import { Effect } from "effect"
import { requestStructuredCompletion } from "../../../../../src/extraction/provider.ts"
import { ExtractedVocabulary, extractedVocabularyJsonSchema, type ExtractedCsp, type ExtractedConstraint } from "../../../../../src/extraction/types.ts"
import { generateClueTools, ADJACENCY_RELATIONS, ARITHMETIC_COMPARATORS, type Vocabulary } from "./clue-schema.ts"
import { requestClueConstraints, type ParsedToolCall } from "./tool-call.ts"
import { splitClues } from "./puzzles.ts"

// Reuses the SAME vocabulary-extraction call as ADR-009's extractStaged (src/extraction/
// extract.ts's private vocabularySystemPrompt), duplicated here in spirit only — that function
// isn't exported — so this spike shares stage 1's design without paying for the monolithic
// stage-2 call extractStaged would otherwise also make.
const VOCABULARY_SYSTEM_PROMPT =
  "You are extracting the vocabulary of a constraint-satisfaction problem from a " +
  "natural-language logic puzzle. Identify the entities (each with a stable id and a type) " +
  "and the decision-variable domains (each with a variable name, the entity type it ranges " +
  "over, and its finite set of values). Represent every distinct attribute group as one " +
  "domain; invent no values beyond what the prose states. No constraints yet — vocabulary only."

/** One clue's system prompt: the closed vocabulary (as enums, already enforced by the schema
 * itself — this text is guidance for WHICH tool fits, not a defense against invented values,
 * since the schema makes that structurally impossible) plus the same three-way kind-selection
 * guidance the monolith's prompt spends most of its length on (extract.ts's
 * extractionSystemPrompt), condensed since each call only ever needs ONE clue's worth of it. */
function clueSystemPrompt(vocab: Vocabulary, preamble: string): string {
  const entityIds = vocab.entities.map((e) => e.id).join(", ") || "(none declared)"
  const domainNames = vocab.domains.map((d) => `${d.variable}=[${d.values.join(", ")}]`).join("; ")
  return (
    "You are extracting ONE clue's constraint(s) from a natural-language logic puzzle, against " +
    "an already-fixed vocabulary. Call one or more of the declared tools — one per constraint " +
    "this single clue asserts (usually one; call two only for a genuinely compound clue that " +
    "states two independent facts). Do not restate other clues.\n\n" +
    `Scenario: ${preamble}\n\n` +
    `Entities: ${entityIds}\n` +
    `Domains: ${domainNames}\n\n` +
    "Pick the tool by what THIS clue asserts:\n" +
    '- Exclusion/negation ("X is not val1"): `arithmetic` with comparator "!=".\n' +
    "- Attribute co-occurrence with no entity named: `linkedAttributes`.\n" +
    '- A specific, already-known entity ("the first one", or one named directly): `assignment`.\n' +
    '- Positional/ordering between two entities ("immediately right of", "next to"): `adjacency` ' +
    `— relation must be one of: ${ADJACENCY_RELATIONS.join(", ")}.\n` +
    "- A numeric/threshold comparison, or one entity's value against another's: `arithmetic` " +
    `(comparator one of: ${ARITHMETIC_COMPARATORS.join(", ")}).\n` +
    '- A closed, static fact between VALUES regardless of entity ("X beats Y"): `ruleTable` ' +
    "(one call per fact) plus exactly one paired `ruleTableConstraint` requiring the actual " +
    "values satisfy it.\n" +
    '- A conditional rule ("if X then Y"): `derivedRule`.\n' +
    "If this clue states no constraint at all (e.g. pure scenario setup already covered above), " +
    "call nothing — but every numbered clue in this catalog's puzzles has so far asserted " +
    "exactly one constraint, so this should be rare."
  )
}

export interface PerClueCallLog {
  readonly clueIndex: number
  readonly clueText: string
  readonly toolCallsMade: number
  readonly kindsEmitted: readonly string[]
  readonly rejectedStructurally: readonly string[]
  readonly costUsd: number | undefined
}

export interface PerClueExtractionResult {
  readonly extractedCsp: ExtractedCsp
  readonly model: string
  readonly actualCostUsd: number | undefined
  readonly totalCalls: number
  readonly perClue: readonly PerClueCallLog[]
  readonly decomposable: boolean
}

/**
 * Per-clue extraction: stage 1 (vocabulary, real pipeline's call) + one requestClueConstraints
 * call per clue, each offered a schema generated from stage 1's vocabulary. A structurally
 * invalid call gets ONE repair re-prompt naming the specific validation error (mirrors
 * extract.ts's schema-repair path, scoped to a single clue instead of the whole document) before
 * that clue's rejected call is simply dropped and logged — sub-question 1/4's whole point is
 * measuring how often this repair (or the drop) is even needed, which the monolith's whole-
 * document retry can't isolate to one clue.
 */
export async function extractPerClue(prose: string, model: string): Promise<PerClueExtractionResult> {
  let totalCost = 0
  let anyCost = false
  const addCost = (c: number | undefined) => {
    if (c !== undefined) {
      totalCost += c
      anyCost = true
    }
  }
  let totalCalls = 0

  const vocabResult = await Effect.runPromise(
    requestStructuredCompletion({
      model,
      systemPrompt: VOCABULARY_SYSTEM_PROMPT,
      userPrompt: `Puzzle:\n\n${prose}`,
      schemaName: "ExtractedVocabulary",
      jsonSchema: extractedVocabularyJsonSchema,
      schema: ExtractedVocabulary,
    }),
  )
  totalCalls += 1
  addCost(vocabResult.costUsd)
  const vocabulary: Vocabulary = vocabResult.value

  const tools = generateClueTools(vocabulary)
  const split = splitClues(prose)
  const perClue: PerClueCallLog[] = []
  const constraints: ExtractedConstraint[] = []

  for (let i = 0; i < split.clues.length; i++) {
    const clueText = split.clues[i]!
    const systemPrompt = clueSystemPrompt(vocabulary, split.preamble)
    const result = await requestClueConstraints({ model, systemPrompt, userPrompt: `Clue:\n\n${clueText}`, tools })
    totalCalls += 1
    if (result.ok) addCost(result.costUsd)

    let calls: readonly ParsedToolCall[] = result.ok ? result.calls : []
    const rejected: string[] = result.ok ? [] : [`(call-level) ${result.reason}: ${result.detail}`]

    // One repair round: re-send with every rejected call's specific error, scoped to this clue.
    const failing = calls.filter((c) => !c.ok)
    if (result.ok && failing.length > 0) {
      const repairPrompt =
        `Clue:\n\n${clueText}\n\n` +
        `Your previous call(s) had structural problems:\n${failing.map((f) => `- ${f.kind}: ${f.error}`).join("\n")}\n\n` +
        "Call the tool(s) again, corrected."
      const retry = await requestClueConstraints({ model, systemPrompt, userPrompt: repairPrompt, tools })
      totalCalls += 1
      if (retry.ok) {
        addCost(retry.costUsd)
        // Keep whichever calls succeeded across BOTH rounds — a repair round that fixes one
        // call but not another shouldn't discard the one that was already right.
        const stillFailing = retry.calls.filter((c) => !c.ok)
        calls = [...calls.filter((c) => c.ok), ...retry.calls.filter((c) => c.ok)]
        rejected.push(...stillFailing.map((f) => `${f.kind}: ${f.error}`))
      } else {
        rejected.push(`(repair call-level) ${retry.reason}: ${retry.detail}`)
      }
    }

    for (const call of calls) {
      if (call.ok) constraints.push(call.value as ExtractedConstraint)
    }
    perClue.push({
      clueIndex: i,
      clueText,
      toolCallsMade: calls.length,
      kindsEmitted: calls.filter((c) => c.ok).map((c) => c.kind),
      rejectedStructurally: rejected,
      costUsd: undefined, // per-call cost isn't separable from vocabulary's single reportable total below
    })
  }

  return {
    extractedCsp: { entities: vocabulary.entities, domains: vocabulary.domains, constraints },
    model,
    actualCostUsd: anyCost ? totalCost : undefined,
    totalCalls,
    perClue,
    decomposable: split.decomposable,
  }
}
