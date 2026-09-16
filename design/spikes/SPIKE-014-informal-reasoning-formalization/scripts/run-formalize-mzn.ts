// SPIKE-014 §2 step 3 (2nd variant): the billed run for `formalize-mzn`. Same Stage 1 reuse as
// run-formalize-json.ts (already-collected direct-solve traces, zero re-solve cost). Stage 2
// formalizes straight into MiniZinc text; verification skips compile() entirely and goes
// straight into solve() (SolveRequest.model is a raw MiniZinc string with no dependency on
// ExtractedCsp — confirmed before scoping this variant in, SPIKE.md §1). Grading has NO
// recoverEntityKeyedArrays step — there's no ExtractedCsp to recover FROM for this variant, so
// grading works directly off whatever variable names the model itself chose. An honest,
// named limitation for puzzles whose answer key needs entity-id keying (row-keyed mappings);
// the four PARALLEL_ARRAY_PUZZLES need no such keying and should grade normally.
//
// Usage: node --env-file-if-exists=.env design/spikes/SPIKE-014-informal-reasoning-formalization/scripts/run-formalize-mzn.ts [resultsFile]
// REPS=<n> overrides the default of 3.

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { Effect } from "effect"
import { solve } from "../../../../src/solver/solve.ts"
import { loadAnswerKeys, loadPuzzleProse } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { gradeSolved } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/grade.ts"
import { formalizeToMinizinc } from "./lib/formalize-mzn.ts"
import type { SolveResult, SolverError } from "../../../../src/solver/types.ts"

const MODEL = "openai/gpt-4o-mini"
const REPS = Number(process.env.REPS ?? 3)

// Same source file formalize-json used — direct comparison on the identical Stage-1 traces.
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
}

/** Mirrors run-formalize-json.ts's own copy, itself mirroring SPIKE-012's. */
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

async function runOne(puzzleId: string, answerKeys: Awaited<ReturnType<typeof loadAnswerKeys>>, prose: string, trace: string): Promise<RepOutcome> {
  const formalized = await formalizeToMinizinc(MODEL, prose, trace)
  if (!formalized.ok || formalized.mzn === undefined) {
    return { outcome: "FORMALIZE_FAILED", detail: formalized.error ?? "unknown", verdict: "N/A", gradeDetail: "", costUsd: formalized.costUsd }
  }
  const mzn = formalized.mzn

  const solved = await Effect.runPromise(
    solve({ model: mzn }).pipe(
      Effect.map((r) => ({ ok: true as const, r })),
      Effect.catch((e) => Effect.succeed({ ok: false as const, detail: solveErrorDetail(e) })),
    ),
  )
  if (!solved.ok) {
    return { outcome: "SOLVE_ERROR", detail: solved.detail, verdict: "N/A", gradeDetail: "", costUsd: formalized.costUsd, mzn }
  }

  // No recoverEntityKeyedArrays — no ExtractedCsp exists for this variant to recover FROM.
  const grade = gradeSolved(puzzleId, answerKeys[puzzleId], solved.r)
  return { outcome: classify(solved.r), detail: "", verdict: grade.verdict, gradeDetail: grade.detail, costUsd: formalized.costUsd, mzn }
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
  const outPath = new URL(`formalize-mzn-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, outDir)

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
      console.log(`  [${rep + 1}/${REPS}]: ${result.outcome} verdict=${result.verdict} cost=${result.costUsd ?? "n/a"}${result.detail ? ` (${result.detail.slice(0, 150)})` : ""}`)
    }

    records.push({ id: puzzle.id, sourceOutcome: puzzle.outcome, reps })
    await writeFile(outPath, JSON.stringify(records, null, 2))
  }

  const tally = new Map<string, number>()
  let matchCount = 0
  let totalReps = 0
  for (const r of records as { reps: readonly RepOutcome[] }[]) {
    for (const rep of r.reps) {
      totalReps += 1
      tally.set(rep.outcome, (tally.get(rep.outcome) ?? 0) + 1)
      if (rep.verdict === "MATCH") matchCount += 1
    }
  }

  console.log(`\nWrote ${records.length} records to ${outPath.pathname}`)
  console.log(`\nMATCH: ${matchCount}/${totalReps}`)
  console.log("\nOutcome tally:")
  for (const [outcome, count] of tally) console.log(`  ${outcome}: ${count}/${totalReps}`)
  console.log(`\nTotal spend this run: $${grandTotalCost.toFixed(4)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
