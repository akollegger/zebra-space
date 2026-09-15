// SPIKE-013: the billed comparison run. Three variants, each running ONLY inventory->group->
// shape (no per-clue-typed, no oracle-repair, no compile/solve) — this spike measures the
// vocabulary shape directly. n>=5 samples per puzzle (REPS env var, default 5) so self-
// consistency and correctness can be told apart from single-sample noise (every prior spike in
// this line's own repeated caveat).
//
// Usage: node --env-file-if-exists=.env design/spikes/SPIKE-013-vocabulary-construction-isolation/scripts/run-comparison.ts [puzzleId ...]
// REPS=<n> overrides the default of 5.

import { writeFile, mkdir } from "node:fs/promises"
import { loadPuzzleProse } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { extractInventory } from "../../SPIKE-012-graph-shaped-per-clue-pipeline/scripts/lib/inventory.ts"
import { extractGroups, assignCanonicalIds, type CanonicalGroup } from "../../SPIKE-012-graph-shaped-per-clue-pipeline/scripts/lib/group.ts"
import { extractShape } from "../../SPIKE-012-graph-shaped-per-clue-pipeline/scripts/lib/shape.ts"
import { extractChunkedInventory } from "./lib/chunked-inventory.ts"
import { extractEmbeddedGroups } from "./lib/embedded-group.ts"
import { scoreVocabulary, type ScoreResult } from "./lib/score.ts"
import { embeddingSemanticMatch } from "./lib/semantic-match.ts"
import { groundTruthFor } from "./lib/ground-truth.ts"

const MODEL = "openai/gpt-4o-mini"
const REPS = Number(process.env.REPS ?? 5)

const SAMPLE = [
  "PZL-0002", "PZL-0004", "PZL-0022", "PZL-0028", "PZL-0033", "PZL-0038", "PZL-0015", "PZL-0018",
  "PZL-0001", "PZL-0003", "PZL-0007", "PZL-0010", "PZL-0011", "PZL-0012",
]

interface VocabularyResult {
  readonly entities: readonly { id: string; type: string }[]
  readonly domains: readonly { variable: string; entityType: string; values: readonly string[] }[]
  readonly totalCalls: number
  readonly costUsd: number | undefined
  readonly score: ScoreResult | undefined
}

async function runLlmOnly(puzzleId: string, prose: string): Promise<VocabularyResult> {
  const inv = await extractInventory(MODEL, prose)
  const grp = await extractGroups(MODEL, inv.mentions)
  const canonical = assignCanonicalIds(inv.mentions, grp.groups)
  const shape = await extractShape(MODEL, canonical)
  const totalCalls = inv.calls + grp.calls + shape.calls
  const costUsd = [inv.costUsd, grp.costUsd, shape.costUsd].some((c) => c !== undefined)
    ? (inv.costUsd ?? 0) + (grp.costUsd ?? 0) + (shape.costUsd ?? 0)
    : undefined
  const score = await scoreVocabulary(puzzleId, shape.entities, shape.domains, embeddingSemanticMatch)
  return { entities: shape.entities, domains: shape.domains, totalCalls, costUsd, score }
}

async function runChunkedInventory(puzzleId: string, prose: string): Promise<VocabularyResult> {
  const inv = extractChunkedInventory(prose) // local, deterministic, zero cost
  const grp = await extractGroups(MODEL, inv.mentions)
  const canonical = assignCanonicalIds(inv.mentions, grp.groups)
  const shape = await extractShape(MODEL, canonical)
  const totalCalls = inv.calls + grp.calls + shape.calls
  const costUsd = [grp.costUsd, shape.costUsd].some((c) => c !== undefined) ? (grp.costUsd ?? 0) + (shape.costUsd ?? 0) : undefined
  const score = await scoreVocabulary(puzzleId, shape.entities, shape.domains, embeddingSemanticMatch)
  return { entities: shape.entities, domains: shape.domains, totalCalls, costUsd, score }
}

async function runEmbeddedGroup(puzzleId: string, prose: string): Promise<VocabularyResult> {
  const inv = await extractInventory(MODEL, prose)
  const grp = await extractEmbeddedGroups(inv.mentions) // local, deterministic, zero cost
  const canonical: readonly CanonicalGroup[] = assignCanonicalIds(inv.mentions, grp.groups)
  const shape = await extractShape(MODEL, canonical)
  const totalCalls = inv.calls + grp.calls + shape.calls
  const costUsd = [inv.costUsd, shape.costUsd].some((c) => c !== undefined) ? (inv.costUsd ?? 0) + (shape.costUsd ?? 0) : undefined
  const score = await scoreVocabulary(puzzleId, shape.entities, shape.domains, embeddingSemanticMatch)
  return { entities: shape.entities, domains: shape.domains, totalCalls, costUsd, score }
}

