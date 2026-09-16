// SPIKE-013 §2 step 5: the billed run for the 4th vocabulary-construction variant —
// "post-hoc" transcription of an already-completed direct-solve trace (see
// lib/post-hoc-vocabulary.ts for the design rationale). Stage 1 (solving) is NOT re-run: it's
// read from the already-collected, already-paid-for eval/results/*.json produced by
// `direct-solve` on 2026-09-15. Only Stage 2 (transcription) spends anything here.
//
// Usage: node --env-file-if-exists=.env design/spikes/SPIKE-013-vocabulary-construction-isolation/scripts/run-post-hoc.ts [resultsFile]
// REPS=<n> overrides the default of 3 — reps here re-run the TRANSCRIPTION call against the SAME
// fixed trace, so they measure transcription self-consistency, not solve-time randomness.

import { writeFile, mkdir } from "node:fs/promises"
import { loadPuzzleProse } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { extractPostHocVocabulary, type PostHocResult } from "./lib/post-hoc-vocabulary.ts"
import { scoreVocabulary, type ScoreResult } from "./lib/score.ts"
import { embeddingSemanticMatch } from "./lib/semantic-match.ts"
import { groundTruthFor } from "./lib/ground-truth.ts"

const TRANSCRIBER_MODEL = "openai/gpt-4o-mini"
const REPS = Number(process.env.REPS ?? 3)

// Default: the gpt-4o-mini direct-solve run — the population with REAL failures already in
// hand (9/14 MATCH, 5 MISMATCH/other), which is what actually lets this variant test whether
// vocabulary shape survives a solve that goes wrong. The frontier run (13/14 MATCH) is available
// as a secondary/confirmatory check but is far less informative for that specific hypothesis,
// since it's almost all correct solves already.
const DEFAULT_RESULTS_FILE = new URL("../../../../eval/results/2026-09-15T14-59-37-368Z.json", import.meta.url)

interface SourceRecord {
  readonly id: string
  readonly outcome: string
  readonly resolvedModel: string
  readonly extractedCsp: { readonly directSolution?: string }
}

interface SourceFile {
  readonly puzzles: readonly SourceRecord[]
}

interface RepRecord extends PostHocResult {
  readonly score: ScoreResult | undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Same lesson as run-comparison.ts's withRetry (found live 2026-09-15): a transient provider
 * error must not cost every already-collected puzzle's data. */
async function withRetry(label: string, fn: () => Promise<PostHocResult>): Promise<PostHocResult> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fn()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`  ${label}: attempt ${attempt} failed (${message.slice(0, 150)})`)
      if (attempt === 2) return { entities: [], domains: [], costUsd: undefined, calls: 0, ok: false, error: message.slice(0, 300) }
      await sleep(2000)
    }
  }
  return { entities: [], domains: [], costUsd: undefined, calls: 0, ok: false, error: "unreachable" }
}

/** Entity-axis-size-set and domain-name-set agreement across reps of the SAME fixed trace —
 * measures whether transcription itself is deterministic, independent of correctness. */
function selfConsistency(reps: readonly RepRecord[]): { readonly entityAxisAgreement: string; readonly domainSetAgreement: string } {
  const sizeSetSignature = (r: RepRecord) =>
    [...new Set(r.entities.map((e) => e.type))].map((t) => r.entities.filter((e) => e.type === t).length).sort((a, b) => a - b).join(",")
  const domainSetSignature = (r: RepRecord) => [...new Set(r.domains.map((d) => d.variable.toLowerCase()))].sort().join(",")
  const tally = (sigs: readonly string[]) => {
    const counts = new Map<string, number>()
    for (const s of sigs) counts.set(s, (counts.get(s) ?? 0) + 1)
    const max = Math.max(...counts.values())
    return `${max}/${sigs.length}`
  }
  return { entityAxisAgreement: tally(reps.map(sizeSetSignature)), domainSetAgreement: tally(reps.map(domainSetSignature)) }
}

function summarizeScores(reps: readonly RepRecord[]) {
  const scored = reps.map((r) => r.score).filter((s): s is ScoreResult => s !== undefined)
  if (scored.length === 0) return undefined
  const correct = scored.filter((s) => s.structurallyCorrect).length
  const totalCost = reps.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
  return { structurallyCorrectRate: `${correct}/${scored.length}`, totalCost }
}

async function main(): Promise<void> {
  const resultsFileArg = process.argv[2]
  const resultsFile = resultsFileArg !== undefined ? new URL(resultsFileArg, `file://${process.cwd()}/`) : DEFAULT_RESULTS_FILE

  const raw = await (await import("node:fs/promises")).readFile(resultsFile, "utf8")
  const sourceFile = JSON.parse(raw) as SourceFile

  const records: unknown[] = []
  let grandTotalCost = 0
  const outDir = new URL("results/", import.meta.url)
  await mkdir(outDir, { recursive: true })
  const outPath = new URL(`post-hoc-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, outDir)

  for (const puzzle of sourceFile.puzzles) {
    const trace = puzzle.extractedCsp?.directSolution
    if (typeof trace !== "string" || trace.trim() === "") {
      console.log(`\n=== ${puzzle.id}: no direct-solve trace to transcribe (skipped) ===`)
      continue
    }
    console.log(`\n=== ${puzzle.id} (source outcome: ${puzzle.outcome}, ${groundTruthFor(puzzle.id) !== undefined ? "scored" : "consistency only"}) ===`)
    const { prose } = await loadPuzzleProse(puzzle.id)

    const reps: RepRecord[] = []
    for (let rep = 0; rep < REPS; rep++) {
      const result = await withRetry("post-hoc", () => extractPostHocVocabulary(TRANSCRIBER_MODEL, prose, trace))
      grandTotalCost += result.costUsd ?? 0
      const score = result.ok ? await scoreVocabulary(puzzle.id, result.entities, result.domains, embeddingSemanticMatch) : undefined
      reps.push({ ...result, score })
      console.log(
        `  [${rep + 1}/${REPS}]: entities=${result.entities.length} domains=${result.domains.length} ` +
          `correct=${score?.structurallyCorrect ?? "n/a"} cost=${result.costUsd ?? "n/a"}${result.ok ? "" : ` FAILED: ${result.error}`}`,
      )
    }

    records.push({
      id: puzzle.id,
      sourceOutcome: puzzle.outcome,
      sourceModel: puzzle.resolvedModel,
      hasGroundTruth: groundTruthFor(puzzle.id) !== undefined,
      reps,
      consistency: selfConsistency(reps),
      scoreSummary: summarizeScores(reps),
    })
    await writeFile(outPath, JSON.stringify(records, null, 2))
  }

  // Break the correctness rate down by the SOURCE solve's own outcome — the whole point of this
  // variant: does vocabulary shape stay right even when the solve that produced the trace was
  // wrong? A flat aggregate would hide exactly the comparison that matters.
  const byOutcome = new Map<string, { correct: number; total: number }>()
  for (const r of records as { sourceOutcome: string; reps: readonly RepRecord[] }[]) {
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
