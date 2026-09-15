// SPIKE-012 §2 step 7: compile/solve as a REPAIR ORACLE, not a fidelity gate (consistent with
// RFC-003 §7.3's existing resolution that solvability and translation-fidelity are orthogonal
// claims) — a compile error or an unexpected SOLVE_UNSATISFIABLE/SOLVE_MULTIPLY_SATISFIABLE on a
// puzzle the answer key declares determinate names the SPECIFIC clue(s) to re-ask, reusing
// SPIKE-008's own grounded-critic drop-one-clue/diff-solutions mechanics (imported, not rebuilt)
// rather than a whole-document critique. Bounded to at most 2 repair rounds per puzzle, mirroring
// SPIKE-008's own back-translation-critic bound, to keep cost predictable.

import { Effect } from "effect"
import { compile } from "../../../../../src/compiler/compile.ts"
import { solve } from "../../../../../src/solver/solve.ts"
import { groundedFinding, type ClueTaggedConstraint as GroundedTaggedConstraint } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/grounded-critic.ts"
import { reviseOneClue } from "./per-clue-typed.ts"
import type { Vocabulary } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/clue-schema.ts"
import type { TemplateId } from "./clue-templates.ts"
import type { ClueTaggedConstraint, PerClueTypedLog } from "./per-clue-typed.ts"
import type { ExtractedCsp } from "../../../../../src/extraction/types.ts"
import type { SolveResult } from "../../../../../src/solver/types.ts"

export interface OracleRepairResult {
  readonly extractedCsp: ExtractedCsp
  readonly outcome: string
  readonly detail: string
  readonly mzn: string | null
  readonly solveResult: SolveResult | undefined
  readonly repairRounds: number
  readonly repairNote: string
  readonly additionalCostUsd: number | undefined
  readonly additionalCalls: number
}

type CompileAttempt = { readonly ok: true; readonly mzn: string } | { readonly ok: false; readonly reason: string }

function compileSafely(csp: ExtractedCsp): Promise<CompileAttempt> {
  return Effect.runPromise(
    compile(csp).pipe(
      Effect.map((mzn): CompileAttempt => ({ ok: true, mzn })),
      Effect.catch((e) => Effect.succeed<CompileAttempt>({ ok: false, reason: e.reason })),
    ),
  )
}

type SolveAttempt = { readonly ok: true; readonly result: SolveResult } | { readonly ok: false; readonly detail: string }

function solveSafely(mzn: string): Promise<SolveAttempt> {
  return Effect.runPromise(
    solve({ model: mzn }).pipe(
      Effect.map((result): SolveAttempt => ({ ok: true, result })),
      Effect.catch(() => Effect.succeed<SolveAttempt>({ ok: false, detail: "solve failed" })),
    ),
  )
}

function classify(result: SolveResult): string {
  return result._tag === "Unsatisfiable" ? "SOLVE_UNSATISFIABLE" : result._tag === "MultiplySatisfiable" ? "SOLVE_MULTIPLY_SATISFIABLE" : "SOLVE_UNIQUE"
}

/**
 * Heuristic clue localization for a COMPILE failure: `CompileError.reason` names specific
 * domain/entity/value identifiers (e.g. "Identifier collision: ... \"Englishman\" ...",
 * "Adjacency variable \"position\" is not shared by ..."), so find every clue whose emitted
 * constraint(s) mention any token from the error text — the same "does this clue touch this"
 * proxy SPIKE-008's own grounded-revision path already used for the underconstrained case,
 * applied here to compile errors instead. Not exact (a clue can mention a token incidentally),
 * but bounded and better than re-asking every clue.
 */
function clueIndicesTouchingError(errorReason: string, tagged: readonly ClueTaggedConstraint[]): readonly number[] {
  const tokens = errorReason.match(/"([^"]+)"/g)?.map((t) => t.slice(1, -1)) ?? []
  if (tokens.length === 0) return []
  const touching = new Set<number>()
  for (const t of tagged) {
    const json = JSON.stringify(t.constraint)
    if (tokens.some((token) => json.includes(token))) touching.add(t.clueIndex)
  }
  return [...touching].slice(0, 2)
}

