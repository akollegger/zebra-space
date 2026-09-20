// SPIKE-016 sub-question 1 driver. Runs the outcome-framing gate against the FULL current
// answer-key catalog (39 puzzles as of this run, not just the historical 14-puzzle sample this
// spike line originally used elsewhere) — a puzzle-type gate is puzzle-agnostic, this costs
// nothing extra to run against every puzzle already on disk, and more data is strictly better
// for a classification accuracy read given how imbalanced the classes are.
// Run: node --env-file-if-exists=.env
//   design/spikes/SPIKE-016-typesafe-jev-evaluation/scripts/run-outcome-framing-gate.ts

import { readFile, writeFile } from "node:fs/promises"
import { loadPuzzleProse } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { classifyOutcomeFraming, type OutcomeClass } from "./lib/outcome-framing-gate.ts"

const ANSWER_KEYS_PATH = new URL("../../../../eval/answer-keys.json", import.meta.url)

async function main(): Promise<void> {
  const raw = JSON.parse(await readFile(ANSWER_KEYS_PATH, "utf8")) as Record<string, { readonly outcome?: string }>
  const { $comment: _ignored, ...entries } = raw
  const puzzleIds = Object.keys(entries)
  console.log(`Classifying outcome framing for ${puzzleIds.length} puzzles...`)

  const results = []
  for (const puzzleId of puzzleIds) {
    const expected = (entries[puzzleId]!.outcome ?? "determinate") as OutcomeClass
    const { prose } = await loadPuzzleProse(puzzleId)
    const result = await classifyOutcomeFraming(puzzleId, prose, expected)
    results.push(result)
    const correct = result.predicted === expected
    console.log(`${puzzleId}: expected=${expected} predicted=${result.predicted ?? `ERROR: ${result.error}`} ${result.predicted !== undefined ? (correct ? "CORRECT" : "WRONG") : ""}`)
  }

  const scored = results.filter((r) => r.predicted !== undefined)
  const overallAccuracy = scored.length > 0 ? scored.filter((r) => r.predicted === r.expected).length / scored.length : undefined

  const perClass: Record<string, { correct: number; total: number }> = {}
  for (const r of scored) {
    perClass[r.expected] ??= { correct: 0, total: 0 }
    perClass[r.expected]!.total += 1
    if (r.predicted === r.expected) perClass[r.expected]!.correct += 1
  }

  const confusion: Record<string, Record<string, number>> = {}
  for (const r of scored) {
    confusion[r.expected] ??= {}
    confusion[r.expected]![r.predicted!] = (confusion[r.expected]![r.predicted!] ?? 0) + 1
  }

  const summary = {
    total: results.length,
    scored: scored.length,
    errors: results.length - scored.length,
    overallAccuracy,
    perClass,
    confusion,
    totalLatencyMs: results.reduce((s, r) => s + r.latencyMs, 0),
  }
  console.log("\nSummary:", JSON.stringify(summary, null, 2))

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const outPath = new URL(`results/outcome-framing-gate-${timestamp}.json`, import.meta.url)
  await writeFile(outPath, JSON.stringify({ summary, results }, null, 2))
  console.log(`\nWrote ${outPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
