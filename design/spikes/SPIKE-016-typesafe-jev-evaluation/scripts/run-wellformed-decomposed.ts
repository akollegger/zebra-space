// SPIKE-016 sub-question 4 driver. Replays Jev (3 decomposed Nouls) against SPIKE-015's
// already-collected substitution results, comparing against the recorded majority-of-3 verdict.
// Run: node --env-file-if-exists=.env
//   design/spikes/SPIKE-016-typesafe-jev-evaluation/scripts/run-wellformed-decomposed.ts

import { readdir, readFile, writeFile } from "node:fs/promises"
import { loadPuzzleProse } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { totalUsage } from "./lib/jev-client.ts"
import { judgeWellFormedDecomposed } from "./lib/wellformed-decomposed.ts"

const RESULTS_DIR = new URL("../../SPIKE-015-domain-substitution/scripts/results/", import.meta.url)

interface Spike015Rep {
  readonly wellFormed?: boolean
  readonly substitutedProse?: string
  readonly mapping?: readonly { readonly oldValue: string; readonly newValue: string }[]
  // Present (length >= 2) only on a genuine judgeSubstitutionMajority run (SPIKE-015's
  // judge-substitution.ts); absent on the project's earlier single-judge result files (e.g.
  // domain-substitution-openai-gpt-4o-mini-2026-09-18T14-13-26-626Z.json). Copilot review (PR
  // #37) found the original loader accepted BOTH shapes, silently mixing a single frontier-model
  // judge's verdict in among the actual majority-of-3 verdicts this sub-question claims to
  // compare against.
  readonly judgeVotes?: readonly unknown[]
}
interface Spike015Record {
  readonly id: string
  readonly reps: readonly Spike015Rep[]
}

/** Deduplicates by `puzzleId|substitutedProse` — the three qualifying result files (a bare
 * frontier-judge run, plus two independent-judge-model runs per SPIKE-015 SPIKE.md §5.9) cover
 * the SAME six puzzles and their outputs collide: 28 of the original 67 qualifying reps were
 * exact repeats of one of 39 distinct items, re-spending Jev on byte-identical input and
 * inflating the §5.2 denominator (Kilo Code review, PR #37). Keeps the FIRST occurrence in
 * file-then-rep order (files sorted for determinism) — one real disagreement exists across
 * duplicates of the same prose (PZL-0003's "lizard-spock-water" item: 2 `false`/3 `true` across
 * its 5 copies, likely reflecting the different judge models across files, not a bug) and is
 * left as-is rather than re-resolved by a second-order vote, since this sub-question compares
 * against WHATEVER majority verdict SPIKE-015 recorded for that occurrence, not an idealized one. */
function dedupeByProse(
  items: readonly { readonly puzzleId: string; readonly rep: Spike015Rep; readonly majorityWellFormed: boolean }[],
): { readonly puzzleId: string; readonly rep: Spike015Rep; readonly majorityWellFormed: boolean }[] {
  const seen = new Set<string>()
  const deduped: { readonly puzzleId: string; readonly rep: Spike015Rep; readonly majorityWellFormed: boolean }[] = []
  for (const item of items) {
    const key = `${item.puzzleId}|${item.rep.substitutedProse}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }
  return deduped
}

async function loadReplayItems(): Promise<{ readonly puzzleId: string; readonly rep: Spike015Rep; readonly majorityWellFormed: boolean }[]> {
  const files = (await readdir(RESULTS_DIR)).filter((f) => f.endsWith(".json")).sort()
  const items: { readonly puzzleId: string; readonly rep: Spike015Rep; readonly majorityWellFormed: boolean }[] = []
  let skippedNonMajority = 0
  for (const file of files) {
    const raw = JSON.parse(await readFile(new URL(file, RESULTS_DIR), "utf8")) as Spike015Record[]
    for (const record of raw) {
      for (const rep of record.reps) {
        if (rep.wellFormed === undefined || rep.substitutedProse === undefined) continue
        if (!Array.isArray(rep.judgeVotes) || rep.judgeVotes.length < 2) {
          skippedNonMajority += 1
          continue
        }
        items.push({ puzzleId: record.id, rep, majorityWellFormed: rep.wellFormed })
      }
    }
  }
  if (skippedNonMajority > 0) console.log(`Skipped ${skippedNonMajority} rep(s) without a recorded majority-of-3+ judgeVotes (legacy single-judge records).`)
  const deduped = dedupeByProse(items)
  if (deduped.length < items.length) console.log(`Deduplicated ${items.length - deduped.length} repeated (puzzleId, substitutedProse) item(s) across overlapping result files.`)
  return deduped
}

async function main(): Promise<void> {
  const items = await loadReplayItems()
  console.log(`Replaying ${items.length} substitution reps with mapping+substitutedProse recorded...`)

  const proseCache = new Map<string, string>()
  const results = []
  for (const item of items) {
    if (!proseCache.has(item.puzzleId)) {
      const { prose } = await loadPuzzleProse(item.puzzleId)
      proseCache.set(item.puzzleId, prose)
    }
    const originalProse = proseCache.get(item.puzzleId)!
    const verdict = await judgeWellFormedDecomposed(originalProse, item.rep.substitutedProse!, item.rep.mapping ?? [])
    results.push({ puzzleId: item.puzzleId, majorityWellFormed: item.majorityWellFormed, jev: verdict })
    const agree = verdict.wellFormed === item.majorityWellFormed
    console.log(`${item.puzzleId}: majority=${item.majorityWellFormed} jev=${verdict.wellFormed} ${agree ? "AGREE" : "DISAGREE"} ${verdict.error ?? ""}`)
  }

  const scored = results.filter((r) => r.jev.wellFormed !== undefined)
  const agreeing = scored.filter((r) => r.jev.wellFormed === r.majorityWellFormed).length
  const summary = {
    total: results.length,
    scored: scored.length,
    errors: results.length - scored.length,
    agreementRate: scored.length > 0 ? agreeing / scored.length : undefined,
    totalLatencyMs: results.reduce((s, r) => s + r.jev.latencyMs, 0),
    totalUsage: totalUsage(results.map((r) => r.jev)),
  }
  console.log("\nSummary:", JSON.stringify(summary, null, 2))

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const outPath = new URL(`results/wellformed-decomposed-${timestamp}.json`, import.meta.url)
  await writeFile(outPath, JSON.stringify({ summary, results }, null, 2))
  console.log(`\nWrote ${outPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
