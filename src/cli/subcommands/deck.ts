import { buildCommand } from "@stricli/core"
import { Effect } from "effect"
import type { CompileError } from "../../compiler/types.ts"
import { loadDeckFile } from "../../deck/load.ts"
import { solveDeck } from "../../deck/solve.ts"
import type { AnswerError, DeckError, SolvedDeck } from "../../deck/types.ts"
import type { SolverError } from "../../solver/types.ts"
import { UserFacingError } from "../user-facing-error.ts"

interface DeckFlags {
  readonly json: boolean
}

function formatDeckError(error: DeckError): string {
  switch (error._tag) {
    case "MalformedDocument":
      return `The deck could not be read as a valid document: ${error.message}`
    case "DanglingReference":
      return `Card "${error.card}" has a "${error.field}" entry naming "${error.target}", which does not exist in this deck.`
    case "DependencyCycle":
      return `These cards depend on each other in a cycle: ${error.cards.join(" -> ")}.`
    case "UnsupportedTier":
      return `Card "${error.card}" declares tier "${error.tier}", but only "strict" is supported.`
    case "UnsupportedConstraintKind":
      return `Constraint "${error.constraintId}" uses kind "${error.kind}", which this format does not define.`
  }
}

function formatCompileError(error: CompileError): string {
  return `This deck's csp could not be compiled: ${error.reason}`
}

function formatSolverError(error: SolverError): string {
  switch (error._tag) {
    case "ToolchainUnavailable":
      return error.message
    case "ModelSyntaxError":
      return `The compiled model has a syntax or type error:\n${error.stderr}`
    case "SolverConfigError":
      return `Solver "${error.solverId}" is not available:\n${error.stderr}`
    case "Timeout":
      return `The solver did not finish within ${error.timeoutMs}ms.`
    case "UnexpectedExit":
      return `The solver exited unexpectedly (code ${error.exitCode}):\n${error.stderr}`
    case "UnexpectedOutput":
      return `The solver ran, but its output couldn't be understood: ${error.message}`
    case "FilesystemError":
      return `A local filesystem operation failed: ${error.message}`
  }
}

function formatAnswer(answer: string | AnswerError): string {
  switch (answer) {
    case "NoMatchingEntity":
      return "The closing question has no answer: no entity in the solution matches it."
    case "AmbiguousMatch":
      return "The closing question has no single answer: more than one entity in the solution matches it."
    default:
      return `Answer: ${answer}`
  }
}

function renderHuman(solved: SolvedDeck): string {
  switch (solved.outcome._tag) {
    case "Unsatisfiable":
      return "This deck's puzzle has no solution."
    case "MultiplySatisfiable":
      return "This deck's puzzle has more than one solution — it is not uniquely solvable."
    case "UniquelySolvable": {
      const answerLine = solved.answer === undefined ? "" : `${formatAnswer(solved.answer)}\n`
      const classificationLines = Object.entries(solved.classifications)
        .map(([cardId, classification]) => `  ${cardId}: ${JSON.stringify(classification)}`)
        .join("\n")
      return `${answerLine}Card classifications:\n${classificationLines}`
    }
  }
}

async function deckCommandFunc(flags: DeckFlags, deckPath: string): Promise<void> {
  const solved = await Effect.runPromise(
    loadDeckFile(deckPath).pipe(
      Effect.mapError((error): Error => new UserFacingError(formatDeckError(error))),
      Effect.flatMap((deck) =>
        solveDeck(deck).pipe(
          Effect.mapError(
            (error): Error =>
              new UserFacingError(
                "reason" in error ? formatCompileError(error) : formatSolverError(error),
              ),
          ),
        ),
      ),
    ),
  )

  console.log(flags.json ? JSON.stringify(solved) : renderHuman(solved))
}

export const deckCommand = buildCommand({
  func: deckCommandFunc,
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [{ brief: "Path to a deck YAML document", parse: String, placeholder: "deck.yaml" }],
    },
    flags: {
      json: {
        kind: "boolean",
        brief: "Print machine-readable JSON instead of human-readable text",
      },
    },
  },
  docs: {
    brief: "Validate and solve a deck YAML document (ADR-006)",
  },
})
