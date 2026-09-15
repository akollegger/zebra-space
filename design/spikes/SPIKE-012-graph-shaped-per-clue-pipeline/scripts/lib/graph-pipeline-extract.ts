// SPIKE-012: orchestrates the full pipeline — segment (SPIKE-008's splitClues, unchanged) ->
// inventory -> group -> shape -> per-clue two-step typing -> (optionally) oracle-guided repair.
// No LLM call in this file ever receives a free-text identifier to type; every identifier is
// either a literal prose span (inventory) or an index into one (group/shape), and every
// per-clue call chooses from a small enumerated set rather than constructing a nested document.

import { splitClues } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { extractInventory } from "./inventory.ts"
import { extractGroups, assignCanonicalIds } from "./group.ts"
import { extractShape } from "./shape.ts"
import { extractAllClues } from "./per-clue-typed.ts"
import { repairAndSolve, type OracleRepairResult } from "./oracle-repair.ts"
import type { ExtractedCsp } from "../../../../../src/extraction/types.ts"
import type { Vocabulary } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/clue-schema.ts"
import type { PerClueTypedLog, ClueTaggedConstraint } from "./per-clue-typed.ts"

export interface GraphPipelineResult {
  readonly extractedCsp: ExtractedCsp
  readonly vocabulary: Vocabulary
  readonly clues: readonly string[]
  readonly preamble: string
  readonly decomposable: boolean
  readonly perClue: readonly PerClueTypedLog[]
  readonly taggedConstraints: readonly ClueTaggedConstraint[]
  readonly totalCalls: number
  readonly actualCostUsd: number | undefined
  readonly stageBreakdown: { readonly inventory: number; readonly group: number; readonly shape: number; readonly perClueTyping: number }
}

/**
 * Runs stages 1-5 (segment/inventory/group/shape/per-clue-typing) — the vocabulary-construction
 * and constraint-extraction halves of the design, WITHOUT the oracle-repair loop. This is
 * `run-comparison.ts`'s "graph-pipeline" variant, measuring the new architecture on its own
 * before adding repair (mirrors SPIKE-008's own "per-clue" vs "per-clue+grounded" split).
 */
export async function extractGraphPipeline(model: string, prose: string): Promise<GraphPipelineResult> {
  let totalCost = 0
  let anyCost = false
  const addCost = (c: number | undefined) => {
    if (c !== undefined) {
      totalCost += c
      anyCost = true
    }
  }
  let totalCalls = 0

  const inventory = await extractInventory(model, prose)
  addCost(inventory.costUsd)
  totalCalls += inventory.calls

  const groupResult = await extractGroups(model, inventory.mentions)
  addCost(groupResult.costUsd)
  totalCalls += groupResult.calls
  const canonicalGroups = assignCanonicalIds(inventory.mentions, groupResult.groups)

  const shape = await extractShape(model, canonicalGroups)
  addCost(shape.costUsd)
  totalCalls += shape.calls
  const vocabulary: Vocabulary = { entities: shape.entities, domains: shape.domains }

  const split = splitClues(prose)
  const perClue = await extractAllClues(model, vocabulary, split.preamble, split.clues)
  addCost(perClue.actualCostUsd)
  totalCalls += perClue.totalCalls

  return {
    extractedCsp: { entities: vocabulary.entities, domains: vocabulary.domains, constraints: perClue.taggedConstraints.map((t) => t.constraint) },
    vocabulary,
    clues: split.clues,
    preamble: split.preamble,
    decomposable: split.decomposable,
    perClue: perClue.perClue,
    taggedConstraints: perClue.taggedConstraints,
    totalCalls,
    actualCostUsd: anyCost ? totalCost : undefined,
    stageBreakdown: { inventory: inventory.calls, group: groupResult.calls, shape: shape.calls, perClueTyping: perClue.totalCalls },
  }
}

export interface GraphPipelineWithRepairResult extends GraphPipelineResult {
  readonly repair: OracleRepairResult
}

/** Adds the oracle-guided repair loop (step 7) on top of `extractGraphPipeline`'s result —
 * `run-comparison.ts`'s "graph-pipeline+oracle-repair" variant. */
export async function extractGraphPipelineWithRepair(model: string, prose: string): Promise<GraphPipelineWithRepairResult> {
  const base = await extractGraphPipeline(model, prose)
  const repair = await repairAndSolve(model, base.vocabulary, base.preamble, base.clues, base.perClue, base.taggedConstraints)
  return {
    ...base,
    extractedCsp: repair.extractedCsp,
    totalCalls: base.totalCalls + repair.additionalCalls,
    actualCostUsd: base.actualCostUsd === undefined && repair.additionalCostUsd === undefined ? undefined : (base.actualCostUsd ?? 0) + (repair.additionalCostUsd ?? 0),
    repair,
  }
}
