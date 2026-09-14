// SPIKE-010: identical mechanism to SPIKE-008's extractPerClue (per-clue-extract.ts), except each
// per-clue constraint call's user prompt carries the FULL puzzle prose (every clue's text) with
// the target clue called out, instead of only that clue's own text. This isolates one variable —
// clue-only vs. full-prose context — against SPIKE-008's proven per-clue mechanism, with no
// reconciliation step (contrast SPIKE-009's approach to the same cross-clue-blindness problem).

import { Effect } from "effect"
import { requestStructuredCompletion } from "../../../../../src/extraction/provider.ts"
import { ExtractedVocabulary, extractedVocabularyJsonSchema, type ExtractedCsp, type ExtractedConstraint } from "../../../../../src/extraction/types.ts"
import {
  generateClueTools,
  ADJACENCY_RELATIONS,
  ARITHMETIC_COMPARATORS,
  type Vocabulary,
} from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/clue-schema.ts"
import { requestClueConstraints, type ParsedToolCall } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/tool-call.ts"
import { splitClues } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import type { PerClueCallLog, PerClueExtractionResult, ClueTaggedConstraint } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/per-clue-extract.ts"

// Identical to SPIKE-008's own VOCABULARY_SYSTEM_PROMPT — the vocabulary stage is unchanged here.
const VOCABULARY_SYSTEM_PROMPT =
  "You are extracting the vocabulary of a constraint-satisfaction problem from a " +
  "natural-language logic puzzle. Identify the entities (each with a stable id and a type) " +
  "and the decision-variable domains (each with a variable name, the entity type it ranges " +
  "over, and its finite set of values). Represent every distinct attribute group as one " +
  "domain; invent no values beyond what the prose states. No constraints yet — vocabulary only."

/**
 * The one thing this spike changes: instead of SPIKE-008's clueSystemPrompt (which only shows
 * the target clue's own text), this shows the FULL numbered clue list plus a preamble, with the
 * target clue marked, so the model can resolve cross-clue references (shared ordering domains,
 * entity-indexed-vs-scalar attributes) that a single clue's text can't reveal on its own. The
 * tool-selection guidance text itself is copied verbatim from SPIKE-008 — only the puzzle-content
 * portion of the prompt differs.
 */
function fullProseClueSystemPrompt(vocab: Vocabulary, preamble: string, allClues: readonly string[], targetIndex: number): string {
  const entityIds = vocab.entities.map((e) => e.id).join(", ") || "(none declared)"
  const domainNames = vocab.domains.map((d) => `${d.variable}=[${d.values.join(", ")}]`).join("; ")
  // Each clue's own text already carries its catalog numbering ("1. ...", "2. ...", from
  // puzzles.ts's splitClues) — reviewed in PR #29: an added bracketed index like "[0]"/"[1]"
  // introduced a SECOND, differently-based numbering scheme alongside it, which risked the
  // model conflating the two. Fixed by marking the target inline, after its own existing
  // number, with no separate index scheme at all.
  const numberedClues = allClues.map((c, i) => (i === targetIndex ? `${c}  <-- TARGET` : c)).join("\n")
  return (
    "You are extracting the constraint(s) asserted by ONE marked clue in a natural-language " +
    "logic puzzle, against an already-fixed vocabulary. You are shown the FULL puzzle below — " +
    "use the other clues purely as context to resolve ambiguity (e.g. what shared ordering or " +
    "attribute a positional/comparative clue refers to). Call one or more of the declared tools " +
    "— one per constraint the TARGET clue asserts (usually one; call two only for a genuinely " +
    "compound clue that states two independent facts). Do NOT emit constraints for any clue " +
    "other than the TARGET.\n\n" +
    `Scenario: ${preamble}\n\n` +
    `Entities: ${entityIds}\n` +
    `Domains: ${domainNames}\n\n` +
    "Full puzzle (target clue marked with <-- TARGET at the end of its line):\n" +
    `${numberedClues}\n\n` +
    "Pick the tool by what the TARGET clue asserts:\n" +
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
    "If the TARGET clue states no constraint at all (e.g. pure scenario setup already covered " +
    "above), call nothing — but every numbered clue in this catalog's puzzles has so far " +
    "asserted exactly one constraint, so this should be rare."
  )
}

/**
 * Same structure as SPIKE-008's extractPerClue (stage-1 vocabulary call + one
 * requestClueConstraints call per clue, one repair round on structural rejection), except each
 * per-clue call's user prompt just points at the marked target — the full puzzle context (and
 * the target-clue marker) lives in the system prompt via fullProseClueSystemPrompt, so the model
 * always sees the whole puzzle rather than only the target clue's isolated text.
 */
export async function extractFullProsePerClue(prose: string, model: string): Promise<PerClueExtractionResult> {
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
  const taggedConstraints: ClueTaggedConstraint[] = []

  for (let i = 0; i < split.clues.length; i++) {
    const clueText = split.clues[i]!
    const systemPrompt = fullProseClueSystemPrompt(vocabulary, split.preamble, split.clues, i)
    const userPrompt = "Extract the constraint(s) asserted by the clue marked <-- TARGET."
    const result = await requestClueConstraints({ model, systemPrompt, userPrompt, tools })
    totalCalls += 1
    addCost(result.costUsd)

    let calls: readonly ParsedToolCall[] = result.ok ? result.calls : []
    const rejected: string[] = result.ok ? [] : [`(call-level) ${result.reason}: ${result.detail}`]

    const failing = calls.filter((c) => !c.ok)
    if (result.ok && failing.length > 0) {
      const repairPrompt =
        `${userPrompt}\n\n` +
        `Your previous call(s) had structural problems:\n${failing.map((f) => `- ${f.kind}: ${f.error}`).join("\n")}\n\n` +
        "Call the tool(s) again, corrected."
      const retry = await requestClueConstraints({ model, systemPrompt, userPrompt: repairPrompt, tools })
      totalCalls += 1
      addCost(retry.costUsd)
      if (retry.ok) {
        const stillFailing = retry.calls.filter((c) => !c.ok)
        calls = [...calls.filter((c) => c.ok), ...retry.calls.filter((c) => c.ok)]
        rejected.push(...stillFailing.map((f) => `${f.kind}: ${f.error}`))
      } else {
        rejected.push(`(repair call-level) ${retry.reason}: ${retry.detail}`)
      }
    }

    for (const call of calls) {
      if (call.ok) {
        constraints.push(call.value as ExtractedConstraint)
        taggedConstraints.push({ clueIndex: i, constraint: call.value as ExtractedConstraint })
      }
    }
    perClue.push({
      clueIndex: i,
      clueText,
      toolCallsMade: calls.length,
      kindsEmitted: calls.filter((c) => c.ok).map((c) => c.kind),
      rejectedStructurally: rejected,
      costUsd: undefined,
    })
  }

  return {
    extractedCsp: { entities: vocabulary.entities, domains: vocabulary.domains, constraints },
    model,
    actualCostUsd: anyCost ? totalCost : undefined,
    totalCalls,
    perClue,
    decomposable: split.decomposable,
    vocabulary,
    clues: split.clues,
    preamble: split.preamble,
    taggedConstraints,
  }
}

// Exported for the offline smoke test — checking prompt assembly needs no live call.
export { fullProseClueSystemPrompt }
