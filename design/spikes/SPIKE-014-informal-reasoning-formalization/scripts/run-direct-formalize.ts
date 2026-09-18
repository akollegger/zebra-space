// SPIKE-014 §2 step 2 (7th/8th variants): the billed run for `direct-mzn` and
// `direct-structured-prose` — both SKIP Stage 1 (the free solve) entirely, unlike every prior
// variant in this spike. Puzzle IDs are read from the same source file used elsewhere purely
// for the puzzle ID list (its `directSolution` trace field is ignored here on purpose).
//
// Usage: node --env-file-if-exists=.env design/spikes/SPIKE-014-informal-reasoning-formalization/scripts/run-direct-formalize.ts <mzn|structured-prose> [resultsFile]
// REPS=<n> overrides the default of 3. MODEL=<model> overrides the default gpt-4o-mini.

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { Effect } from "effect"
import { solve } from "../../../../src/solver/solve.ts"
import { loadAnswerKeys, loadPuzzleProse } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { gradeSolved } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/grade.ts"
import { directFormalizeToMinizinc, directFormalizeToStructuredProse } from "./lib/direct-formalize.ts"
import { translateStructuredProseToMinizinc } from "./lib/formalize-structured-prose.ts"
import type { SolveResult, SolverError } from "../../../../src/solver/types.ts"

const MODE = process.argv[2]
if (MODE !== "mzn" && MODE !== "structured-prose") {
  console.error("Usage: run-direct-formalize.ts <mzn|structured-prose> [resultsFile]")
  process.exit(1)
}

const MODEL = process.env.MODEL ?? "openai/gpt-4o-mini"
const REPS = Number(process.env.REPS ?? 3)

const DEFAULT_RESULTS_FILE = new URL("../../../../eval/results/2026-09-15T14-59-37-368Z.json", import.meta.url)

interface SourceRecord {
  readonly id: string
  readonly outcome: string
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
  readonly structuredProse?: string
  readonly mzn?: string
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

function classify(result: SolveResult): string {
  return result._tag === "Unsatisfiable" ? "SOLVE_UNSATISFIABLE" : result._tag === "MultiplySatisfiable" ? "SOLVE_MULTIPLY_SATISFIABLE" : "SOLVE_UNIQUE"
}

async function getMzn(prose: string): Promise<{ mzn: string | undefined; structuredProse?: string; costUsd: number | undefined; ok: boolean; error?: string }> {
  if (MODE === "mzn") {
    const r = await directFormalizeToMinizinc(MODEL, prose)
    return { mzn: r.mzn, costUsd: r.costUsd, ok: r.ok, error: r.error }
  }
  const stage2a = await directFormalizeToStructuredProse(MODEL, prose)
  if (!stage2a.ok || stage2a.structuredProse === undefined) {
    return { mzn: undefined, costUsd: stage2a.costUsd, ok: false, error: stage2a.error }
  }
  const stage2b = await translateStructuredProseToMinizinc(MODEL, stage2a.structuredProse)
  return {
    mzn: stage2b.mzn,
    structuredProse: stage2a.structuredProse,
    costUsd: (stage2a.costUsd ?? 0) + (stage2b.costUsd ?? 0),
    ok: stage2b.ok,
    error: stage2b.error,
  }
}

async function runOne(puzzleId: string, answerKeys: Awaited<ReturnType<typeof loadAnswerKeys>>, prose: string): Promise<RepOutcome> {
  const formalized = await getMzn(prose)
  if (!formalized.ok || formalized.mzn === undefined) {
    return { outcome: "FORMALIZE_FAILED", detail: formalized.error ?? "unknown", verdict: "N/A", gradeDetail: "", costUsd: formalized.costUsd, structuredProse: formalized.structuredProse }
  }
  const mzn = formalized.mzn

  const solved = await Effect.runPromise(
    solve({ model: mzn }).pipe(
      Effect.map((r) => ({ ok: true as const, r })),
      Effect.catch((e) => Effect.succeed({ ok: false as const, detail: solveErrorDetail(e) })),
    ),
  )
  if (!solved.ok) {
    return { outcome: "SOLVE_ERROR", detail: solved.detail, verdict: "N/A", gradeDetail: "", costUsd: formalized.costUsd, structuredProse: formalized.structuredProse, mzn }
  }

  const grade = gradeSolved(puzzleId, answerKeys[puzzleId], solved.r)
  return {
    outcome: classify(solved.r),
    detail: "",
    verdict: grade.verdict,
    gradeDetail: grade.detail,
    costUsd: formalized.costUsd,
    structuredProse: formalized.structuredProse,
    mzn,
  }
}

async function main(): Promise<void> {
  const resultsFileArg = process.argv[3]
  const resultsFile = resultsFileArg !== undefined ? new URL(resultsFileArg, `file://${process.cwd()}/`) : DEFAULT_RESULTS_FILE

  const raw = await readFile(resultsFile, "utf8")
  const sourceFile = JSON.parse(raw) as SourceFile
  const answerKeys = await loadAnswerKeys()

  const records: unknown[] = []
  let grandTotalCost = 0
  const outDir = new URL("results/", import.meta.url)
  await mkdir(outDir, { recursive: true })
  const modelTag = MODEL.replace(/[^a-zA-Z0-9]+/g, "-")
  const outPath = new URL(`direct-${MODE}-${modelTag}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, outDir)

  for (const puzzle of sourceFile.puzzles) {
    console.log(`\n=== ${puzzle.id} (source outcome: ${puzzle.outcome}) ===`)
    const { prose } = await loadPuzzleProse(puzzle.id)

    const reps: RepOutcome[] = []
    for (let rep = 0; rep < REPS; rep++) {
      const result = await runOne(puzzle.id, answerKeys, prose)
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
