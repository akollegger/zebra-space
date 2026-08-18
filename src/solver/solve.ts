import { execFile as execFileCallback } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { Effect, Option } from "effect"
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toFilesystemError(error: unknown): FilesystemError {
  return new FilesystemError({ message: errorMessage(error) })
}

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

interface MinizincArgsOptions {
  readonly modelPath: string
  readonly dataPath?: string | undefined
  readonly solverId: string
}

/** Pure: the exact `minizinc` CLI arguments for an already-resolved set of options. */
function buildMinizincArgs(options: MinizincArgsOptions): readonly string[] {
  const base = [
    "-n",
    String(DEFAULT_MAX_SOLUTIONS),
    "--output-mode",
    "json",
    "--solver",
    options.solverId,
  ]
  return options.dataPath !== undefined
    ? [...base, options.dataPath, options.modelPath]
    : [...base, options.modelPath]
}

/**
 * Invoke minizinc against already-on-disk model/data files and classify the result.
 * Shared by solve() (which stages content into a temp dir first) and solveFile() (which
 * points straight at caller-supplied paths) so neither duplicates the other's solving logic.
 *
 * Always requests exactly DEFAULT_MAX_SOLUTIONS (2) — per data-model.md, this is fixed, not
 * caller-configurable (FR-002).
 */
function runMinizincAndClassify(options: SolveFileRequest): Effect.Effect<SolveResult, SolverError> {
  const resolved: ResolvedRunOptions = {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    solverId: options.solverId ?? DEFAULT_SOLVER_ID,
  }

  const args = buildMinizincArgs({
    modelPath: options.modelPath,
    dataPath: options.dataPath,
    solverId: resolved.solverId,
  })

  return Effect.tryPromise({
    try: () => execFile("minizinc", args, { timeout: resolved.timeoutMs }),
    catch: (error) => toSolverError(error, resolved),
  }).pipe(
    Effect.flatMap(({ stdout }) => {
      const classified = classifySolutions(stdout)
      return classified._tag === "UnrecognizedOutput"
        ? Effect.fail(new UnexpectedOutput({ stdout: classified.stdout, message: classified.message }))
        : Effect.succeed(classified)
    }),
  )
}

/**
 * Run `use` with a freshly created temp directory, guaranteeing cleanup. Cleanup failure is
 * an operational error, not a solving-semantics concern — it MUST override an otherwise-
 * successful (or differently-failed) `use` outcome (PR #4 review discussion), the same way a
 * `finally` block's own throw would, made explicit here via Effect.match rather than relying
 * on that implicit behavior (Biome's noUnsafeFinally rightly flags the implicit version).
 *
 * Not built on Effect.acquireRelease/Scope, despite this being a textbook acquire-use-release
 * shape (effect's own ai-docs/05_resources/10_acquire-release.ts shows the same pattern for a
 * long-lived resource): acquireRelease's release function is typed `Effect<unknown, never, R>`
 * — a finalizer can't have a typed failure, only a defect — which would silently turn a
 * cleanup failure back into an untyped defect, undoing the fix this function exists for.
 */
function withTemporaryDirectory<A>(use: (dir: string) => Effect.Effect<A, SolverError>) {
  return Effect.gen(function* () {
    const dir = yield* Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "minizinc-")),
      catch: toFilesystemError,
    })

    const attempt = yield* use(dir).pipe(
      Effect.match({
        onFailure: (error) => ({ ok: false as const, error }),
        onSuccess: (value) => ({ ok: true as const, value }),
      }),
    )

    yield* Effect.tryPromise({
      try: () => rm(dir, { recursive: true, force: true }),
      catch: toFilesystemError,
    })

    if (!attempt.ok) {
      return yield* Effect.fail(attempt.error)
    }
    return attempt.value
  })
}

function solveInDirectory(request: SolveRequest, tempDir: string): Effect.Effect<SolveResult, SolverError> {
  return Effect.gen(function* () {
    const modelPath = join(tempDir, "model.mzn")
    yield* Effect.tryPromise({
      try: () => writeFile(modelPath, request.model, "utf8"),
      catch: toFilesystemError,
    })

    const dataPath = yield* Option.fromUndefinedOr(request.data).pipe(
      Option.match({
        onNone: () => Effect.succeed(undefined),
        onSome: (data) => {
          const path = join(tempDir, "data.dzn")
          return Effect.tryPromise({
            try: () => writeFile(path, data, "utf8"),
            catch: toFilesystemError,
          }).pipe(Effect.as(path))
        },
      }),
    )

    return yield* runMinizincAndClassify({
      modelPath,
      dataPath,
      solverId: request.solverId,
      timeoutMs: request.timeoutMs,
    })
  })
}

/**
 * Solve a MiniZinc model given as content, classifying the result per data-model.md's
 * SolveResult. contracts/solve-contract.md: never throws, never leaves temp files behind.
 */
export function solve(request: SolveRequest): Effect.Effect<SolveResult, SolverError> {
  return withTemporaryDirectory((tempDir) => solveInDirectory(request, tempDir))
}

/**
 * Solve a MiniZinc model given as an existing file path, per specs/003-cli-interface's
 * research.md Finding 4 — passes the caller's paths straight to minizinc, with no temp-file
 * staging or content buffering of its own, since it doesn't own those files.
 */
export function solveFile(request: SolveFileRequest): Effect.Effect<SolveResult, SolverError> {
  return runMinizincAndClassify(request)
}