/**
 * One targeted repair round: re-ask exactly the named clue(s)' fill step with a specific hint,
 * replacing (not adding to) their prior constraints, then reassemble. Returns unchanged if there
 * was nothing to revise (no clue could be localized).
 */
async function revise(
  model: string,
  vocabulary: Vocabulary,
  preamble: string,
  clues: readonly string[],
  perClueLog: readonly PerClueTypedLog[],
  tagged: readonly ClueTaggedConstraint[],
  clueIndices: readonly number[],
  hintFor: (clueIndex: number) => string,
): Promise<{ readonly tagged: readonly ClueTaggedConstraint[]; readonly costUsd: number | undefined; readonly calls: number; readonly revisedAny: boolean }> {
  let cost = 0
  let anyCost = false
  let calls = 0
  let working = [...tagged]
  let revisedAny = false

  for (const clueIndex of clueIndices) {
    const template = perClueLog.find((l) => l.clueIndex === clueIndex)?.template
    if (template === undefined || template === "noConstraint") continue
    const revised = await reviseOneClue(model, vocabulary, preamble, clues[clueIndex]!, template as TemplateId, hintFor(clueIndex))
    calls += revised.calls
    if (revised.costUsd !== undefined) {
      cost += revised.costUsd
      anyCost = true
    }
    working = [...working.filter((t) => t.clueIndex !== clueIndex), ...revised.constraints.map((c) => ({ clueIndex, constraint: c }))]
    revisedAny = true
  }

  return { tagged: working, costUsd: anyCost ? cost : undefined, calls, revisedAny }
}

/**
 * Compiles+solves the assembled CSP; on failure, localizes and re-asks the implicated clue(s)
 * (bounded to `maxRounds`), then re-compiles+solves once more. Never loops indefinitely — a
 * repair round that doesn't change the outcome class stops rather than repeating.
 */
