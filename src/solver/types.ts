import { Data } from "effect"

export interface SolveRequest {
  readonly model: string
  readonly data?: string
  readonly solverId?: string
  readonly timeoutMs?: number
}

export interface SolveFileRequest {
  readonly modelPath: string
  // `| undefined` (not just `?:`) so callers can pass through an already-optional value (e.g.
  // `flags.data`) as an explicit key without tripping exactOptionalPropertyTypes.
  readonly dataPath?: string | undefined
  readonly solverId?: string | undefined
  readonly timeoutMs?: number | undefined
}

export type Assignment = Record<string, unknown>

export interface Unsatisfiable {
  readonly _tag: "Unsatisfiable"
}

export interface UniquelySolvable {
  readonly _tag: "UniquelySolvable"
  readonly assignment: Assignment
}

export interface MultiplySatisfiable {
  readonly _tag: "MultiplySatisfiable"
  readonly assignments: readonly [Assignment, Assignment]
}

export type SolveResult = Unsatisfiable | UniquelySolvable | MultiplySatisfiable

export class ToolchainUnavailable extends Data.TaggedError("ToolchainUnavailable")<{
  readonly message: string
}> {}

export class ModelSyntaxError extends Data.TaggedError("ModelSyntaxError")<{
  readonly stderr: string
}> {}

export class SolverConfigError extends Data.TaggedError("SolverConfigError")<{
  readonly solverId: string
  readonly stderr: string
}> {}

export class Timeout extends Data.TaggedError("Timeout")<{
  readonly timeoutMs: number
}> {}

export class UnexpectedExit extends Data.TaggedError("UnexpectedExit")<{
  readonly exitCode: number
  readonly stderr: string
}> {}

export class UnexpectedOutput extends Data.TaggedError("UnexpectedOutput")<{
  readonly stdout: string
  readonly message: string
}> {}

export class FilesystemError extends Data.TaggedError("FilesystemError")<{
  readonly message: string
}> {}

export type SolverError =
  | ToolchainUnavailable
  | ModelSyntaxError
  | SolverConfigError
  | Timeout
  | UnexpectedExit
  | UnexpectedOutput
  | FilesystemError
