import { buildCommand } from "@stricli/core"
import { Effect } from "effect"
import { solveFile } from "../../solver/solve.ts"
import type { SolverError, SolveResult } from "../../solver/types.ts"

interface SolveFlags {
  readonly data?: string
  readonly solver?: string
  readonly json: boolean
}

function renderHuman(result: SolveResult): string {
  switch (result._tag) {
    case "Unsatisfiable":
      return "This puzzle has no solution."
    case "UniquelySolvable":
      return `This puzzle has exactly one solution:\n${JSON.stringify(result.assignment, null, 2)}`
    case "MultiplySatisfiable":
      return "This puzzle has more than one solution — it is not uniquely solvable."
  }
}

function formatSolverError(error: SolverError): string {
  switch (error._tag) {
    case "ToolchainUnavailable":
      return error.message
    case "ModelSyntaxError":
      return `The model has a syntax or type error:\n${error.stderr}`
    case "SolverConfigError":
      return `Solver "${error.solverId}" is not available:\n${error.stderr}`
    case "Timeout":
      return `The solver did not finish within ${error.timeoutMs}ms.`
    case "UnexpectedExit":
      return `The solver exited unexpectedly (code ${error.exitCode}):\n${error.stderr}`
  }
}

async function solveCommandFunc(flags: SolveFlags, modelPath: string): Promise<void> {
  const result = await Effect.runPromise(
    solveFile({ modelPath, dataPath: flags.data, solverId: flags.solver }).pipe(
      Effect.mapError((error) => new Error(formatSolverError(error))),
    ),
  )

  console.log(flags.json ? JSON.stringify(result) : renderHuman(result))
}

export const solve = buildCommand({
  func: solveCommandFunc,
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        { brief: "Path to a MiniZinc model file", parse: String, placeholder: "model.mzn" },
      ],
    },
    flags: {
      data: {
        kind: "parsed",
        brief: "Path to a MiniZinc data file",
        parse: String,
        optional: true,
      },
      solver: {
        kind: "parsed",
        brief: "Solver id to use (defaults to Gecode)",
        parse: String,
        optional: true,
      },
      json: {
        kind: "boolean",
        brief: "Print machine-readable JSON instead of human-readable text",
      },
    },
  },
  docs: {
    brief: "Solve a MiniZinc model and report the outcome",
  },
})
