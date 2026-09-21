// SPIKE-016 sub-question 2 driver. Replays Jev's two-step select-then-judge check against
// SPIKE-014's already-collected formalize-mzn drafts for PZL-0010 and PZL-0038 (SPIKE.md §5.4's
// three hand-diagnosed silent failures), checking EVERY rep (not just the ones known to fail) so
// MATCH reps serve as a false-positive control — flagging a clue in an already-correct model
// would be as bad as missing a real failure. Zero new frontier-model spend.
// Run: node --env-file-if-exists=.env
//   design/spikes/SPIKE-016-typesafe-jev-evaluation/scripts/run-per-clue-fidelity.ts

import { readFile, writeFile } from "node:fs/promises"
import { loadPuzzleProse, splitClues } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { totalUsage } from "./lib/jev-client.ts"
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
    const { clues, preamble, decomposable } = splitClues(prose)
    if (!decomposable) {
      console.log(`${record.id}: prose not decomposable into numbered clues — skipping`)
      continue
    }
    // Copilot review (PR #37, comment on this file): a global/implicit constraint stated in the
    // PREAMBLE rather than any numbered clue (PZL-0038's "one animal per pen", the exact
    // `alldifferent(pens)` SPIKE-014 SPIKE.md §5.4 diagnosed as silently dropped) was previously
    // never checked at all — `splitClues` returns `preamble` separately and it was discarded.
    // Checked as its own item, tagged `isPreamble`, so Findings can distinguish "a numbered clue
    // was dropped" from "a global invariant stated only in the setup was dropped" rather than
    // conflating them.
    const checkItems: readonly { readonly text: string; readonly isPreamble: boolean }[] = [
      { text: preamble, isPreamble: true },
      ...clues.map((clue) => ({ text: clue, isPreamble: false })),
    ]
    for (const [repIndex, rep] of record.reps.entries()) {
      const constraintLines = extractConstraintLines(rep.mzn)
      console.log(`\n${record.id} rep ${repIndex} (outcome=${rep.outcome}, verdict=${rep.verdict ?? "n/a"}, ${constraintLines.length} constraint lines, ${clues.length} clues + preamble):`)
      for (const item of checkItems) {
        const localization = await checkClueLocalization(item.text, constraintLines)
        const flagged = localization.selectedIndices.length === 0 || (localization.fidelityNoul !== undefined && localization.fidelityNoul < 0.5)
        results.push({ puzzleId: record.id, repIndex, repOutcome: rep.outcome, repVerdict: rep.verdict, clue: item.text, isPreamble: item.isPreamble, localization, flagged })
        const label =
          localization.error !== undefined
            ? `ERROR: ${localization.error}`
            : localization.selectedIndices.length === 0
              ? "NO MATCHING LINE (possible drop)"
              : `line ${localization.selectedIndices[0]} fidelity=${localization.fidelityNoul?.toFixed(3)}`
        const tag = item.isPreamble ? "[preamble]" : "[clue]    "
        console.log(`  ${flagged ? "[FLAGGED]" : "[ok]     "} ${tag} "${item.text.trim().slice(0, 70)}..." -> ${label}`)
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
    totalUsage: totalUsage(results.map((r) => r.localization)),
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
