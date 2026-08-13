import { execFile as execFileCallback } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { Effect } from "effect"
import { classifySolutions } from "./parse.ts"
import {
  ModelSyntaxError,
  SolverConfigError,
  Timeout,
  ToolchainUnavailable,
  UnexpectedExit,
  type SolveRequest,
  type SolveResult,
  type SolverError,
} from "./types.ts"

const execFile = promisify(execFileCallback)

const DEFAULT_SOLVER_ID = "Gecode"
const DEFAULT_MAX_SOLUTIONS = 2
const DEFAULT_TIMEOUT_MS = 30_000

interface ExecFileError {
  readonly code?: string | number
  readonly killed?: boolean
  readonly stdout?: string
  readonly stderr?: string
}

function toSolverError(error: unknown): SolverError {
  const err = error as ExecFileError

  if (err.code === "ENOENT") {
    return new ToolchainUnavailable({ message: "minizinc executable not found on PATH" })
  }

  if (err.killed) {
    return new Timeout({ timeoutMs: DEFAULT_TIMEOUT_MS })
  }

  const stderr = err.stderr ?? ""

  if (stderr.includes("configuration error")) {
    return new SolverConfigError({ solverId: DEFAULT_SOLVER_ID, stderr })
  }

  if (stderr.includes("syntax error") || stderr.includes("type error")) {
    return new ModelSyntaxError({ stderr })
  }

  return new UnexpectedExit({
    exitCode: typeof err.code === "number" ? err.code : -1,
    stderr,
  })
}

/**
 * Solve a MiniZinc model, classifying the result per data-model.md's SolveResult.
 * contracts/solve-contract.md: never throws, never leaves temp files behind.
 */
export function solve(request: SolveRequest): Effect.Effect<SolveResult, SolverError> {
  return Effect.gen(function* () {
    const tempDir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "minizinc-")))

    const result = yield* Effect.tryPromise({
      try: async () => {
        const modelPath = join(tempDir, "model.mzn")
        await writeFile(modelPath, request.model, "utf8")

        const args = [
          "-n",
          String(request.maxSolutions ?? DEFAULT_MAX_SOLUTIONS),
          "--output-mode",
          "json",
          "--solver",
          request.solverId ?? DEFAULT_SOLVER_ID,
        ]

        if (request.data !== undefined) {
          const dataPath = join(tempDir, "data.dzn")
          await writeFile(dataPath, request.data, "utf8")
          args.push(dataPath)
        }

        args.push(modelPath)

        const { stdout } = await execFile("minizinc", args, {
          timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        })

        return classifySolutions(stdout)
      },
      catch: toSolverError,
    }).pipe(
      Effect.ensuring(Effect.promise(() => rm(tempDir, { recursive: true, force: true }))),
    )

    return result
  })
}