export async function repairAndSolve(
  model: string,
  vocabulary: Vocabulary,
  preamble: string,
  clues: readonly string[],
  perClueLog: readonly PerClueTypedLog[],
  initialTagged: readonly ClueTaggedConstraint[],
  maxRounds = 2,
): Promise<OracleRepairResult> {
  let tagged = initialTagged
  let additionalCost = 0
  let anyAdditionalCost = false
  let additionalCalls = 0
  let repairRounds = 0
  const notes: string[] = []

  for (let round = 0; round <= maxRounds; round++) {
    const csp: ExtractedCsp = { entities: vocabulary.entities, domains: vocabulary.domains, constraints: tagged.map((t) => t.constraint) }
    const compiled = await compileSafely(csp)
    if (!compiled.ok) {
      if (round === maxRounds) {
        return { extractedCsp: csp, outcome: "COMPILE_FAILED", detail: compiled.reason, mzn: null, solveResult: undefined, repairRounds, repairNote: notes.join("; "), additionalCostUsd: anyAdditionalCost ? additionalCost : undefined, additionalCalls }
      }
      const targets = clueIndicesTouchingError(compiled.reason, tagged)
      if (targets.length === 0) {
        notes.push(`round ${round}: COMPILE_FAILED, could not localize a clue to revise (${compiled.reason.slice(0, 100)})`)
        return { extractedCsp: csp, outcome: "COMPILE_FAILED", detail: compiled.reason, mzn: null, solveResult: undefined, repairRounds, repairNote: notes.join("; "), additionalCostUsd: anyAdditionalCost ? additionalCost : undefined, additionalCalls }
      }
      const hint = `A compile check found this specific error: ${compiled.reason} Re-examine this clue against the fixed vocabulary and correct it.`
      const revised = await revise(model, vocabulary, preamble, clues, perClueLog, tagged, targets, () => hint)
      additionalCalls += revised.calls
      if (revised.costUsd !== undefined) {
        additionalCost += revised.costUsd
        anyAdditionalCost = true
      }
      tagged = revised.tagged
      repairRounds += 1
      notes.push(`round ${round}: COMPILE_FAILED, re-asked clue(s) ${targets.join(",")}`)
      continue
    }

    const solved = await solveSafely(compiled.mzn)
    if (!solved.ok) {
      return { extractedCsp: csp, outcome: "SOLVE_ERROR", detail: solved.detail, mzn: compiled.mzn, solveResult: undefined, repairRounds, repairNote: notes.join("; "), additionalCostUsd: anyAdditionalCost ? additionalCost : undefined, additionalCalls }
    }
    if (solved.result._tag === "UniquelySolvable" || round === maxRounds) {
      return { extractedCsp: csp, outcome: classify(solved.result), detail: "", mzn: compiled.mzn, solveResult: solved.result, repairRounds, repairNote: notes.join("; "), additionalCostUsd: anyAdditionalCost ? additionalCost : undefined, additionalCalls }
    }

    // Unsatisfiable or multiply-satisfiable: use the real drop-one-clue/diff-solutions finding.
    const groundedTagged: readonly GroundedTaggedConstraint[] = tagged
    const finding = await Effect.runPromise(groundedFinding(csp, groundedTagged))
    if (finding.kind === "unsatisfiable-conflict" && finding.suspectClueIndices.length > 0) {
      const targets = finding.suspectClueIndices.slice(0, 2)
      const hint = "A downstream check found this clue's constraint conflicts with another clue's, making the puzzle unsatisfiable. Re-examine this clue carefully — you may have gotten a direction, comparator, or value wrong."
      const revised = await revise(model, vocabulary, preamble, clues, perClueLog, tagged, targets, () => hint)
      additionalCalls += revised.calls
      if (revised.costUsd !== undefined) {
        additionalCost += revised.costUsd
        anyAdditionalCost = true
      }
      tagged = revised.tagged
      repairRounds += 1
      notes.push(`round ${round}: SOLVE_UNSATISFIABLE, re-asked clue(s) ${targets.join(",")}`)
      continue
    }
    if (finding.kind === "underconstrained" && finding.underconstrainedVariables.length > 0) {
      const touching = tagged.filter((t) => finding.underconstrainedVariables.some((v) => JSON.stringify(t.constraint).includes(v)))
      const targets = [...new Set(touching.map((t) => t.clueIndex))].slice(0, 2)
      if (targets.length > 0) {
        const hint = `A downstream check found the puzzle is under-constrained on: ${finding.underconstrainedVariables.join(", ")}. Check whether this clue should pin one of these down more precisely.`
        const revised = await revise(model, vocabulary, preamble, clues, perClueLog, tagged, targets, () => hint)
        additionalCalls += revised.calls
        if (revised.costUsd !== undefined) {
          additionalCost += revised.costUsd
          anyAdditionalCost = true
        }
        tagged = revised.tagged
        repairRounds += 1
        notes.push(`round ${round}: SOLVE_MULTIPLY_SATISFIABLE, re-asked clue(s) ${targets.join(",")}`)
        continue
      }
    }
    // No actionable finding — stop here rather than loop with nothing to change.
    return { extractedCsp: csp, outcome: classify(solved.result), detail: "", mzn: compiled.mzn, solveResult: solved.result, repairRounds, repairNote: notes.join("; "), additionalCostUsd: anyAdditionalCost ? additionalCost : undefined, additionalCalls }
  }

  // Unreachable in practice (the loop always returns within maxRounds+1 iterations), but keeps
  // the function's return type honest without a non-null assertion.
  const fallbackCsp: ExtractedCsp = { entities: vocabulary.entities, domains: vocabulary.domains, constraints: tagged.map((t) => t.constraint) }
  return { extractedCsp: fallbackCsp, outcome: "SOLVE_ERROR", detail: "repair loop exhausted", mzn: null, solveResult: undefined, repairRounds, repairNote: notes.join("; "), additionalCostUsd: anyAdditionalCost ? additionalCost : undefined, additionalCalls }
}
