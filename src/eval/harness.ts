import { Effect } from "effect"
import { compile } from "../compiler/compile.ts"
import type { ExtractedCsp, ExtractionError } from "../extraction/types.ts"
import { EXTRACTION_PROMPT_VERSION, extract, extractSingleShot, type ExtractOptions } from "../extraction/extract.ts"
import { solve } from "../solver/solve.ts"
import type { SolveResult, SolverError } from "../solver/types.ts"

// The seam alternative harnesses plug into. A harness owns everything from prose to a reached
// SolveResult — extraction strategy, prompts, tools, compiler, solver — and reports each stage
// separately so the runner can record per-stage failure detail without knowing the stages.
// Adding a harness is a new file plus a registry entry, never runner surgery.
//
// Design constraints (from the extraction/compiler layering in ADR-004/ADR-005):
// - The result is stage-separated (extracted / compiled / solved) rather than a single
//   SolveResult so EXTRACT_FAILED / COMPILE_FAILED / SOLVE_ERROR stay distinguishable and
//   each carries its own diagnostic — collapsing them would make failures undiagnosable.
// - `extractedCsp` is `unknown`, not `ExtractedCsp`: a harness with its own representation
//   (graph CSP, local NER output, a different schema) must still fit. Harnesses producing
//   this pipeline's ExtractedCsp SHOULD pass the decoded value through so the runner's
//   entity-vocabulary recovery keeps working; anything else leaves recovery to the harness.
// - Prompts are identified (`promptVersion`), never embedded: a prompt A/B is a new harness
//   id or a bumped version, so raw JSON can attribute a pass-rate shift to the prompt edit.
// - Effects stay lazy (`Effect.Effect`, never promises): the runner runs each stage through
//   its own `runStage` so one stage's failure keeps the earlier stages' already-succeeded
//   results for the raw JSON.

/** Model selection, resolved by the CLI layer (flags > env > defaults) before harnesses run. */
export interface HarnessModelOpts {
  readonly model?: string | undefined
  readonly frontierModel?: string | undefined
}

/** One stage's output: the value plus what the next stage needs. */
export interface HarnessExtraction {
  readonly extractedCsp: unknown
  readonly model: string
}

export interface HarnessCompilation {
  readonly extractedCsp: unknown
  readonly model: string
  readonly mzn: string
}

export interface HarnessSolution {
  readonly extractedCsp: unknown
  readonly model: string
  readonly mzn: string
  readonly solveResult: SolveResult
}

/** Failure of the extraction stage (LLM, local NER, graph builder — whatever the harness uses). */
export interface HarnessExtractionError {
  readonly _tag: "ExtractionFailed"
  readonly tag: string
  readonly detail: string
  /** Critic-loop attempts where applicable; null for single-shot harnesses. */
  readonly criticAttempts: number | null
}

export interface HarnessCompileError {
  readonly _tag: "CompileFailed"
  readonly reason: string
}

export interface HarnessSolveError {
  readonly _tag: "SolveFailed"
  readonly tag: string
  readonly detail: string
}

export interface EvalHarness {
  /** Stable id recorded in raw JSON (`harnessId`). New behavior => new id, never reuse. */
  readonly id: string
  /** Human-readable one-liner for the matrix plan and markdown reports. */
  readonly description: string
  /** Prompt set version; bump when prompt text changes (see EXTRACTION_PROMPT_VERSION). */
  readonly promptVersion: number
  /** Worst-case LLM calls per puzzle, for the pre-run budget estimate. 0 for fully local. */
  readonly maxCallsPerPuzzle: number
  readonly extract: (
    prose: string,
    modelOpts: HarnessModelOpts,
  ) => Effect.Effect<HarnessExtraction, HarnessExtractionError>
  readonly compile: (
    extraction: HarnessExtraction,
  ) => Effect.Effect<HarnessCompilation, HarnessCompileError>
  readonly solve: (compilation: HarnessCompilation) => Effect.Effect<HarnessSolution, HarnessSolveError>
}

// --- Shared stage adapters ----------------------------------------------------------------------
// These wrap the current pipeline's stages so the built-in harnesses below stay thin. A future
// harness with its own compiler/solver replaces the corresponding adapter, not the interface.

