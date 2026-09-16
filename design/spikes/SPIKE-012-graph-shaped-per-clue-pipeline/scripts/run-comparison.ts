// SPIKE-012: the billed comparison run. Reads SPIKE-011's already-committed, already-paid-for
// `full-critic` baseline directly from SPIKE-008's results directory (the post-both-fixes run)
// rather than re-running it — only this spike's two new variants (`graph-pipeline`,
// `graph-pipeline+oracle-repair`) run and cost money. Same 14-puzzle sample as SPIKE-008/009/
// 010/011. Runs each puzzle n=3 times (not the single sample every prior spike in this line
// used) so this spike's own numbers can distinguish a real effect from run-to-run LLM sampling
// variance — reports the per-puzzle pass RATE, not just one outcome tag.
//
// Usage: node --env-file-if-exists=.env design/spikes/SPIKE-012-graph-shaped-per-clue-pipeline/scripts/run-comparison.ts [puzzleId ...]
// With no args, runs the full 14-puzzle sample. REPS=<n> overrides the default of 3.

import { writeFile, mkdir, readFile } from "node:fs/promises"
import { Effect } from "effect"
import { compile } from "../../../../src/compiler/compile.ts"
import { solve } from "../../../../src/solver/solve.ts"
import { loadAnswerKeys, loadPuzzleProse } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { gradeSolved, recoverEntityKeyedArrays } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/grade.ts"
import { extractGraphPipeline, extractGraphPipelineWithRepair } from "./lib/graph-pipeline-extract.ts"
import type { ExtractedCsp } from "../../../../src/extraction/types.ts"
import type { SolveResult, SolverError } from "../../../../src/solver/types.ts"

const MODEL = "openai/gpt-4o-mini"
const REPS = Number(process.env.REPS ?? 3)

const SAMPLE = [
  "PZL-0002", "PZL-0004", "PZL-0022", "PZL-0028", "PZL-0033", "PZL-0038", "PZL-0015", "PZL-0018",
  "PZL-0001", "PZL-0003", "PZL-0007", "PZL-0010", "PZL-0011", "PZL-0012",
]

// Reused unmodified — SPIKE-011's own post-both-fixes `full-critic` run.
const BASELINE_PATH = new URL(
  "../../SPIKE-008-per-clue-tool-call-decomposition/results/comparison-2026-09-15T11-24-35-879Z.json",
  import.meta.url,
)

interface RepOutcome {
  readonly outcome: string
  readonly detail: string
  readonly verdict: string
  readonly gradeDetail: string
  readonly totalCalls: number
  readonly costUsd: number | undefined
  readonly repairRounds?: number
  readonly extractedCsp?: unknown
  readonly mzn?: string | null
}

/** Mirrors src/eval/harness.ts's own (unexported) toSolveError — SPIKE-008's own auditability
 * lesson (PR #27: a swallowed SolverError makes a SOLVE_ERROR record undiagnosable). */
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

async function runGraphPipelineOnly(puzzleId: string, answerKeys: Awaited<ReturnType<typeof loadAnswerKeys>>, prose: string): Promise<RepOutcome> {
  const result = await extractGraphPipeline(MODEL, prose)
  const compiled = await Effect.runPromise(
    compile(result.extractedCsp).pipe(
      Effect.map((mzn) => ({ ok: true as const, mzn })),
      Effect.catch((e) => Effect.succeed({ ok: false as const, reason: e.reason })),
    ),
  )
  if (!compiled.ok) {
    return { outcome: "COMPILE_FAILED", detail: compiled.reason, verdict: "N/A", gradeDetail: "", totalCalls: result.totalCalls, costUsd: result.actualCostUsd, extractedCsp: result.extractedCsp }
  }
  const solved = await Effect.runPromise(
    solve({ model: compiled.mzn }).pipe(
      Effect.map((r) => ({ ok: true as const, r })),
      Effect.catch((e) => Effect.succeed({ ok: false as const, detail: solveErrorDetail(e) })),
    ),
  )
  if (!solved.ok) {
    return { outcome: "SOLVE_ERROR", detail: solved.detail, verdict: "N/A", gradeDetail: "", totalCalls: result.totalCalls, costUsd: result.actualCostUsd, extractedCsp: result.extractedCsp, mzn: compiled.mzn }
  }
  const grade = await gradeAgainstKey(puzzleId, answerKeys, result.extractedCsp, solved.r)
  return { outcome: classify(solved.r), detail: "", verdict: grade.verdict, gradeDetail: grade.detail, totalCalls: result.totalCalls, costUsd: result.actualCostUsd, extractedCsp: result.extractedCsp, mzn: compiled.mzn }
}

