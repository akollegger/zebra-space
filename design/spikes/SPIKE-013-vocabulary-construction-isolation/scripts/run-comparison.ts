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
  readonly error?: string
}

const FAILED_RESULT: Omit<VocabularyResult, "error"> = { entities: [], domains: [], totalCalls: 0, costUsd: undefined, score: undefined }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Found live (2026-09-15): a transient OpenRouter 504 ("Network connection lost") crashed the
 * entire sweep outright — none of SPIKE-012's inventory/group/shape helpers catch transport-
 * level errors, they just let them propagate. One rep failing shouldn't cost every puzzle's
 * already-collected data, so every variant call is wrapped here: retry once after a short
 * delay, then record a `FAILED_RESULT` (never thrown) so the sweep — and this run's own JSON
 * output — survives a single flaky call. */
async function withRetry(label: string, fn: () => Promise<VocabularyResult>): Promise<VocabularyResult> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fn()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`  ${label}: attempt ${attempt} failed (${message.slice(0, 150)})`)
      if (attempt === 2) return { ...FAILED_RESULT, error: message.slice(0, 300) }
      await sleep(2000)
    }
  }
  return { ...FAILED_RESULT, error: "unreachable" }
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

  // Found live (2026-09-15): the first full-sweep attempt crashed on a transient OpenRouter 504
  // before this fix, losing every already-collected puzzle's data since the write only happened
  // at the very end. Written incrementally to the SAME path now (one timestamp, chosen once) so
  // a later crash keeps everything gathered so far, not just what withRetry couldn't recover.
  const outDir = new URL("results/", import.meta.url)
  await mkdir(outDir, { recursive: true })
  const outPath = new URL(`comparison-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, outDir)

  for (const puzzleId of puzzleIds) {
    console.log(`\n=== ${puzzleId} ${groundTruthFor(puzzleId) !== undefined ? "(scored)" : "(no ground truth — consistency only)"} ===`)
    const { prose } = await loadPuzzleProse(puzzleId)

    const llmOnlyReps: VocabularyResult[] = []
    const chunkedReps: VocabularyResult[] = []
    const embeddedReps: VocabularyResult[] = []

    for (let rep = 0; rep < REPS; rep++) {
      const lo = await withRetry("llm-only", () => runLlmOnly(puzzleId, prose))
      llmOnlyReps.push(lo)
      grandTotalCost += lo.costUsd ?? 0
      console.log(`  llm-only [${rep + 1}/${REPS}]: entities=${lo.entities.length} domains=${lo.domains.length} correct=${lo.score?.structurallyCorrect ?? "n/a"} cost=${lo.costUsd ?? "n/a"}${lo.error ? ` FAILED: ${lo.error}` : ""}`)

      const ci = await withRetry("chunked-inventory", () => runChunkedInventory(puzzleId, prose))
      chunkedReps.push(ci)
      grandTotalCost += ci.costUsd ?? 0
      console.log(`  chunked-inventory [${rep + 1}/${REPS}]: entities=${ci.entities.length} domains=${ci.domains.length} correct=${ci.score?.structurallyCorrect ?? "n/a"} cost=${ci.costUsd ?? "n/a"}${ci.error ? ` FAILED: ${ci.error}` : ""}`)

      const eg = await withRetry("embedded-group", () => runEmbeddedGroup(puzzleId, prose))
      embeddedReps.push(eg)
      grandTotalCost += eg.costUsd ?? 0
      console.log(`  embedded-group [${rep + 1}/${REPS}]: entities=${eg.entities.length} domains=${eg.domains.length} correct=${eg.score?.structurallyCorrect ?? "n/a"} cost=${eg.costUsd ?? "n/a"}${eg.error ? ` FAILED: ${eg.error}` : ""}`)
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

    await writeFile(outPath, JSON.stringify(records, null, 2))
  }

  console.log(`\nWrote ${records.length} records to ${outPath.pathname}`)
  console.log(`\nTotal spend this run: $${grandTotalCost.toFixed(4)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
