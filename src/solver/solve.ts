import { execFile as execFileCallback } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { Effect } from "effect"
import { classifySolutions } from "./parse.ts"
import {
  FilesystemError,
  ModelSyntaxError,
  SolverConfigError,
  Timeout,
  ToolchainUnavailable,
  UnexpectedExit,
  UnexpectedOutput,
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

interface ResolvedRunOptions {
  readonly timeoutMs: number
  readonly solverId: string
}

/** Translates an execFile failure into a typed SolverError, using the *actually-resolved*
 * timeout/solver id (not just their defaults) so the error payload reflects what really ran.
 */
function toSolverError(error: unknown, resolved: ResolvedRunOptions): SolverError {
  const err = error as ExecFileError

  if (err.code === "ENOENT") {
    return new ToolchainUnavailable({ message: "minizinc executable not found on PATH" })
  }

  if (err.killed) {
    return new Timeout({ timeoutMs: resolved.timeoutMs })
  }

  const stderr = err.stderr ?? ""

  if (stderr.includes("configuration error")) {
    return new SolverConfigError({ solverId: resolved.solverId, stderr })
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
  readonly timeoutMs?: number | undefined
}

/**
 * Invoke minizinc against already-on-disk model/data files and classify the result.
 * Shared by solve() (which stages content into a temp dir first) and solveFile() (which
 * points straight at caller-supplied paths) so neither duplicates the other's solving logic.
 *
 * Always requests exactly DEFAULT_MAX_SOLUTIONS (2) — per data-model.md, this is fixed, not
 * caller-configurable (FR-002).
 *
 * Throws an already-typed SolverError on failure (never a raw execFile/parse error) — execFile
 * failures and classifySolutions failures are distinguished and translated at their own call
 * site, since they're different failure modes (the solver failing to run vs. the solver running
 * fine but producing output this project doesn't recognize).
 */
async function runMinizincAndClassify(options: RunMinizincOptions): Promise<SolveResult> {
  const resolved: ResolvedRunOptions = {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    solverId: options.solverId ?? DEFAULT_SOLVER_ID,
  }

  const args = [
    "-n",
    String(DEFAULT_MAX_SOLUTIONS),
    "--output-mode",
    "json",
    "--solver",
    resolved.solverId,
  ]

  if (options.dataPath !== undefined) {
    args.push(options.dataPath)
  }

  args.push(options.modelPath)

  let stdout: string
  try {
    ;({ stdout } = await execFile("minizinc", args, { timeout: resolved.timeoutMs }))
  } catch (error) {
    throw toSolverError(error, resolved)
  }

  try {
    return classifySolutions(stdout)
  } catch (error) {
    throw new UnexpectedOutput({
      stdout,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Solve a MiniZinc model given as content, classifying the result per data-model.md's
 * SolveResult. contracts/solve-contract.md: never throws, never leaves temp files behind.
 */
export function solve(request: SolveRequest): Effect.Effect<SolveResult, SolverError> {
  return Effect.gen(function* () {
    const tempDir = yield* Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "minizinc-")),
      catch: (error) =>
        new FilesystemError({
          message: error instanceof Error ? error.message : String(error),
        }),
    })

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
          timeoutMs: request.timeoutMs,
        })
      },
      catch: (error) => error as SolverError,
    }).pipe(
      // NOTE: cleanup-failure handling is an open discussion (see PR #4 review) — should a
      // failed rm() here override an otherwise-successful result? Left as Effect.promise
      // (best-effort, not yet typed) pending that decision.
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
        timeoutMs: request.timeoutMs,
      }),
    catch: (error) => error as SolverError,
  })
}
