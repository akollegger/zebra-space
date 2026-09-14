// SPIKE-009: orchestrates the full pipeline — per-clue vocabulary proposals (propose-vocabulary.ts)
// -> deterministic reconciliation (reconcile.ts) -> per-clue constraint extraction against the
// RECONCILED vocabulary (reusing SPIKE-008's own generateClueTools/requestClueConstraints
// unchanged) -> filtering (filter.ts) -> assembly. Parallel in shape and result type to
// SPIKE-008's extractPerClue, so it plugs into a comparison runner the same way.

import { splitClues } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { generateClueTools, type Vocabulary } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/clue-schema.ts"
import { requestClueConstraints, type ParsedToolCall } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/tool-call.ts"
import { ADJACENCY_RELATIONS, ARITHMETIC_COMPARATORS } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/clue-schema.ts"
import { proposeVocabulary, type VocabularyProposal } from "./propose-vocabulary.ts"
import { reconcile } from "./reconcile.ts"
import { filterConstraints, type TaggedConstraint } from "./filter.ts"
import type { ExtractedCsp, ExtractedConstraint } from "../../../../../src/extraction/types.ts"

/** Same shape as per-clue-extract.ts's clueSystemPrompt — duplicated rather than imported
 * (that one isn't exported) since the guidance text itself is unchanged by this spike; only
 * WHERE the vocabulary comes from differs. */
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
    "If this clue states no constraint at all, call nothing."
  )
}

export interface VocabularyReconciledExtractionResult {
  readonly extractedCsp: ExtractedCsp
  readonly model: string
  readonly actualCostUsd: number | undefined
  readonly totalCalls: number
  readonly decomposable: boolean
  readonly proposals: readonly VocabularyProposal[]
  readonly droppedConstraints: readonly { readonly constraint: TaggedConstraint; readonly reason: string }[]
}

export async function extractWithReconciliation(prose: string, model: string): Promise<VocabularyReconciledExtractionResult> {
  let totalCost = 0
  let anyCost = false
  const addCost = (c: number | undefined) => {
    if (c !== undefined) {
      totalCost += c
      anyCost = true
    }
  }
  let totalCalls = 0

  const split = splitClues(prose)

  // Phase 1: local per-clue vocabulary proposals.
  const proposals: VocabularyProposal[] = []
  for (let i = 0; i < split.clues.length; i++) {
    const { proposal, costUsd } = await proposeVocabulary(model, i, split.clues[i]!)
    totalCalls += 1
    addCost(costUsd)
    proposals.push(proposal)
  }

  // Phase 2: deterministic reconciliation.
  const { vocabulary, survivingClueIndices } = reconcile(proposals)

  // Phase 3: per-clue constraint extraction against the RECONCILED vocabulary (unchanged
  // SPIKE-008 mechanism — same schema generator, same forced multi-tool call, one repair retry).
  const tools = generateClueTools(vocabulary)
  const tagged: TaggedConstraint[] = []
  for (let i = 0; i < split.clues.length; i++) {
    const clueText = split.clues[i]!
    const systemPrompt = clueSystemPrompt(vocabulary, split.preamble)
    const result = await requestClueConstraints({ model, systemPrompt, userPrompt: `Clue:\n\n${clueText}`, tools })
    totalCalls += 1
    addCost(result.costUsd)

    let calls: readonly ParsedToolCall[] = result.ok ? result.calls : []
    const failing = calls.filter((c) => !c.ok)
    if (result.ok && failing.length > 0) {
      const repairPrompt =
        `Clue:\n\n${clueText}\n\n` +
        `Your previous call(s) had structural problems:\n${failing.map((f) => `- ${f.kind}: ${f.error}`).join("\n")}\n\n` +
        "Call the tool(s) again, corrected."
      const retry = await requestClueConstraints({ model, systemPrompt, userPrompt: repairPrompt, tools })
      totalCalls += 1
      addCost(retry.costUsd)
      if (retry.ok) calls = [...calls.filter((c) => c.ok), ...retry.calls.filter((c) => c.ok)]
    }

    for (const call of calls) {
      if (call.ok) tagged.push({ clueIndex: i, constraint: call.value as ExtractedConstraint })
    }
  }

  // Phase 4: filter.
  const { kept, dropped } = filterConstraints(tagged, vocabulary, survivingClueIndices)

  return {
    extractedCsp: { entities: vocabulary.entities, domains: vocabulary.domains, constraints: kept.map((t) => t.constraint) },
    model,
    actualCostUsd: anyCost ? totalCost : undefined,
    totalCalls,
    decomposable: split.decomposable,
    proposals,
    droppedConstraints: dropped,
  }
}
