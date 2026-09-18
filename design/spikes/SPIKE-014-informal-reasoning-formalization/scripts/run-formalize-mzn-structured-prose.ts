// SPIKE-014 §2 step 2 (6th variant): the billed run for `formalize-mzn+structured-prose`. Same
// Stage 1 reuse as run-formalize-mzn.ts (already-collected direct-solve traces, zero re-solve
// cost). Stage 2 is now TWO calls instead of one: 2a restates the solved CSP as an explicit,
// structured-prose draft (lib/formalize-structured-prose.ts's formalizeToStructuredProse); 2b
// transcribes THAT draft (not the raw trace) into MiniZinc
// (translateStructuredProseToMinizinc). Verification is identical to formalize-mzn.ts: skips
// compile()/ExtractedCsp entirely, straight into solve().
//
// Usage: node --env-file-if-exists=.env design/spikes/SPIKE-014-informal-reasoning-formalization/scripts/run-formalize-mzn-structured-prose.ts [resultsFile]
// REPS=<n> overrides the default of 3. MODEL=<model> overrides the default gpt-4o-mini (mirrors
// run-formalize-mzn.ts's own override, for an apples-to-apples frontier-tier rerun later).

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { Effect } from "effect"
import { solve } from "../../../../src/solver/solve.ts"
import { loadAnswerKeys, loadPuzzleProse } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { gradeSolved } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/grade.ts"
import { formalizeToStructuredProse, translateStructuredProseToMinizinc } from "./lib/formalize-structured-prose.ts"
import type { SolveResult, SolverError } from "../../../../src/solver/types.ts"

const MODEL = process.env.MODEL ?? "openai/gpt-4o-mini"
const REPS = Number(process.env.REPS ?? 3)

// Same source file formalize-json/formalize-mzn used — direct comparison on identical Stage-1 traces.
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
  readonly structuredProse?: string
  readonly mzn?: string
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

async function runOne(puzzleId: string, answerKeys: Awaited<ReturnType<typeof loadAnswerKeys>>, prose: string, trace: string): Promise<RepOutcome> {
  const stage2a = await formalizeToStructuredProse(MODEL, prose, trace)
  if (!stage2a.ok || stage2a.structuredProse === undefined) {
    return { outcome: "STRUCTURED_PROSE_FAILED", detail: stage2a.error ?? "unknown", verdict: "N/A", gradeDetail: "", costUsd: stage2a.costUsd }
  }

  const stage2b = await translateStructuredProseToMinizinc(MODEL, stage2a.structuredProse)
  const combinedCost = (stage2a.costUsd ?? 0) + (stage2b.costUsd ?? 0)
  if (!stage2b.ok || stage2b.mzn === undefined) {
    return {
      outcome: "FORMALIZE_FAILED",
      detail: stage2b.error ?? "unknown",
      verdict: "N/A",
      gradeDetail: "",
      costUsd: combinedCost,
      structuredProse: stage2a.structuredProse,
    }
  }
  const mzn = stage2b.mzn

  const solved = await Effect.runPromise(
    solve({ model: mzn }).pipe(
      Effect.map((r) => ({ ok: true as const, r })),
      Effect.catch((e) => Effect.succeed({ ok: false as const, detail: solveErrorDetail(e) })),
    ),
  )
  if (!solved.ok) {
    return { outcome: "SOLVE_ERROR", detail: solved.detail, verdict: "N/A", gradeDetail: "", costUsd: combinedCost, structuredProse: stage2a.structuredProse, mzn }
  }

  const grade = gradeSolved(puzzleId, answerKeys[puzzleId], solved.r)
  return {
    outcome: classify(solved.r),
    detail: "",
    verdict: grade.verdict,
    gradeDetail: grade.detail,
    costUsd: combinedCost,
    structuredProse: stage2a.structuredProse,
    mzn,
  }
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
  const outPath = new URL(`formalize-mzn-structured-prose-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, outDir)

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
