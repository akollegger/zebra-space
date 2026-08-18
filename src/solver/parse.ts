import type { Assignment, ClassifiedOutput } from "./types.ts"

const UNSATISFIABLE_MARKER = "=====UNSATISFIABLE====="
const SEARCH_COMPLETE_MARKER = "=========="
const SOLUTION_SEPARATOR = "----------"

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Classifies MiniZinc's `--output-mode json` stdout into 0/1/2 solutions.
 * research.md Finding 2: unsatisfiable is a successful (exit 0) run whose stdout carries
 * the UNSATISFIABLE_MARKER, not a distinguishable exit code — so classification is done by
 * parsing stdout, never by branching on exit code.
 *
 * Total — every input produces a ClassifiedOutput value, never a thrown exception, so the
 * signature is honest about the one case this project doesn't expect to see (`UnrecognizedOutput`,
 * not part of SolveResult since it isn't a valid solving outcome). The one internal try/catch
 * exists solely to convert JSON.parse's own throw into that value at this function's boundary —
 * a boundary conversion, not exception-based control flow past it.
 */
export function classifySolutions(stdout: string): ClassifiedOutput {
  if (stdout.includes(UNSATISFIABLE_MARKER)) {
    return { _tag: "Unsatisfiable" }
  }

  let assignments: readonly Assignment[]
  try {
    assignments = stdout
      .split(SOLUTION_SEPARATOR)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0 && chunk !== SEARCH_COMPLETE_MARKER)
      .map((chunk) => JSON.parse(chunk) as Assignment)
  } catch (error) {
    return { _tag: "UnrecognizedOutput", stdout, message: errorMessage(error) }
  }

  if (assignments.length === 1) {
    return { _tag: "UniquelySolvable", assignment: assignments[0]! }
  }

  if (assignments.length >= 2) {
    return {
      _tag: "MultiplySatisfiable",
      assignments: [assignments[0]!, assignments[1]!],
    }
  }

  return {
    _tag: "UnrecognizedOutput",
    stdout,
    message: "no solutions and no unsatisfiable marker",
  }
}
