// SPIKE-013 §2 step 6 (5th variant, added 2026-09-16): `post-hoc-shaped` — the direct answer to
// §5.7's diagnosis that `post-hoc`'s failures (PZL-0004's entity-axis-vs-domain-values confusion)
// came from free-form entity/domain construction, not from lacking a solved trace. Rather than
// writing a NEW closed-classification prompt, this reuses SPIKE-012's exact, already-proven
// inventory -> group -> shape pipeline UNCHANGED (the same three calls `llm-only` already makes,
// including `shape.ts`'s closed entityAxis/domainValues multiple-choice classification) — the
// ONLY thing that changes is the INPUT TEXT: inventory now reads prose + the already-completed
// direct-solve trace concatenated, instead of prose alone. This isolates one variable cleanly:
// does a solved trace as additional context, with the classification mechanism held fixed, fix
// what free-form post-hoc transcription got wrong?
//
// Stage 1 (solving) is NOT re-run, same as post-hoc — read from the already-collected,
// already-paid-for eval/results/2026-09-15T14-59-37-368Z.json (gpt-4o-mini direct-solve).
//
// Usage: node --env-file-if-exists=.env design/spikes/SPIKE-013-vocabulary-construction-isolation/scripts/run-post-hoc-shaped.ts
// REPS=<n> overrides the default of 3.

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { loadPuzzleProse } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { extractInventory } from "../../SPIKE-012-graph-shaped-per-clue-pipeline/scripts/lib/inventory.ts"
import { extractGroups, assignCanonicalIds } from "../../SPIKE-012-graph-shaped-per-clue-pipeline/scripts/lib/group.ts"
import { extractShape } from "../../SPIKE-012-graph-shaped-per-clue-pipeline/scripts/lib/shape.ts"
import { scoreVocabulary, type ScoreResult } from "./lib/score.ts"
import { embeddingSemanticMatch } from "./lib/semantic-match.ts"
import { groundTruthFor } from "./lib/ground-truth.ts"

const MODEL = "openai/gpt-4o-mini"
const REPS = Number(process.env.REPS ?? 3)

const DEFAULT_RESULTS_FILE = new URL("../../../../eval/results/2026-09-15T14-59-37-368Z.json", import.meta.url)

interface SourceRecord {
  readonly id: string
  readonly outcome: string
  readonly extractedCsp: { readonly directSolution?: string }
}
interface SourceFile {
  readonly puzzles: readonly SourceRecord[]
}

interface VariantResult {
  readonly entities: readonly { id: string; type: string }[]
  readonly domains: readonly { variable: string; entityType: string; values: readonly string[] }[]
  readonly totalCalls: number
  readonly costUsd: number | undefined
  readonly score: ScoreResult | undefined
  readonly error?: string
}

const FAILED_RESULT: Omit<VariantResult, "error"> = { entities: [], domains: [], totalCalls: 0, costUsd: undefined, score: undefined }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Same lesson as run-comparison.ts/run-post-hoc.ts's own withRetry: one flaky provider call must
 * never cost every already-collected puzzle's data. */
