// SPIKE-008: the four-way comparison run (Method step 5), preceded by re-establishing the
// full-critic baseline fresh (Method step 1 — the old raw eval/results/ files are gone).
// Billed run: cheap-tier model only (openai/gpt-4o-mini), 14-puzzle sample (Method step 2).
//
// Usage: node --env-file-if-exists=.env design/spikes/SPIKE-008-per-clue-tool-call-decomposition/scripts/run-comparison.ts [puzzleId ...]
// With no args, runs the full 14-puzzle sample.

import { writeFile, mkdir } from "node:fs/promises"
import { Effect } from "effect"
import { fullCriticHarness, type HarnessModelOpts } from "../../../../src/eval/harness.ts"
import type { SolveResult } from "../../../../src/solver/types.ts"
import { extractPerClue, reviseOneClue } from "./lib/per-clue-extract.ts"
import { groundedFinding } from "./lib/grounded-critic.ts"
import { renderConstraintAsEnglish } from "./lib/back-translation.ts"
import { judgeBackTranslation } from "./lib/back-translation-critic.ts"
import { loadAnswerKeys, loadPuzzleProse } from "./lib/puzzles.ts"
import { gradeSolved, recoverEntityKeyedArrays } from "./lib/grade.ts"
import { compile } from "../../../../src/compiler/compile.ts"
import { solve } from "../../../../src/solver/solve.ts"
import type { ExtractedCsp } from "../../../../src/extraction/types.ts"

const MODEL = "openai/gpt-4o-mini"

// Method step 2: STRATIFIED_SUBSET (scripts/eval-matrix.ts) + the puzzles that never reliably
// passed in prior runs.
const SAMPLE = [
  "PZL-0002", "PZL-0004", "PZL-0022", "PZL-0028", "PZL-0033", "PZL-0038", "PZL-0015", "PZL-0018",
  "PZL-0001", "PZL-0003", "PZL-0007", "PZL-0010", "PZL-0011", "PZL-0012",
]

interface VariantOutcome {
  readonly variant: string
  readonly totalCalls: number
  readonly costUsd: number | undefined
  readonly outcome: string
  readonly verdict: string
  readonly detail: string
  readonly extractedCsp?: unknown
  readonly mzn?: string | null
  readonly note?: string
}

function classify(solveResult: SolveResult): string {
  return solveResult._tag === "Unsatisfiable" ? "SOLVE_UNSATISFIABLE" : solveResult._tag === "MultiplySatisfiable" ? "SOLVE_MULTIPLY_SATISFIABLE" : "SOLVE_UNIQUE"
}

async function runFullCritic(prose: string): Promise<VariantOutcome> {
  const modelOpts: HarnessModelOpts = { model: MODEL, frontierModel: "anthropic/claude-sonnet-4.5" }
  const extraction = await Effect.runPromise(
    fullCriticHarness.extract(prose, modelOpts).pipe(
      Effect.map((v) => ({ ok: true as const, v })),
      Effect.catch((e) => Effect.succeed({ ok: false as const, e })),
    ),
  )
  if (!extraction.ok) {
    return { variant: "full-critic", totalCalls: fullCriticHarness.maxCallsPerPuzzle, costUsd: extraction.e.actualCostUsd, outcome: "EXTRACT_FAILED", verdict: "FAIL", detail: `${extraction.e.tag}: ${extraction.e.detail}` }
  }
  const compilation = await Effect.runPromise(
    fullCriticHarness.compile(extraction.v).pipe(
      Effect.map((v) => ({ ok: true as const, v })),
      Effect.catch((e) => Effect.succeed({ ok: false as const, e })),
    ),
  )
  if (!compilation.ok) {
    return { variant: "full-critic", totalCalls: fullCriticHarness.maxCallsPerPuzzle, costUsd: extraction.v.actualCostUsd, outcome: "COMPILE_FAILED", verdict: "FAIL", detail: compilation.e.reason, extractedCsp: extraction.v.extractedCsp }
  }
  const solution = await Effect.runPromise(
    fullCriticHarness.solve(compilation.v).pipe(
      Effect.map((v) => ({ ok: true as const, v })),
      Effect.catch((e) => Effect.succeed({ ok: false as const, e })),
    ),
  )
  if (!solution.ok) {
    return { variant: "full-critic", totalCalls: fullCriticHarness.maxCallsPerPuzzle, costUsd: extraction.v.actualCostUsd, outcome: "SOLVE_ERROR", verdict: "FAIL", detail: solution.e.detail, extractedCsp: extraction.v.extractedCsp, mzn: compilation.v.mzn }
  }
  return {
    variant: "full-critic",
    totalCalls: fullCriticHarness.maxCallsPerPuzzle,
    costUsd: extraction.v.actualCostUsd,
    outcome: classify(solution.v.solveResult),
    verdict: "SOLVED",
    detail: "",
    extractedCsp: extraction.v.extractedCsp,
    mzn: compilation.v.mzn,
    note: JSON.stringify(solution.v.solveResult),
  }
}

