import { Data } from "effect"

// `| undefined` (not just `?:`) on both fields so callers can pass through an already-optional
// value (e.g. `flags.data`) as an explicit key without tripping exactOptionalPropertyTypes.
export interface SolverOptions {
  readonly solverId?: string | undefined
  readonly timeoutMs?: number | undefined
}

export interface SolveRequest extends SolverOptions {
  readonly model: string
  readonly data?: string | undefined
}

export interface SolveFileRequest extends SolverOptions {
  readonly modelPath: string
  readonly dataPath?: string | undefined
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

// Not part of SolveResult — an unrecognized-output classification isn't a valid solving
// outcome, it's an operational problem (same principle as cleanup failure vs. solving
// semantics). classifySolutions (parse.ts) returns this instead of throwing, so its own
// signature is honest about every value it can produce; solve.ts converts it to the typed
// UnexpectedOutput SolverError.
export interface UnrecognizedOutput {
  readonly _tag: "UnrecognizedOutput"
  readonly stdout: string
  readonly message: string
}

export type ClassifiedOutput = SolveResult | UnrecognizedOutput

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
