import type { Assignment, MultiplySatisfiable, Unsatisfiable, UniquelySolvable } from "./types.ts"

const UNSATISFIABLE_MARKER = "=====UNSATISFIABLE====="
const SEARCH_COMPLETE_MARKER = "=========="
const SOLUTION_SEPARATOR = "----------"

/**
 * Classifies MiniZinc's `--output-mode json` stdout into 0/1/2 solutions.
 * research.md Finding 2: unsatisfiable is a successful (exit 0) run whose stdout carries
 * the UNSATISFIABLE_MARKER, not a distinguishable exit code — so classification is done by
 * parsing stdout, never by branching on exit code.
 */
export function classifySolutions(
  stdout: string,
): Unsatisfiable | UniquelySolvable | MultiplySatisfiable {
  if (stdout.includes(UNSATISFIABLE_MARKER)) {
    return { _tag: "Unsatisfiable" }
  }

  const assignments = stdout
    .split(SOLUTION_SEPARATOR)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0 && chunk !== SEARCH_COMPLETE_MARKER)
    .map((chunk) => JSON.parse(chunk) as Assignment)

  if (assignments.length === 1) {
    return { _tag: "UniquelySolvable", assignment: assignments[0]! }
  }

  if (assignments.length >= 2) {
    return {
      _tag: "MultiplySatisfiable",
      assignments: [assignments[0]!, assignments[1]!],
    }
  }

  throw new Error(`Unrecognized minizinc output (no solutions and no unsatisfiable marker):\n${stdout}`)
}
