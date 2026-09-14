// SPIKE-010: runs only the NEW variant (per-clue, full-prose context) against the 14-puzzle
// sample, and diffs against SPIKE-008's already-committed, already-paid-for `per-clue` baseline
// read directly from its results/ JSON — no re-running SPIKE-008's per-clue or full-critic.
//
// Usage: node --env-file-if-exists=.env design/spikes/SPIKE-010-full-prose-per-clue-context/scripts/run-comparison.ts [puzzleId ...]

import { writeFile, mkdir, readFile } from "node:fs/promises"
import { Effect } from "effect"
import { compile } from "../../../../src/compiler/compile.ts"
import { solve } from "../../../../src/solver/solve.ts"
import type { SolveResult, SolverError } from "../../../../src/solver/types.ts"
import type { ExtractedCsp } from "../../../../src/extraction/types.ts"
import { extractFullProsePerClue } from "./lib/full-prose-extract.ts"
import { loadAnswerKeys, loadPuzzleProse } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { gradeSolved, recoverEntityKeyedArrays } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/grade.ts"

const MODEL = "openai/gpt-4o-mini"
const BASELINE_PATH = "../../SPIKE-008-per-clue-tool-call-decomposition/results/comparison-2026-09-14T14-05-07-883Z.json"

const SAMPLE = [
  "PZL-0002", "PZL-0004", "PZL-0022", "PZL-0028", "PZL-0033", "PZL-0038", "PZL-0015", "PZL-0018",
  "PZL-0001", "PZL-0003", "PZL-0007", "PZL-0010", "PZL-0011", "PZL-0012",
]

function classify(solveResult: SolveResult): string {
  return solveResult._tag === "Unsatisfiable" ? "SOLVE_UNSATISFIABLE" : solveResult._tag === "MultiplySatisfiable" ? "SOLVE_MULTIPLY_SATISFIABLE" : "SOLVE_UNIQUE"
}

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

async function compileAndSolve(extractedCsp: ExtractedCsp) {
  const compiled = await Effect.runPromise(
    compile(extractedCsp).pipe(
      Effect.map((mzn) => ({ ok: true as const, mzn })),
      Effect.catch((e) => Effect.succeed({ ok: false as const, reason: e.reason })),
    ),
  )
  if (!compiled.ok) return { outcome: "COMPILE_FAILED", detail: compiled.reason, mzn: null as string | null, solveResult: undefined as SolveResult | undefined }
  const solved = await Effect.runPromise(
    solve({ model: compiled.mzn }).pipe(
      Effect.map((r) => ({ ok: true as const, r })),
      Effect.catch((e) => Effect.succeed({ ok: false as const, detail: solveErrorDetail(e) })),
    ),
  )
  if (!solved.ok) return { outcome: "SOLVE_ERROR", detail: solved.detail, mzn: compiled.mzn, solveResult: undefined as SolveResult | undefined }
  return { outcome: classify(solved.r), detail: "", mzn: compiled.mzn, solveResult: solved.r as SolveResult | undefined }
}

async function main(): Promise<void> {
  const puzzleIds = process.argv.slice(2).length > 0 ? process.argv.slice(2) : SAMPLE
  const answerKeys = await loadAnswerKeys()
  const baseline = JSON.parse(await readFile(new URL(BASELINE_PATH, import.meta.url), "utf8")) as ReadonlyArray<{
    id: string
    variants: Record<string, { outcome: string; verdict: string; costUsd: number | undefined; totalCalls: number; grade: { verdict: string; detail: string } }>
  }>
  const baselineById = new Map(baseline.map((r) => [r.id, r.variants]))

  const records: unknown[] = []

  for (const puzzleId of puzzleIds) {
    console.log(`\n=== ${puzzleId} ===`)
    const { file, prose } = await loadPuzzleProse(puzzleId)

    const result = await extractFullProsePerClue(prose, MODEL)
    const solved = await compileAndSolve(result.extractedCsp)
    const recovered =
      solved.solveResult !== undefined && solved.solveResult._tag === "UniquelySolvable"
        ? { ...solved.solveResult, assignment: recoverEntityKeyedArrays(solved.solveResult.assignment, result.extractedCsp) }
        : solved.solveResult
    const grade = solved.solveResult !== undefined ? gradeSolved(puzzleId, answerKeys[puzzleId], recovered!) : { verdict: "N/A", detail: solved.detail }

    const baselineVariants = baselineById.get(puzzleId)
    const pcBaseline = baselineVariants?.["per-clue"]
    const fcBaseline = baselineVariants?.["full-critic"]

    console.log(`  per-clue+full-prose: ${solved.outcome} calls=${result.totalCalls} cost=${result.actualCostUsd ?? "n/a"} grade=${grade.verdict} decomposable=${result.decomposable}`)
    console.log(`  (baseline) per-clue: ${pcBaseline?.outcome} grade=${pcBaseline?.grade.verdict ?? "?"} | full-critic: ${fcBaseline?.outcome}`)

    records.push({
      id: puzzleId,
      file,
      variants: {
        "per-clue+full-prose": {
          outcome: solved.outcome,
          totalCalls: result.totalCalls,
          costUsd: result.actualCostUsd,
          detail: solved.detail,
          extractedCsp: result.extractedCsp,
          mzn: solved.mzn,
          decomposable: result.decomposable,
          grade,
        },
        "per-clue (SPIKE-008 baseline)": pcBaseline,
        "full-critic (SPIKE-008 baseline)": fcBaseline,
      },
    })
  }

  const outDir = new URL("../results/", import.meta.url)
  await mkdir(outDir, { recursive: true })
  const outPath = new URL(`comparison-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, outDir)
  await writeFile(outPath, JSON.stringify(records, null, 2))
  console.log(`\nWrote ${records.length} records to ${outPath.pathname}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