async function compileAndSolve(extractedCsp: ExtractedCsp): Promise<{ readonly outcome: string; readonly detail: string; readonly mzn: string | null; readonly solveResult?: SolveResult }> {
  const compiled = await Effect.runPromise(
    compile(extractedCsp).pipe(
      Effect.map((mzn) => ({ ok: true as const, mzn })),
      Effect.catch((e) => Effect.succeed({ ok: false as const, reason: e.reason })),
    ),
  )
  if (!compiled.ok) return { outcome: "COMPILE_FAILED", detail: compiled.reason, mzn: null }
  const solved = await Effect.runPromise(
    solve({ model: compiled.mzn }).pipe(
      Effect.map((r) => ({ ok: true as const, r })),
      Effect.catch(() => Effect.succeed({ ok: false as const })),
    ),
  )
  if (!solved.ok) return { outcome: "SOLVE_ERROR", detail: "solve failed", mzn: compiled.mzn }
  return { outcome: classify(solved.r), detail: "", mzn: compiled.mzn, solveResult: solved.r }
}

async function runPerClueOnly(prose: string) {
  const result = await extractPerClue(prose, MODEL)
  const solved = await compileAndSolve(result.extractedCsp)
  const variant: VariantOutcome = {
    variant: "per-clue",
    totalCalls: result.totalCalls,
    costUsd: result.actualCostUsd,
    outcome: solved.outcome,
    verdict: solved.solveResult !== undefined ? "SOLVED" : "FAIL",
    detail: solved.detail,
    extractedCsp: result.extractedCsp,
    mzn: solved.mzn,
    note: solved.solveResult !== undefined ? JSON.stringify(solved.solveResult) : undefined,
  }
  return { variant, result, solveResult: solved.solveResult }
}