async function runGraphPipelineWithRepair(puzzleId: string, answerKeys: Awaited<ReturnType<typeof loadAnswerKeys>>, prose: string): Promise<RepOutcome> {
  const result = await extractGraphPipelineWithRepair(MODEL, prose)
  const grade = await gradeAgainstKey(puzzleId, answerKeys, result.extractedCsp, result.repair.solveResult)
  return {
    outcome: result.repair.outcome,
    detail: result.repair.detail,
    verdict: grade.verdict,
    gradeDetail: grade.detail,
    totalCalls: result.totalCalls,
    costUsd: result.actualCostUsd,
    repairRounds: result.repair.repairRounds,
    extractedCsp: result.extractedCsp,
    mzn: result.repair.mzn,
  }
}

function summarize(reps: readonly RepOutcome[]) {
  const solveUnique = reps.filter((r) => r.outcome === "SOLVE_UNIQUE").length
  const match = reps.filter((r) => r.verdict === "MATCH").length
  const totalCost = reps.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
  const totalCalls = reps.reduce((sum, r) => sum + r.totalCalls, 0)
  return { solveUniqueRate: `${solveUnique}/${reps.length}`, matchRate: `${match}/${reps.length}`, totalCost, totalCalls }
}

async function main(): Promise<void> {
  const puzzleIds = process.argv.slice(2).length > 0 ? process.argv.slice(2) : SAMPLE
  const answerKeys = await loadAnswerKeys()
  const baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8")) as ReadonlyArray<{ id: string; variants: { "full-critic": unknown } }>
  const baselineById = new Map(baseline.map((r) => [r.id, r.variants["full-critic"]]))

  const records: unknown[] = []

  for (const puzzleId of puzzleIds) {
    console.log(`\n=== ${puzzleId} ===`)
    const { file, prose } = await loadPuzzleProse(puzzleId)

    const graphPipelineReps: RepOutcome[] = []
    const graphPipelineRepairReps: RepOutcome[] = []
    for (let rep = 0; rep < REPS; rep++) {
      const gp = await runGraphPipelineOnly(puzzleId, answerKeys, prose)
      graphPipelineReps.push(gp)
      console.log(`  graph-pipeline [${rep + 1}/${REPS}]: ${gp.outcome} calls=${gp.totalCalls} cost=${gp.costUsd ?? "n/a"} grade=${gp.verdict}`)

      const gpr = await runGraphPipelineWithRepair(puzzleId, answerKeys, prose)
      graphPipelineRepairReps.push(gpr)
      console.log(`  graph-pipeline+oracle-repair [${rep + 1}/${REPS}]: ${gpr.outcome} calls=${gpr.totalCalls} cost=${gpr.costUsd ?? "n/a"} grade=${gpr.verdict} repairRounds=${gpr.repairRounds}`)
    }

    records.push({
      id: puzzleId,
      file,
      baselineFullCritic: baselineById.get(puzzleId),
      variants: {
        "graph-pipeline": { reps: graphPipelineReps, summary: summarize(graphPipelineReps) },
        "graph-pipeline+oracle-repair": { reps: graphPipelineRepairReps, summary: summarize(graphPipelineRepairReps) },
      },
    })
  }

  const outDir = new URL("results/", import.meta.url)
  await mkdir(outDir, { recursive: true })
  const outPath = new URL(`comparison-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, outDir)
  await writeFile(outPath, JSON.stringify(records, null, 2))
  console.log(`\nWrote ${records.length} records to ${outPath.pathname}`)

  // Aggregate summary across the whole sample.
  let totalCost = 0
  for (const rec of records as { variants: Record<string, { summary: { totalCost: number } }> }[]) {
    for (const v of Object.values(rec.variants)) totalCost += v.summary.totalCost
  }
  console.log(`\nTotal spend this run: $${totalCost.toFixed(4)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