function toExtractionError(error: ExtractionError): HarnessExtractionError {
  return {
    _tag: "ExtractionFailed",
    tag: error._tag,
    detail: summarizeExtractionError(error),
    criticAttempts: error._tag === "CriticRejected" ? error.attempts.length : null,
  }
}

function summarizeExtractionError(error: ExtractionError): string {
  switch (error._tag) {
    case "ProviderError":
      return error.message
    case "SchemaRejected":
      return `model rejected schema: ${error.providerMessage.slice(0, 200)}`
    case "SchemaViolation":
      return `schema violation: ${error.detail}`
    case "CriticRejected":
      return `critic rejected after ${error.attempts.length} attempt(s): ${error.attempts.map((a) => a.critique.issues.join("; ")).join(" | ")}`
  }
}

function toSolveError(error: SolverError): HarnessSolveError {
  switch (error._tag) {
    case "ToolchainUnavailable":
      return { _tag: "SolveFailed", tag: error._tag, detail: error.message }
    case "ModelSyntaxError":
      return { _tag: "SolveFailed", tag: error._tag, detail: error.stderr.slice(0, 200) }
    case "SolverConfigError":
      return { _tag: "SolveFailed", tag: error._tag, detail: `solver "${error.solverId}": ${error.stderr.slice(0, 200)}` }
    case "Timeout":
      return { _tag: "SolveFailed", tag: error._tag, detail: `timed out after ${error.timeoutMs}ms` }
    case "UnexpectedExit":
      return { _tag: "SolveFailed", tag: error._tag, detail: `exit ${error.exitCode}: ${error.stderr.slice(0, 200)}` }
    case "UnexpectedOutput":
      return { _tag: "SolveFailed", tag: error._tag, detail: error.message }
    case "FilesystemError":
      return { _tag: "SolveFailed", tag: error._tag, detail: error.message }
  }
}

function compileExtractedCsp(extraction: HarnessExtraction): Effect.Effect<HarnessCompilation, HarnessCompileError> {
  return compile(extraction.extractedCsp as ExtractedCsp).pipe(
    Effect.map((mzn): HarnessCompilation => ({ ...extraction, mzn })),
    Effect.catch((error) => Effect.fail<HarnessCompileError>({ _tag: "CompileFailed", reason: error.reason })),
  )
}

function solveMzn(compilation: HarnessCompilation): Effect.Effect<HarnessSolution, HarnessSolveError> {
  return solve({ model: compilation.mzn }).pipe(
    Effect.map((solveResult): HarnessSolution => ({ ...compilation, solveResult })),
    Effect.catch((error) => Effect.fail(toSolveError(error))),
  )
}

function extractWith(
  run: (prose: string, modelOpts: ExtractOptions) => Effect.Effect<{ extractedCsp: ExtractedCsp; model: string }, ExtractionError>,
): EvalHarness["extract"] {
  return (prose, modelOpts) =>
    run(prose, modelOpts).pipe(
      Effect.catch((error) => Effect.fail(toExtractionError(error))),
    )
}

// --- Built-in harnesses ---------------------------------------------------------------------------
// The three workflows the eval runner previously hardcoded as `if` branches. Ids are stable:
// historical raw JSON records `workflow` ("full" | "no-critic" | "compile-repair-only"); new
// records carry both `workflow` (for continuity) and `harnessId` (the future-proof key).

/** (a) ADR-004's full fidelity critic loop: cheap tier, escalate to frontier on exhaustion. */
export const fullCriticHarness: EvalHarness = {
  id: "full-critic",
  description: "extract→critique→revise with frontier escalation (ADR-004)",
  promptVersion: EXTRACTION_PROMPT_VERSION,
  maxCallsPerPuzzle: 12,
  extract: extractWith(extract),
  compile: compileExtractedCsp,
  solve: solveMzn,
}

/** (b) Single-shot, no critic: one cheap-tier call, failures fail outright. */
export const singleShotHarness: EvalHarness = {
  id: "single-shot",
  description: "one cheap-tier extraction call, no critic",
  promptVersion: EXTRACTION_PROMPT_VERSION,
  maxCallsPerPuzzle: 1,
  extract: extractWith(extractSingleShot),
  compile: compileExtractedCsp,
  solve: solveMzn,
}

/**
 * One repair re-extraction after a compile failure, carrying the compiler's error as context.
 * The probe compile's error channel is folded to an Option (none = compiled fine, keep the
 * extraction) so the repair prompt keeps the reason in scope without the compile error type
 * leaking into this harness's own error channel.
 */