async function withRetry(label: string, fn: () => Promise<VariantResult>): Promise<VariantResult> {
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

/** The ONLY departure from run-comparison.ts's `runLlmOnly`: inventory reads prose + the solved
 * trace, clearly separated so the model can tell puzzle text from worked solution — everything
 * downstream (group, assignCanonicalIds, shape) is called exactly as `llm-only` calls it. */
async function runPostHocShaped(puzzleId: string, prose: string, trace: string): Promise<VariantResult> {
  const combinedText = `${prose}\n\n--- Worked solution (may be correct or incorrect; use it to see what the puzzle's own vocabulary looks like) ---\n\n${trace}`
  const inv = await extractInventory(MODEL, combinedText)
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

function selfConsistency(reps: readonly VariantResult[]): { readonly entityAxisAgreement: string; readonly domainSetAgreement: string } {
  const sizeSetSignature = (r: VariantResult) =>
    [...new Set(r.entities.map((e) => e.type))].map((t) => r.entities.filter((e) => e.type === t).length).sort((a, b) => a - b).join(",")
  const domainSetSignature = (r: VariantResult) => [...new Set(r.domains.map((d) => d.variable.toLowerCase()))].sort().join(",")
  const tally = (sigs: readonly string[]) => {
    const counts = new Map<string, number>()
    for (const s of sigs) counts.set(s, (counts.get(s) ?? 0) + 1)
    const max = Math.max(...counts.values())
    return `${max}/${sigs.length}`
  }
  return { entityAxisAgreement: tally(reps.map(sizeSetSignature)), domainSetAgreement: tally(reps.map(domainSetSignature)) }
}

function summarizeScores(reps: readonly VariantResult[]) {
  const scored = reps.map((r) => r.score).filter((s): s is ScoreResult => s !== undefined)
  if (scored.length === 0) return undefined
  const correct = scored.filter((s) => s.structurallyCorrect).length
  const totalCost = reps.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
  return { structurallyCorrectRate: `${correct}/${scored.length}`, totalCost }
}

async function main(): Promise<void> {
  const raw = await readFile(DEFAULT_RESULTS_FILE, "utf8")
  const sourceFile = JSON.parse(raw) as SourceFile

  const records: unknown[] = []
  let grandTotalCost = 0
  const outDir = new URL("results/", import.meta.url)
  await mkdir(outDir, { recursive: true })
  const outPath = new URL(`post-hoc-shaped-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, outDir)

  for (const puzzle of sourceFile.puzzles) {
    const trace = puzzle.extractedCsp?.directSolution
    if (typeof trace !== "string" || trace.trim() === "") {
      console.log(`\n=== ${puzzle.id}: no direct-solve trace (skipped) ===`)
      continue
    }
    console.log(`\n=== ${puzzle.id} (source outcome: ${puzzle.outcome}, ${groundTruthFor(puzzle.id) !== undefined ? "scored" : "consistency only"}) ===`)
    const { prose } = await loadPuzzleProse(puzzle.id)

    const reps: VariantResult[] = []
    for (let rep = 0; rep < REPS; rep++) {
      const result = await withRetry("post-hoc-shaped", () => runPostHocShaped(puzzle.id, prose, trace))
      reps.push(result)
      grandTotalCost += result.costUsd ?? 0
      console.log(
        `  [${rep + 1}/${REPS}]: entities=${result.entities.length} domains=${result.domains.length} ` +
          `correct=${result.score?.structurallyCorrect ?? "n/a"} cost=${result.costUsd ?? "n/a"}${result.error ? ` FAILED: ${result.error}` : ""}`,
      )
    }

    records.push({
      id: puzzle.id,
      sourceOutcome: puzzle.outcome,
      hasGroundTruth: groundTruthFor(puzzle.id) !== undefined,
      reps,
      consistency: selfConsistency(reps),
      scoreSummary: summarizeScores(reps),
    })
    await writeFile(outPath, JSON.stringify(records, null, 2))
  }

  const byOutcome = new Map<string, { correct: number; total: number }>()
  for (const r of records as { sourceOutcome: string; reps: readonly VariantResult[] }[]) {
    const bucket = byOutcome.get(r.sourceOutcome) ?? { correct: 0, total: 0 }
    for (const rep of r.reps) {
      if (rep.score === undefined) continue
      bucket.total += 1
      if (rep.score.structurallyCorrect) bucket.correct += 1
    }
    byOutcome.set(r.sourceOutcome, bucket)
  }

  console.log(`\nWrote ${records.length} records to ${outPath.pathname}`)
  console.log("\nStructural correctness by source solve outcome:")
  for (const [outcome, { correct, total }] of byOutcome) {
    console.log(`  ${outcome}: ${correct}/${total}`)
  }
  console.log(`\nTotal spend this run: $${grandTotalCost.toFixed(4)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
