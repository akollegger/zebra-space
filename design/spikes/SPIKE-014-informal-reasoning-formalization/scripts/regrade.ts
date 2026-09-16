// Re-grades an existing SPIKE-014 result file against the CURRENT grader (post grader-fix
// commit "fix(grader): fold case and separator style before comparing tokens"), without any new
// LLM calls: every rep already stored its final `mzn` text, so this only re-runs solve() (free,
// local, deterministic) and re-dispatches through the same gradeSolved() the original runner
// used. Reports the delta so a corrected MATCH count can replace a stale one in SPIKE.md without
// mutating the original committed result file (kept as the historical record of what actually
// ran).
//
// Usage: node --env-file-if-exists=.env design/spikes/SPIKE-014-informal-reasoning-formalization/scripts/regrade.ts <resultFile> [resultFile...]

import { readFile } from "node:fs/promises"
import { Effect } from "effect"
import { solve } from "../../../../src/solver/solve.ts"
import { loadAnswerKeys } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { gradeSolved, recoverEntityKeyedArrays } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/grade.ts"
import type { ExtractedCsp } from "../../../../src/extraction/types.ts"
import type { SolveResult } from "../../../../src/solver/types.ts"

interface StoredRep {
  readonly outcome: string
  readonly verdict: string
  readonly mzn?: string
  readonly extractedCsp?: ExtractedCsp
}
interface StoredRecord {
  readonly id: string
  readonly reps: readonly StoredRep[]
}

async function regradeFile(path: string, answerKeys: Awaited<ReturnType<typeof loadAnswerKeys>>): Promise<void> {
  const raw = await readFile(path, "utf8")
  const records = JSON.parse(raw) as readonly StoredRecord[]

  let oldMatch = 0
  let newMatch = 0
  let total = 0
  const changes: string[] = []

  for (const record of records) {
    for (let i = 0; i < record.reps.length; i++) {
      const rep = record.reps[i]!
      total += 1
      if (rep.verdict === "MATCH") oldMatch += 1

      if (typeof rep.mzn !== "string") {
        // No mzn stored (FORMALIZE_FAILED / SOLVE_ERROR before ever producing a model) —
        // grading can't change without re-running the LLM call, so carry the old verdict.
        if (rep.verdict === "MATCH") newMatch += 1
        continue
      }

      const solved = await Effect.runPromise(
        solve({ model: rep.mzn }).pipe(
          Effect.map((r) => ({ ok: true as const, r })),
          Effect.catch(() => Effect.succeed({ ok: false as const })),
        ),
      )
      if (!solved.ok) {
        // Re-solve failed where the original run succeeded — treat conservatively as no change
        // rather than silently flipping a MATCH to something else; flag it for manual look.
        if (rep.verdict === "MATCH") newMatch += 1
        changes.push(`  ${record.id} rep${i}: re-solve FAILED on stored mzn (kept old verdict ${rep.verdict})`)
        continue
      }

      const result: SolveResult = solved.r
      const forGrading = result._tag === "UniquelySolvable" && rep.extractedCsp !== undefined ? { ...result, assignment: recoverEntityKeyedArrays(record.id, result.assignment, rep.extractedCsp) } : result
      const graded = gradeSolved(record.id, answerKeys[record.id], forGrading)
      if (graded.verdict === "MATCH") newMatch += 1
      if (graded.verdict !== rep.verdict) {
        changes.push(`  ${record.id} rep${i}: ${rep.verdict} -> ${graded.verdict} (${graded.detail})`)
      }
    }
  }

  console.log(`\n=== ${path} ===`)
  console.log(`MATCH: ${oldMatch}/${total} (old) -> ${newMatch}/${total} (regraded)`)
  if (changes.length > 0) {
    console.log("Changes:")
    for (const c of changes) console.log(c)
  } else {
    console.log("No verdict changes.")
  }
}

async function main(): Promise<void> {
  const paths = process.argv.slice(2)
  if (paths.length === 0) {
    console.error("Usage: regrade.ts <resultFile> [resultFile...]")
    process.exit(1)
  }
  const answerKeys = await loadAnswerKeys()
  for (const path of paths) {
    await regradeFile(path, answerKeys)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