function repairAfterCompileFailure(
  prose: string,
  modelOpts: HarnessModelOpts,
  extraction: { readonly extractedCsp: ExtractedCsp; readonly model: string },
): Effect.Effect<{ readonly extractedCsp: ExtractedCsp; readonly model: string }, HarnessExtractionError> {
  // Probe: null when the extraction compiles (keep it), the reason when it doesn't (repair).
  const probe: Effect.Effect<string | null, never, never> = compile(extraction.extractedCsp).pipe(
    Effect.map(() => null as string | null),
    Effect.catch((compileError) => Effect.succeed<string | null>(compileError.reason)),
  )
  return probe.pipe(
    Effect.flatMap((reason) =>
      reason === null
        ? Effect.succeed(extraction)
        : extractSingleShot(
            `${prose}\n\nA previous attempt failed to compile with this error — avoid it:\n${reason}`,
            modelOpts,
          ),
    ),
    Effect.catch((error) => Effect.fail(toExtractionError(error))),
  )
}

/**
 * (c) Extract plus compile-error repair retry with no fidelity critic. The repair loop lives in
 * the harness's extract stage (not the extraction module) so the compiler stays out of that
 * module's dependency closure (ADR-004/ADR-005 layering). One repair re-extraction on compile
 * failure, carrying the compiler's error as context, then the result stands as-is.
 */
export const compileRepairHarness: EvalHarness = {
  id: "compile-repair",
  description: "single-shot plus one compile-error repair retry, no fidelity critic",
  promptVersion: EXTRACTION_PROMPT_VERSION,
  maxCallsPerPuzzle: 2,
  extract: (prose, modelOpts) =>
    extractSingleShot(prose, modelOpts).pipe(
      Effect.catch((error) => Effect.fail(toExtractionError(error))),
      Effect.flatMap((extraction) => repairAfterCompileFailure(prose, modelOpts, extraction)),
    ),
  compile: compileExtractedCsp,
  solve: solveMzn,
}

/**
 * Local single-shot harness for an OpenAI-compatible local server (LM Studio, Ollama-style,
 * selected via ZEBRA_LOCAL_BASE_URL). Same single-shot shape as (b) — the routing difference
 * lives in the provider layer (`resolveProviderRoute`), not here — but a separate id so runs
 * against local models are attributable in raw JSON, and a separate budget (single-shot calls
 * only; $0 spend, still counted). Model selection: pass --model with the server's own model id
 * (from its /v1/models); there is no registry default for local models. Local inference is far
 * slower than hosted tiers, so this harness allows a generous per-call timeout
 * (ZEBRA_LOCAL_TIMEOUT_MS, default 10 minutes).
 */
export const localSingleShotHarness: EvalHarness = {
  id: "local-single-shot",
  description: "single-shot via ZEBRA_LOCAL_BASE_URL (LM Studio et al), no critic",
  promptVersion: EXTRACTION_PROMPT_VERSION,
  maxCallsPerPuzzle: 1,
  extract: (prose, modelOpts) =>
    extractWith((p, o) =>
      extractSingleShot(p, {
        ...o,
        timeoutMs: Number(process.env.ZEBRA_LOCAL_TIMEOUT_MS ?? 600_000),
      }),
    )(prose, modelOpts),
  compile: compileExtractedCsp,
  solve: solveMzn,
}

// --- Registry ---------------------------------------------------------------------------------------

const BUILT_IN_HARNESSES: readonly EvalHarness[] = [
  fullCriticHarness,
  singleShotHarness,
  compileRepairHarness,
  localSingleShotHarness,
]

/** CLI flag (old `Workflow` values) → harness id, preserving existing flag behavior. */
export const WORKFLOW_TO_HARNESS_ID: Record<string, string> = {
  full: fullCriticHarness.id,
  "no-critic": singleShotHarness.id,
  "compile-repair-only": compileRepairHarness.id,
}

export function lookupHarness(id: string, extra: readonly EvalHarness[] = []): EvalHarness | undefined {
  return [...extra, ...BUILT_IN_HARNESSES].find((h) => h.id === id)
}

export function listHarnesses(extra: readonly EvalHarness[] = []): readonly EvalHarness[] {
  return [...BUILT_IN_HARNESSES, ...extra]
}
