// SPIKE-014 §2 step 3: the billed run for `formalize-json`. Stage 1 (solving) is NOT re-run —
// read from the already-collected, already-paid-for eval/results/*.json produced by
// `direct-solve` on 2026-09-15. Only Stage 2 (formalization) spends anything here; verification
// (compile -> solve -> grade) reuses the existing, unmodified production pipeline, mirroring
// SPIKE-012's run-comparison.ts sequence exactly (same compileSafely/solveSafely/gradeAgainstKey
// shape) so this compares directly against full-critic's and the per-clue variants' already-
// recorded numbers with zero new grading code.
//
// Usage: node --env-file-if-exists=.env design/spikes/SPIKE-014-informal-reasoning-formalization/scripts/run-formalize-json.ts [resultsFile]
// REPS=<n> overrides the default of 3 — reps here re-run the FORMALIZATION call against the SAME
// fixed trace, so they measure formalization self-consistency, not solve-time randomness (same
// framing as SPIKE-013's post-hoc/post-hoc-shaped runners).

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { Effect } from "effect"
import { compile } from "../../../../src/compiler/compile.ts"
import { solve } from "../../../../src/solver/solve.ts"
import { loadAnswerKeys, loadPuzzleProse } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { gradeSolved, recoverEntityKeyedArrays } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/grade.ts"
import { formalizeToExtractedCsp } from "./lib/formalize-json.ts"
import type { ExtractedCsp } from "../../../../src/extraction/types.ts"
import type { SolveResult, SolverError } from "../../../../src/solver/types.ts"

const MODEL = "openai/gpt-4o-mini"
const REPS = Number(process.env.REPS ?? 3)

// Default: the gpt-4o-mini direct-solve run — same choice SPIKE-013's post-hoc/post-hoc-shaped
// made, since it's the population with real MISMATCH cases already in hand (9/14 MATCH, 5
// MISMATCH/other) rather than the frontier run's near-ceiling 13/14.
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
  readonly extractedCsp?: unknown
  readonly mzn?: string | null
}

/** Mirrors SPIKE-012 run-comparison.ts's own (unexported) solveErrorDetail, itself mirroring
 * src/eval/harness.ts's private toSolveError. */
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

async function gradeAgainstKey(
  puzzleId: string,
  answerKeys: Awaited<ReturnType<typeof loadAnswerKeys>>,
  extractedCsp: ExtractedCsp,
  solveResult: SolveResult | undefined,
): Promise<{ readonly verdict: string; readonly detail: string }> {
  if (solveResult === undefined) return { verdict: "N/A", detail: "no solve result" }
  const recovered = solveResult._tag === "UniquelySolvable" ? { ...solveResult, assignment: recoverEntityKeyedArrays(puzzleId, solveResult.assignment, extractedCsp) } : solveResult
  return gradeSolved(puzzleId, answerKeys[puzzleId], recovered)
}

async function runOne(puzzleId: string, answerKeys: Awaited<ReturnType<typeof loadAnswerKeys>>, prose: string, trace: string): Promise<RepOutcome> {
  const formalized = await formalizeToExtractedCsp(MODEL, prose, trace)
  if (!formalized.ok || formalized.extractedCsp === undefined) {
    return { outcome: "FORMALIZE_FAILED", detail: formalized.error ?? "unknown", verdict: "N/A", gradeDetail: "", costUsd: formalized.costUsd }
  }
  const extractedCsp = formalized.extractedCsp

  const compiled = await Effect.runPromise(
    compile(extractedCsp).pipe(
      Effect.map((mzn) => ({ ok: true as const, mzn })),
      Effect.catch((e) => Effect.succeed({ ok: false as const, reason: e.reason })),
    ),
  )
  if (!compiled.ok) {
    return { outcome: "COMPILE_FAILED", detail: compiled.reason, verdict: "N/A", gradeDetail: "", costUsd: formalized.costUsd, extractedCsp }
  }

  const solved = await Effect.runPromise(
    solve({ model: compiled.mzn }).pipe(
      Effect.map((r) => ({ ok: true as const, r })),
      Effect.catch((e) => Effect.succeed({ ok: false as const, detail: solveErrorDetail(e) })),
    ),
  )
  if (!solved.ok) {
    return { outcome: "SOLVE_ERROR", detail: solved.detail, verdict: "N/A", gradeDetail: "", costUsd: formalized.costUsd, extractedCsp, mzn: compiled.mzn }
  }

  const grade = await gradeAgainstKey(puzzleId, answerKeys, extractedCsp, solved.r)
  return { outcome: classify(solved.r), detail: "", verdict: grade.verdict, gradeDetail: grade.detail, costUsd: formalized.costUsd, extractedCsp, mzn: compiled.mzn }
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
  const outPath = new URL(`formalize-json-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, outDir)

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
