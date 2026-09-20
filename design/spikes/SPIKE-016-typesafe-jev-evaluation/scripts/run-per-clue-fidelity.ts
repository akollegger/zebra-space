// SPIKE-016 sub-question 2 driver. Replays Jev's two-step select-then-judge check against
// SPIKE-014's already-collected formalize-mzn drafts for PZL-0010 and PZL-0038 (SPIKE.md §5.4's
// three hand-diagnosed silent failures), checking EVERY rep (not just the ones known to fail) so
// MATCH reps serve as a false-positive control — flagging a clue in an already-correct model
// would be as bad as missing a real failure. Zero new frontier-model spend.
// Run: node --env-file-if-exists=.env
//   design/spikes/SPIKE-016-typesafe-jev-evaluation/scripts/run-per-clue-fidelity.ts

import { readFile, writeFile } from "node:fs/promises"
import { loadPuzzleProse, splitClues } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { checkClueLocalization, extractConstraintLines } from "./lib/per-clue-fidelity.ts"

// The post-fix formalize-mzn run SPIKE-014 SPIKE.md §5.3 reports as this line's best cheap-tier
// result (13/42 MATCH) — the source of the three hand-diagnosed failures in §5.4.
const RESULT_FILE = new URL("../../SPIKE-014-informal-reasoning-formalization/scripts/results/formalize-mzn-2026-09-16T10-53-55-723Z.json", import.meta.url)
const TARGET_PUZZLE_IDS = ["PZL-0010", "PZL-0038"]

interface Spike014Rep {
  readonly outcome: string
  readonly verdict?: string
  readonly mzn: string
}
interface Spike014Record {
  readonly id: string
  readonly reps: readonly Spike014Rep[]
}

async function main(): Promise<void> {
  const raw = JSON.parse(await readFile(RESULT_FILE, "utf8")) as Spike014Record[]
  const targets = raw.filter((r) => TARGET_PUZZLE_IDS.includes(r.id))

  const results = []
  for (const record of targets) {
    const { prose } = await loadPuzzleProse(record.id)
    const { clues, decomposable } = splitClues(prose)
    if (!decomposable) {
      console.log(`${record.id}: prose not decomposable into numbered clues — skipping`)
      continue
    }
    for (const [repIndex, rep] of record.reps.entries()) {
      const constraintLines = extractConstraintLines(rep.mzn)
      console.log(`\n${record.id} rep ${repIndex} (outcome=${rep.outcome}, verdict=${rep.verdict ?? "n/a"}, ${constraintLines.length} constraint lines, ${clues.length} clues):`)
      for (const clue of clues) {
        const localization = await checkClueLocalization(clue, constraintLines)
        const flagged = localization.selectedIndices.length === 0 || (localization.fidelityNoul !== undefined && localization.fidelityNoul < 0.5)
        results.push({ puzzleId: record.id, repIndex, repOutcome: rep.outcome, repVerdict: rep.verdict, clue, localization, flagged })
        const label =
          localization.error !== undefined
            ? `ERROR: ${localization.error}`
            : localization.selectedIndices.length === 0
              ? "NO MATCHING LINE (possible drop)"
              : `line ${localization.selectedIndices[0]} fidelity=${localization.fidelityNoul?.toFixed(3)}`
        console.log(`  ${flagged ? "[FLAGGED]" : "[ok]     "} "${clue.trim().slice(0, 70)}..." -> ${label}`)
      }
    }
  }

  const byOutcome = new Map<string, { flagged: number; total: number }>()
  for (const r of results) {
    const bucket = byOutcome.get(r.repOutcome) ?? { flagged: 0, total: 0 }
    bucket.total += 1
    if (r.flagged) bucket.flagged += 1
    byOutcome.set(r.repOutcome, bucket)
  }
  const summary = {
    totalCluesChecked: results.length,
    byRepOutcome: Object.fromEntries(byOutcome),
    totalLatencyMs: results.reduce((s, r) => s + r.localization.latencyMs, 0),
  }
  console.log("\nSummary (flagged clues per rep outcome — MATCH reps flagged is a false-positive signal):")
  console.log(JSON.stringify(summary, null, 2))

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const outPath = new URL(`results/per-clue-fidelity-${timestamp}.json`, import.meta.url)
  await writeFile(outPath, JSON.stringify({ summary, results }, null, 2))
  console.log(`\nWrote ${outPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
