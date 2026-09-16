// SPIKE-014 §2 step 6 (3rd variant): the billed run for `formalize-mzn+oracle-repair`. Same
// Stage 1 reuse and Stage 2 (formalizeToMinizinc) as run-formalize-mzn.ts. Adds ONE bounded
// repair round when the first attempt either fails to compile (SOLVE_ERROR, always worth
// repairing) or resolves to Unsatisfiable/MultiplySatisfiable on a puzzle whose answer key
// declares it determinate (other puzzle types can legitimately be non-unique, so repair must not
// fire on solution-count alone).
//
// Usage: node --env-file-if-exists=.env design/spikes/SPIKE-014-informal-reasoning-formalization/scripts/run-formalize-mzn-oracle-repair.ts [resultsFile]
// REPS=<n> overrides the default of 3.

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { Effect } from "effect"
import { solve } from "../../../../src/solver/solve.ts"
import { loadAnswerKeys, loadPuzzleProse } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { gradeSolved } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/grade.ts"
import { formalizeToMinizinc } from "./lib/formalize-mzn.ts"
import { repairMinizinc } from "./lib/mzn-oracle-repair.ts"
import type { AnswerKeyEntry } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import type { SolveResult, SolverError } from "../../../../src/solver/types.ts"

const MODEL = "openai/gpt-4o-mini"
const REPS = Number(process.env.REPS ?? 3)

// Same source file formalize-mzn used — direct comparison on the identical Stage-1 traces.
const DEFAULT_RESULTS_FILE = new URL("../../../../eval/results/2026-09-15T14-59-37-368Z.json", import.meta.url)

interface SourceRecord {
  readonly id: string
  readonly outcome: string
  readonly extractedCsp: { readonly directSolution?: string }
}
interface SourceFile {
  readonly puzzles: readonly SourceRecord[]
}

interface RepOutcome {
  readonly outcome: string
  readonly detail: string
  readonly verdict: string
  readonly gradeDetail: string
  readonly costUsd: number | undefined
  readonly mzn?: string
  readonly repaired: boolean
}

/** Mirrors run-formalize-mzn.ts's own copy. */
function solveErrorDetail(error: SolverError): string {
  switch (error._tag) {
    case "ToolchainUnavailable":
      return `${error._tag}: ${error.message}`
    case "ModelSyntaxError":
      return `${error._tag}: ${error.stderr.slice(0, 200)}`
    case "SolverConfigError":
      return `${error._tag}: solver "${error.solverId}": ${error.stderr.slice(0, 200)}`
    case "Timeout":
      return `${error._tag}: timed out after ${error.timeoutMs}ms`
    case "UnexpectedExit":
      return `${error._tag}: exit ${error.exitCode}: ${error.stderr.slice(0, 200)}`
    case "UnexpectedOutput":
      return `${error._tag}: ${error.message}`
    case "FilesystemError":
      return `${error._tag}: ${error.message}`
  }
}

function classify(result: SolveResult): string {
  return result._tag === "Unsatisfiable" ? "SOLVE_UNSATISFIABLE" : result._tag === "MultiplySatisfiable" ? "SOLVE_MULTIPLY_SATISFIABLE" : "SOLVE_UNIQUE"
}

/** Mirrors grade.ts's own gradeSolved dispatch normalization (an answer-key entry's outcome may
 * be top-level or nested under `answer`; absent means determinate) — needed here separately
 * since repair must not fire on solution-count alone for a puzzle that can legitimately be
 * non-unique (COP, ambiguous, non-problem, subjective). */
function isDeterminate(entry: AnswerKeyEntry | undefined): boolean {
  if (entry === undefined) return true
  const nested = entry.answer !== null && typeof entry.answer === "object" && !Array.isArray(entry.answer) ? (entry.answer as Record<string, unknown>) : undefined
  const effectiveOutcome = entry.outcome ?? (nested?.outcome as string | undefined) ?? "determinate"
  return effectiveOutcome === "determinate"
}

type SolveAttempt = { readonly ok: true; readonly outcome: string; readonly result: SolveResult } | { readonly ok: false; readonly detail: string }

async function trySolve(mzn: string): Promise<SolveAttempt> {
  const solved = await Effect.runPromise(
    solve({ model: mzn }).pipe(
      Effect.map((r) => ({ ok: true as const, r })),
      Effect.catch((e) => Effect.succeed({ ok: false as const, detail: solveErrorDetail(e) })),
    ),
  )
  if (!solved.ok) return { ok: false, detail: solved.detail }
  return { ok: true, outcome: classify(solved.r), result: solved.r }
}

/** Restates SPIKE-014 §5.4's own diagnosed mechanisms as repair guidance — the concrete,
 * observed causes of each outcome class on this catalog, not a generic "try again." */
