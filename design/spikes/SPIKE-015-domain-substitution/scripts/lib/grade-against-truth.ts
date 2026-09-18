// SPIKE-015 §2 step 5: grades an independently-verified solve against the mechanically-derived
// truth (the substituted .mzn's own solved assignment), not against eval/answer-keys.json.
//
// Real bug found reading src/eval/grader.ts directly before writing this: gradeDeterminate's
// parallel-array branch (PARALLEL_ARRAY_PUZZLES, which includes PZL-0002) unwraps the solver's
// {e: "Blue"} enum-wrapping ONLY on the actual side (via its own inline unwrapSingleKeyRecord
// call) — never on `expected`. Passing a raw, mechanically-derived Assignment straight in as
// `expected` would make every enum-array item come back {e: "Blue"}; tokenOf only accepts
// string|number, so every one would silently grade "non-scalar in expected array" MISMATCH. Fixed
// by deep-unwrapping our own truth assignment first, duplicating grader.ts's own private,
// non-exported unwrapSingleKeyRecord helper (same duplicate-rather-than-export convention as
// apply-to-mzn.ts's comparisonKey).

import { gradeDeterminate } from "../../../../../src/eval/grader.ts"
import type { Assignment, SolveResult } from "../../../../../src/solver/types.ts"

/** Duplicated from src/eval/grader.ts's own private helper. MiniZinc's own JSON output wraps an
 * enum-typed scalar one level deep ({e: value}); unwraps recursively. */
function unwrapSingleKeyRecord(value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 1) return unwrapSingleKeyRecord(entries[0]![1])
  }
  return value
}

function deepUnwrapAssignment(assignment: Assignment): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(assignment)) {
    out[key] = Array.isArray(value) ? value.map(unwrapSingleKeyRecord) : unwrapSingleKeyRecord(value)
  }
  return out
}

export interface MechanicalGradeResult {
  readonly verdict: "MATCH" | "MISMATCH" | "NOT_UNIQUE"
  readonly detail: string
}

/** Grades an independently-produced SolveResult against the mechanically-derived truth
 * Assignment. Fails fast (NOT_UNIQUE) unless the candidate itself solved uniquely — a
 * non-unique verifier result is a real, distinct finding from a wrong unique answer. */
export function gradeAgainstMechanicalTruth(puzzleId: string, trueAssignment: Assignment, candidate: SolveResult): MechanicalGradeResult {
  if (candidate._tag !== "UniquelySolvable") {
    return { verdict: "NOT_UNIQUE", detail: `expected a unique solution, got ${candidate._tag}` }
  }
  const graded = gradeDeterminate(puzzleId, deepUnwrapAssignment(trueAssignment), candidate.assignment)
  return { verdict: graded.verdict, detail: graded.detail }
}