async function runPerClueGrounded(prose: string) {
  const base = await extractPerClue(prose, MODEL)
  let calls = base.totalCalls
  let cost = base.actualCostUsd ?? 0
  let anyCost = base.actualCostUsd !== undefined
  let tagged = base.taggedConstraints
  let extractedCsp: ExtractedCsp = base.extractedCsp

  const finding = await Effect.runPromise(groundedFinding(extractedCsp, tagged))
  const revisionNote = `grounded finding: ${finding.kind}`

  if (finding.kind === "unsatisfiable-conflict" && finding.suspectClueIndices.length > 0) {
    // Bound cost: revise at most the first 2 suspects, not every one.
    const toRevise = finding.suspectClueIndices.slice(0, 2)
    for (const clueIndex of toRevise) {
      const clueText = base.clues[clueIndex]!
      const hint = `A downstream check found this clue's constraint conflicts with another clue's, making the puzzle unsatisfiable. Re-examine this clue carefully — you may have gotten a direction, comparator, or value wrong.`
      const revised = await reviseOneClue(base.vocabulary, base.preamble, clueText, hint, MODEL)
      calls += revised.calls
      if (revised.costUsd !== undefined) {
        cost += revised.costUsd
        anyCost = true
      }
      tagged = [...tagged.filter((t) => t.clueIndex !== clueIndex), ...revised.constraints.map((c) => ({ clueIndex, constraint: c }))]
    }
    extractedCsp = { entities: base.vocabulary.entities, domains: base.vocabulary.domains, constraints: tagged.map((t) => t.constraint) }
  } else if (finding.kind === "underconstrained" && finding.underconstrainedVariables.length > 0) {
    // Find which clue(s) touch any underconstrained variable at all — a heuristic proxy for
    // "which clue is missing", since under-constraint is a property of what's ABSENT, not any
    // one present clue; revise the clue(s) that at least reference the variable, if any do.
    const touching = tagged.filter((t) => JSON.stringify(t.constraint).includes(JSON.stringify(finding.underconstrainedVariables[0])))
    const toRevise = [...new Set(touching.map((t) => t.clueIndex))].slice(0, 1)
    for (const clueIndex of toRevise) {
      const clueText = base.clues[clueIndex]!
      const hint = `A downstream check found the puzzle is under-constrained on: ${finding.underconstrainedVariables.join(", ")}. Check whether this clue should pin one of these down more precisely.`
      const revised = await reviseOneClue(base.vocabulary, base.preamble, clueText, hint, MODEL)
      calls += revised.calls
      if (revised.costUsd !== undefined) {
        cost += revised.costUsd
        anyCost = true
      }
      tagged = [...tagged.filter((t) => t.clueIndex !== clueIndex), ...revised.constraints.map((c) => ({ clueIndex, constraint: c }))]
    }
    extractedCsp = { entities: base.vocabulary.entities, domains: base.vocabulary.domains, constraints: tagged.map((t) => t.constraint) }
  }

  const solved = await compileAndSolve(extractedCsp)
  const variant: VariantOutcome = {
    variant: "per-clue+grounded",
    totalCalls: calls,
    costUsd: anyCost ? cost : undefined,
    outcome: solved.outcome,
    verdict: solved.solveResult !== undefined ? "SOLVED" : "FAIL",
    detail: solved.detail,
    extractedCsp,
    mzn: solved.mzn,
    note: `${revisionNote}; ${solved.solveResult !== undefined ? JSON.stringify(solved.solveResult) : ""}`,
  }
  return { variant, solveResult: solved.solveResult, extractedCsp }
}

async function runPerClueBackTranslation(prose: string) {
  const base = await extractPerClue(prose, MODEL)
  let calls = base.totalCalls
  let cost = base.actualCostUsd ?? 0
  let anyCost = base.actualCostUsd !== undefined
  let tagged = [...base.taggedConstraints]
  const judgeNotes: string[] = []

  for (let clueIndex = 0; clueIndex < base.clues.length; clueIndex++) {
    const clueConstraints = tagged.filter((t) => t.clueIndex === clueIndex).map((t) => t.constraint)
    if (clueConstraints.length === 0) continue
    const rendered = clueConstraints.map(renderConstraintAsEnglish)
    const judgment = await judgeBackTranslation(MODEL, base.clues[clueIndex]!, rendered)
    calls += 1
    if (judgment.costUsd !== undefined) {
      cost += judgment.costUsd
      anyCost = true
    }
    if (!judgment.accepted) {
      judgeNotes.push(`clue ${clueIndex}: ${judgment.issue}`)
      const hint = `A back-translation check found this rendering doesn't match: "${rendered.join(" ")}" — issue: ${judgment.issue}.`
      const revised = await reviseOneClue(base.vocabulary, base.preamble, base.clues[clueIndex]!, hint, MODEL)
      calls += revised.calls
      if (revised.costUsd !== undefined) {
        cost += revised.costUsd
        anyCost = true
      }
      tagged = [...tagged.filter((t) => t.clueIndex !== clueIndex), ...revised.constraints.map((c) => ({ clueIndex, constraint: c }))]
    }
  }

  const extractedCsp: ExtractedCsp = { entities: base.vocabulary.entities, domains: base.vocabulary.domains, constraints: tagged.map((t) => t.constraint) }
  const solved = await compileAndSolve(extractedCsp)
  const variant: VariantOutcome = {
    variant: "per-clue+back-translation",
    totalCalls: calls,
    costUsd: anyCost ? cost : undefined,
    outcome: solved.outcome,
    verdict: solved.solveResult !== undefined ? "SOLVED" : "FAIL",
    detail: solved.detail,
    extractedCsp,
    mzn: solved.mzn,
    note: `judge flagged ${judgeNotes.length}/${base.clues.length} clues; ${solved.solveResult !== undefined ? JSON.stringify(solved.solveResult) : ""}`,
  }
  return { variant, solveResult: solved.solveResult }
}