function describeProblem(attempt: SolveAttempt): string {
  if (!attempt.ok) return `This model failed to compile/solve with the following error:\n${attempt.detail}`
  if (attempt.outcome === "SOLVE_UNSATISFIABLE") {
    return "This model has NO solution (UNSATISFIABLE), but this puzzle should have exactly one valid solution. Review your constraints for one that is too strict, wrong, or contradicts another constraint you wrote elsewhere."
  }
  return "This model has MULTIPLE valid solutions, but this puzzle should have exactly one. You likely omitted a constraint the puzzle actually states — check especially for a missing `alldifferent`, or a compound relational clue you only partially encoded."
}

async function runOne(
  puzzleId: string,
  answerKeys: Awaited<ReturnType<typeof loadAnswerKeys>>,
  prose: string,
  trace: string,
): Promise<RepOutcome> {
  const formalized = await formalizeToMinizinc(MODEL, prose, trace)
  if (!formalized.ok || formalized.mzn === undefined) {
    return { outcome: "FORMALIZE_FAILED", detail: formalized.error ?? "unknown", verdict: "N/A", gradeDetail: "", costUsd: formalized.costUsd, repaired: false }
  }
  let mzn = formalized.mzn
  let totalCost = formalized.costUsd ?? 0
  let repaired = false

  let attempt = await trySolve(mzn)
  const entry = answerKeys[puzzleId]
  const needsRepair = !attempt.ok || (isDeterminate(entry) && (attempt.outcome === "SOLVE_UNSATISFIABLE" || attempt.outcome === "SOLVE_MULTIPLY_SATISFIABLE"))

  if (needsRepair) {
    const repair = await repairMinizinc(MODEL, prose, trace, mzn, describeProblem(attempt))
    totalCost += repair.costUsd ?? 0
    repaired = true
    if (repair.ok && repair.mzn !== undefined) {
      mzn = repair.mzn
      attempt = await trySolve(mzn)
    }
  }

  if (!attempt.ok) {
    return { outcome: "SOLVE_ERROR", detail: attempt.detail, verdict: "N/A", gradeDetail: "", costUsd: totalCost, mzn, repaired }
  }
  const grade = gradeSolved(puzzleId, entry, attempt.result)
  return { outcome: attempt.outcome, detail: "", verdict: grade.verdict, gradeDetail: grade.detail, costUsd: totalCost, mzn, repaired }
}

async function main(): Promise<void> {
  const resultsFileArg = process.argv[2]
  const resultsFile = resultsFileArg !== undefined ? new URL(resultsFileArg, `file://${process.cwd()}/`) : DEFAULT_RESULTS_FILE

  const raw = await readFile(resultsFile, "utf8")
  const sourceFile = JSON.parse(raw) as SourceFile
  const answerKeys = await loadAnswerKeys()

  const records: unknown[] = []
  let grandTotalCost = 0
  const outDir = new URL("results/", import.meta.url)
  await mkdir(outDir, { recursive: true })
  const outPath = new URL(`formalize-mzn-oracle-repair-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, outDir)

  for (const puzzle of sourceFile.puzzles) {
    const trace = puzzle.extractedCsp?.directSolution
    if (typeof trace !== "string" || trace.trim() === "") {
      console.log(`\n=== ${puzzle.id}: no direct-solve trace (skipped) ===`)
      continue
    }
    console.log(`\n=== ${puzzle.id} (source outcome: ${puzzle.outcome}) ===`)
    const { prose } = await loadPuzzleProse(puzzle.id)

    const reps: RepOutcome[] = []
    for (let rep = 0; rep < REPS; rep++) {
      const result = await runOne(puzzle.id, answerKeys, prose, trace)
      reps.push(result)
      grandTotalCost += result.costUsd ?? 0
      console.log(
        `  [${rep + 1}/${REPS}]: ${result.outcome} verdict=${result.verdict} repaired=${result.repaired} cost=${result.costUsd ?? "n/a"}${result.detail ? ` (${result.detail.slice(0, 150)})` : ""}`,
      )
    }

    records.push({ id: puzzle.id, sourceOutcome: puzzle.outcome, reps })
    await writeFile(outPath, JSON.stringify(records, null, 2))
  }

  const tally = new Map<string, number>()
  let matchCount = 0
  let totalReps = 0
  let repairedCount = 0
  let repairedMatchCount = 0
  for (const r of records as { reps: readonly RepOutcome[] }[]) {
    for (const rep of r.reps) {
      totalReps += 1
      tally.set(rep.outcome, (tally.get(rep.outcome) ?? 0) + 1)
      if (rep.verdict === "MATCH") matchCount += 1
      if (rep.repaired) {
        repairedCount += 1
        if (rep.verdict === "MATCH") repairedMatchCount += 1
      }
    }
  }

  console.log(`\nWrote ${records.length} records to ${outPath.pathname}`)
  console.log(`\nMATCH: ${matchCount}/${totalReps}`)
  console.log(`Repair attempted: ${repairedCount}/${totalReps} (of which MATCH after repair: ${repairedMatchCount}/${repairedCount || 1})`)
  console.log("\nOutcome tally:")
  for (const [outcome, count] of tally) console.log(`  ${outcome}: ${count}/${totalReps}`)
  console.log(`\nTotal spend this run: $${grandTotalCost.toFixed(4)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