/** Self-consistency: across reps, how often does the entity-axis-size set and the (normalized)
 * domain-name set agree with the MOST COMMON answer seen for this puzzle+variant? Doesn't
 * require ground truth — measures agreement with itself, not correctness. */
function selfConsistency(reps: readonly VocabularyResult[]): { readonly entityAxisAgreement: string; readonly domainSetAgreement: string } {
  const sizeSetSignature = (r: VocabularyResult) => [...new Set(r.entities.map((e) => e.type))].map((t) => r.entities.filter((e) => e.type === t).length).sort((a, b) => a - b).join(",")
  const domainSetSignature = (r: VocabularyResult) => [...new Set(r.domains.map((d) => d.variable.toLowerCase()))].sort().join(",")

  const tally = (sigs: readonly string[]) => {
    const counts = new Map<string, number>()
    for (const s of sigs) counts.set(s, (counts.get(s) ?? 0) + 1)
    const max = Math.max(...counts.values())
    return `${max}/${sigs.length}`
  }
  return {
    entityAxisAgreement: tally(reps.map(sizeSetSignature)),
    domainSetAgreement: tally(reps.map(domainSetSignature)),
  }
}

function summarizeScores(reps: readonly VocabularyResult[]) {
  const scored = reps.map((r) => r.score).filter((s): s is ScoreResult => s !== undefined)
  if (scored.length === 0) return undefined
  const correct = scored.filter((s) => s.structurallyCorrect).length
  const totalCost = reps.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
  return { structurallyCorrectRate: `${correct}/${scored.length}`, totalCost }
}

async function main(): Promise<void> {
  const puzzleIds = process.argv.slice(2).length > 0 ? process.argv.slice(2) : SAMPLE
  const records: unknown[] = []
  let grandTotalCost = 0

  for (const puzzleId of puzzleIds) {
    console.log(`\n=== ${puzzleId} ${groundTruthFor(puzzleId) !== undefined ? "(scored)" : "(no ground truth — consistency only)"} ===`)
    const { prose } = await loadPuzzleProse(puzzleId)

    const llmOnlyReps: VocabularyResult[] = []
    const chunkedReps: VocabularyResult[] = []
    const embeddedReps: VocabularyResult[] = []

    for (let rep = 0; rep < REPS; rep++) {
      const lo = await runLlmOnly(puzzleId, prose)
      llmOnlyReps.push(lo)
      grandTotalCost += lo.costUsd ?? 0
      console.log(`  llm-only [${rep + 1}/${REPS}]: entities=${lo.entities.length} domains=${lo.domains.length} correct=${lo.score?.structurallyCorrect ?? "n/a"} cost=${lo.costUsd ?? "n/a"}`)

      const ci = await runChunkedInventory(puzzleId, prose)
      chunkedReps.push(ci)
      grandTotalCost += ci.costUsd ?? 0
      console.log(`  chunked-inventory [${rep + 1}/${REPS}]: entities=${ci.entities.length} domains=${ci.domains.length} correct=${ci.score?.structurallyCorrect ?? "n/a"} cost=${ci.costUsd ?? "n/a"}`)

      const eg = await runEmbeddedGroup(puzzleId, prose)
      embeddedReps.push(eg)
      grandTotalCost += eg.costUsd ?? 0
      console.log(`  embedded-group [${rep + 1}/${REPS}]: entities=${eg.entities.length} domains=${eg.domains.length} correct=${eg.score?.structurallyCorrect ?? "n/a"} cost=${eg.costUsd ?? "n/a"}`)
    }

    records.push({
      id: puzzleId,
      hasGroundTruth: groundTruthFor(puzzleId) !== undefined,
      variants: {
        "llm-only": { reps: llmOnlyReps, consistency: selfConsistency(llmOnlyReps), scoreSummary: summarizeScores(llmOnlyReps) },
        "chunked-inventory": { reps: chunkedReps, consistency: selfConsistency(chunkedReps), scoreSummary: summarizeScores(chunkedReps) },
        "embedded-group": { reps: embeddedReps, consistency: selfConsistency(embeddedReps), scoreSummary: summarizeScores(embeddedReps) },
      },
    })
  }

  const outDir = new URL("results/", import.meta.url)
  await mkdir(outDir, { recursive: true })
  const outPath = new URL(`comparison-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, outDir)
  await writeFile(outPath, JSON.stringify(records, null, 2))
  console.log(`\nWrote ${records.length} records to ${outPath.pathname}`)
  console.log(`\nTotal spend this run: $${grandTotalCost.toFixed(4)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
