// SPIKE-008: grading dispatch by answer-key outcome class, mirroring
// scripts/eval-extraction.ts's private gradeSolved/recoverEntityKeyedArrays (not exported —
// duplicated here in spirit, citing the original, per this spike's own throwaway-code
// convention) so this spike's runner can grade against the same eval/answer-keys.json entries
// the real eval harness uses.

import { sanitizeIdentifier } from "../../../../../src/compiler/compile.ts"
import { gradeAmbiguous, gradeCop, gradeDeterminate, gradeNonProblem, gradeSubjective, PARALLEL_ARRAY_PUZZLES, type GraderVerdict } from "../../../../../src/eval/grader.ts"
import type { Assignment, SolveResult } from "../../../../../src/solver/types.ts"
import type { ExtractedCsp } from "../../../../../src/extraction/types.ts"
import type { AnswerKeyEntry } from "./puzzles.ts"

/** Mirrors scripts/eval-extraction.ts's recoverEntityKeyedArrays: MiniZinc's own
 * --output-mode json never keys an entity-indexed array by its enum, so the grader can't
 * compare against the answer key's entity ids without restoring that vocabulary. */
export function recoverEntityKeyedArrays(puzzleId: string, assignment: Assignment, extractedCsp: ExtractedCsp): Assignment {
  // PARALLEL_ARRAY_PUZZLES' own answer keys are positional-by-declared-order, never entity-id-
  // keyed (e.g. PZL-0002's "Arrays are positional by house, 1-3 left to right") — converting
  // their solved arrays into entity-keyed objects here actively breaks gradeDeterminate's
  // parallel-array path rather than being merely unnecessary for it (found live 2026-09-16,
  // mirrors the same fix in scripts/eval-extraction.ts's own copy).
  if (PARALLEL_ARRAY_PUZZLES.has(puzzleId)) return assignment
  const recovered: Record<string, unknown> = { ...assignment }
  for (const domain of extractedCsp.domains) {
    const key = sanitizeIdentifier(domain.variable)
    const value = recovered[key]
    if (!Array.isArray(value)) continue
    const entityIds = extractedCsp.entities.filter((e) => e.type === domain.entityType).map((e) => e.id)
    if (entityIds.length !== value.length) continue
    recovered[key] = Object.fromEntries(entityIds.map((id, i) => [id, value[i]]))
  }
  return recovered
}

export type Verdict = GraderVerdict | "NO_ANSWER_KEY"

/** Mirrors scripts/eval-extraction.ts's gradeSolved dispatch (private there) — normalizes the
 * two answer-key shapes (top-level vs. nested under `answer`) and dispatches to the class-
 * specific grader. */
export function gradeSolved(
  puzzleId: string,
  entry: AnswerKeyEntry | undefined,
  solveResult: SolveResult,
): { readonly verdict: Verdict; readonly detail: string } {
  if (entry === undefined) return { verdict: "NO_ANSWER_KEY", detail: "no answer key" }
  const nested = entry.answer !== null && typeof entry.answer === "object" && !Array.isArray(entry.answer) ? (entry.answer as Record<string, unknown>) : undefined
  const effectiveOutcome = (entry.outcome ?? (nested?.outcome as string | undefined) ?? "determinate") as
    | "determinate"
    | "cop"
    | "ambiguous"
    | "subjective"
    | "non-problem"
  const effectiveAnswer = nested?.answer !== undefined ? nested.answer : entry.answer
  switch (effectiveOutcome) {
    case "cop":
      return gradeCop(puzzleId, solveResult)
    case "ambiguous":
      return gradeAmbiguous((entry.readings ?? nested?.readings ?? []) as never, solveResult, puzzleId)
    case "subjective":
      return gradeSubjective(
        { without_premise: entry.without_premise as never, with_premise: entry.with_premise as never },
        solveResult,
        puzzleId,
      )
    case "non-problem":
      return gradeNonProblem((entry.failing_condition ?? (nested?.failing_condition as string | undefined)) as string | undefined)
    case "determinate": {
      if (solveResult._tag !== "UniquelySolvable") {
        return { verdict: "MISMATCH", detail: `expected unique solution, got ${solveResult._tag}` }
      }
      return gradeDeterminate(puzzleId, effectiveAnswer, solveResult.assignment)
    }
  }
}
