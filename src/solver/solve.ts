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
  type SolveFileRequest,
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

interface RunMinizincOptions {
  readonly modelPath: string
  // `| undefined` (not just `?:`) so callers can pass through an already-optional value as an
  // explicit key without tripping exactOptionalPropertyTypes.
  readonly dataPath?: string | undefined
  readonly solverId?: string | undefined
  readonly maxSolutions?: number | undefined
  readonly timeoutMs?: number | undefined
}

/**
 * Invoke minizinc against already-on-disk model/data files and classify the result.
 * Shared by solve() (which stages content into a temp dir first) and solveFile() (which
 * points straight at caller-supplied paths) so neither duplicates the other's solving logic.
 * Throws on failure — callers are responsible for translating via toSolverError.
 */
async function runMinizincAndClassify(options: RunMinizincOptions): Promise<SolveResult> {
  const args = [
    "-n",
    String(options.maxSolutions ?? DEFAULT_MAX_SOLUTIONS),
    "--output-mode",
    "json",
    "--solver",
    options.solverId ?? DEFAULT_SOLVER_ID,
  ]

  if (options.dataPath !== undefined) {
    args.push(options.dataPath)
  }

  args.push(options.modelPath)

  const { stdout } = await execFile("minizinc", args, {
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  })

  return classifySolutions(stdout)
}

/**
 * Solve a MiniZinc model given as content, classifying the result per data-model.md's
 * SolveResult. contracts/solve-contract.md: never throws, never leaves temp files behind.
 */
export function solve(request: SolveRequest): Effect.Effect<SolveResult, SolverError> {
  return Effect.gen(function* () {
    const tempDir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "minizinc-")))

    const result = yield* Effect.tryPromise({
      try: async () => {
        const modelPath = join(tempDir, "model.mzn")
        await writeFile(modelPath, request.model, "utf8")

        let dataPath: string | undefined
        if (request.data !== undefined) {
          dataPath = join(tempDir, "data.dzn")
          await writeFile(dataPath, request.data, "utf8")
        }

        return await runMinizincAndClassify({
          modelPath,
          dataPath,
          solverId: request.solverId,
          maxSolutions: request.maxSolutions,
          timeoutMs: request.timeoutMs,
        })
      },
      catch: toSolverError,
    }).pipe(
      Effect.ensuring(Effect.promise(() => rm(tempDir, { recursive: true, force: true }))),
    )

    return result
  })
}

/**
 * Solve a MiniZinc model given as an existing file path, per specs/003-cli-interface's
 * research.md Finding 4 — passes the caller's paths straight to minizinc, with no temp-file
 * staging or content buffering of its own, since it doesn't own those files.
 */
export function solveFile(request: SolveFileRequest): Effect.Effect<SolveResult, SolverError> {
  return Effect.tryPromise({
    try: () =>
      runMinizincAndClassify({
        modelPath: request.modelPath,
        dataPath: request.dataPath,
        solverId: request.solverId,
        maxSolutions: request.maxSolutions,
        timeoutMs: request.timeoutMs,
      }),
    catch: toSolverError,
  })
}