function gradeVariant(puzzleId: string, answerKeys: Awaited<ReturnType<typeof loadAnswerKeys>>, _variant: VariantOutcome, solveResult: SolveResult | undefined, extractedCsp: ExtractedCsp | undefined) {
  if (solveResult === undefined) return { verdict: "N/A", detail: "no solve result" }
  const recovered =
    solveResult._tag === "UniquelySolvable" && extractedCsp !== undefined
      ? { ...solveResult, assignment: recoverEntityKeyedArrays(solveResult.assignment, extractedCsp) }
      : solveResult
  return gradeSolved(puzzleId, answerKeys[puzzleId], recovered)
}

async function main(): Promise<void> {
  const puzzleIds = process.argv.slice(2).length > 0 ? process.argv.slice(2) : SAMPLE
  const answerKeys = await loadAnswerKeys()
  const records: unknown[] = []

  for (const puzzleId of puzzleIds) {
    console.log(`\n=== ${puzzleId} ===`)
    const { file, prose } = await loadPuzzleProse(puzzleId)

    const fc = await runFullCritic(prose)
    const fcGrade = fc.extractedCsp !== undefined && fc.note ? gradeVariant(puzzleId, answerKeys, fc, JSON.parse(fc.note || "null"), fc.extractedCsp as ExtractedCsp) : { verdict: fc.outcome, detail: fc.detail }
    console.log(`  full-critic: ${fc.outcome} calls=${fc.totalCalls} cost=${fc.costUsd ?? "n/a"} grade=${fcGrade.verdict}`)

    const pc = await runPerClueOnly(prose)
    const pcGrade = gradeVariant(puzzleId, answerKeys, pc.variant, pc.solveResult, pc.result.extractedCsp)
    console.log(`  per-clue: ${pc.variant.outcome} calls=${pc.variant.totalCalls} cost=${pc.variant.costUsd ?? "n/a"} grade=${pcGrade.verdict} decomposable=${pc.result.decomposable}`)

    const pg = await runPerClueGrounded(prose)
    const pgGrade = gradeVariant(puzzleId, answerKeys, pg.variant, pg.solveResult, pg.extractedCsp)
    console.log(`  per-clue+grounded: ${pg.variant.outcome} calls=${pg.variant.totalCalls} cost=${pg.variant.costUsd ?? "n/a"} grade=${pgGrade.verdict}`)

    const pb = await runPerClueBackTranslation(prose)
    const pbGrade = gradeVariant(puzzleId, answerKeys, pb.variant, pb.solveResult, pb.variant.extractedCsp as ExtractedCsp | undefined)
    console.log(`  per-clue+back-translation: ${pb.variant.outcome} calls=${pb.variant.totalCalls} cost=${pb.variant.costUsd ?? "n/a"} grade=${pbGrade.verdict}`)

    records.push({
      id: puzzleId,
      file,
      variants: {
        "full-critic": { ...fc, grade: fcGrade },
        "per-clue": { ...pc.variant, grade: pcGrade, decomposable: pc.result.decomposable, perClue: pc.result.perClue },
        "per-clue+grounded": { ...pg.variant, grade: pgGrade },
        "per-clue+back-translation": { ...pb.variant, grade: pbGrade },
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
