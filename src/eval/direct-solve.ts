import { OpenRouter } from "@openrouter/sdk"
import { OpenRouterError } from "@openrouter/sdk/models/errors"
import { Effect, Schema } from "effect"
import { requestStructuredCompletion, resolveBaseRoute } from "../extraction/provider.ts"
import { ProviderError, toProviderSchema } from "../extraction/types.ts"
import type { Assignment, SolveResult } from "../solver/types.ts"
import type { EvalHarness, HarnessModelOpts } from "./harness.ts"

export type DirectSolveModelOpts = HarnessModelOpts

// Baseline harness: ask the model to solve the puzzle directly in prose, then have a judge
// model convert that prose into a structured verdict our grader scores (ADR-008). This
// separates "can't reason about this puzzle" from "can't speak our ExtractedCsp schema" —
// without the baseline, every extraction failure is ambiguous between the two, and the
// schema tax (extraction pass rate vs. direct-solve rate) can't be measured.
//
// Judge proposes, grader disposes: the judge emits a structured verdict, and the existing
// per-class grading in grader.ts scores the resulting SolveResult. No new grading semantics.

// --- Prompt versions ----------------------------------------------------------------------
// Matched fixed prompts: the SAME wording for every model, so model comparisons don't inherit
// prompt differences. Versioned like the extraction prompts: a wording change bumps the
// version, and runs record it, so a pass-rate shift is attributable to the prompt edit.

export const DIRECT_SOLVE_PROMPT_VERSION = 1

function solveSystemPrompt(): string {
  return [
    "You are solving a logic puzzle. Read the puzzle prose carefully and solve it.",
    "Show your reasoning, then state the final answer clearly at the end.",
    "If the puzzle has a unique solution, give it. If it has multiple solutions or no",
    "solution, say so explicitly instead of guessing one.",
  ].join("\n")
}

function solveUserPrompt(prose: string): string {
  return `Solve this puzzle:\n\n${prose}`
}

function judgeSystemPrompt(): string {
  return [
    "You are grading a puzzle solution. You receive the puzzle prose and a solver model's",
    "prose answer. Convert the answer into the DirectSolutionVerdict tool call.",
    "Rules:",
    "- outcome 'unique': the solver states exactly one solution. Record its assignment as one",
    "  record mapping field names to values (strings or numbers only).",
    "- outcome 'multiple': the solver states several solutions or says the puzzle is",
    "  underdetermined. Record up to two assignments.",
    "- outcome 'unsatisfiable': the solver states the puzzle has no solution.",
    "- outcome 'unclear': the solver's answer is incoherent, refuses, or states no determinate",
    "  result. Record no assignments.",
    "Transcribe values EXACTLY as the solver wrote them — preserve capitalization and spelling",
    "('Paper', not 'paper'). The grader compares case-sensitively; normalizing breaks grading.",
    "Judge ONLY what the solver wrote — never solve the puzzle yourself, never fill in gaps",
    "from the prose. A fluent but answer-free response is 'unclear', not 'unique'.",
  ].join("\n")
}

function judgeUserPrompt(prose: string, solution: string): string {
  return `Puzzle prose:\n\n${prose}\n\nSolver answer:\n\n${solution}`
}

// --- Judge verdict schema -------------------------------------------------------------------

/**
 * The judge's structured verdict. Assignments are free-form records (field -> scalar),
 * not ExtractedCsp — the judge transcribes what the solver claimed, and grader.ts decides
 * whether it matches the answer key. Capped at two assignments (mirrors the solver's
 * 2-solution cap; a third distinct solution adds no grading signal downstream).
 */
export const DirectSolutionVerdict = Schema.Struct({
  outcome: Schema.Union([
    Schema.Literal("unique"),
    Schema.Literal("multiple"),
    Schema.Literal("unsatisfiable"),
    Schema.Literal("unclear"),
  ]),
  assignments: Schema.Array(Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number]))),
})

export type DirectSolutionVerdict = Schema.Schema.Type<typeof DirectSolutionVerdict>

const directSolutionVerdictJsonSchema = toProviderSchema(DirectSolutionVerdict)

/**
 * Maps a judge verdict to the SolveResult the grader scores. 'unclear' has no SolveResult
 * equivalent — the caller surfaces it as JudgeUnclear, not as a fabricated outcome.
 */
export function toSolveResult(
  verdict: DirectSolutionVerdict,
): { readonly _tag: "Ok"; readonly solveResult: SolveResult } | { readonly _tag: "Unclear" } {
  switch (verdict.outcome) {
    case "unique":
      return {
        _tag: "Ok",
        solveResult: {
          _tag: "UniquelySolvable",
          assignment: (verdict.assignments[0] ?? {}) as Assignment,
        },
      }
    case "multiple": {
      const [first, second] = verdict.assignments
      return {
        _tag: "Ok",
        solveResult: {
          _tag: "MultiplySatisfiable",
          assignments: [(first ?? {}) as Assignment, (second ?? first ?? {}) as Assignment],
        },
      }
    }
    case "unsatisfiable":
      return { _tag: "Ok", solveResult: { _tag: "Unsatisfiable" } }
    case "unclear":
      return { _tag: "Unclear" }
  }
}

// --- Harness ----------------------------------------------------------------------------------

const DEFAULT_JUDGE_MODEL = "z-ai/glm-5.3-flash"

export interface DirectSolveFailure {
  readonly _tag: "ExtractionFailed"
  readonly tag: "ProviderError" | "SchemaRejected" | "SchemaViolation" | "JudgeUnclear"
  readonly detail: string
  readonly criticAttempts: null
}

function toFailure(tag: DirectSolveFailure["tag"], detail: string): DirectSolveFailure {
  return { _tag: "ExtractionFailed", tag, detail, criticAttempts: null }
}

/**
 * Baseline harness (ADR-008): direct solve in prose, then judge to structured verdict.
 * Two LLM calls per puzzle (solve + judge). The judge model defaults to z-ai/glm-5.3-flash
 * and is overridden by ZEBRA_JUDGE_MODEL (env) or --judge-model (flag, wins). There is no
 * MiniZinc involved: compile passes the prose solution through as context, solve returns the
 * judged SolveResult. promptVersion covers BOTH prompts — either wording change bumps it.
 */
export const directSolveHarness: EvalHarness = {
  id: "direct-solve",
  description: "direct solve in prose, GLM judge to structured verdict (ADR-008 baseline)",
  promptVersion: DIRECT_SOLVE_PROMPT_VERSION,
  maxCallsPerPuzzle: 2,
  extract: (prose, modelOpts: DirectSolveModelOpts) =>
    Effect.gen(function* () {
      const solverModel = modelOpts.model ?? "openai/gpt-4o-mini"
      const judgeModel = modelOpts.judgeModel ?? process.env.ZEBRA_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL
      const solution = yield* requestProseCompletion({
        model: solverModel,
        systemPrompt: solveSystemPrompt(),
        userPrompt: solveUserPrompt(prose),
      })
      const verdict = yield* requestStructuredCompletion({
        model: judgeModel,
        systemPrompt: judgeSystemPrompt(),
        userPrompt: judgeUserPrompt(prose, solution),
        schemaName: "DirectSolutionVerdict",
        jsonSchema: directSolutionVerdictJsonSchema,
        schema: DirectSolutionVerdict,
      })
      const mapped = toSolveResult(verdict)
      if (mapped._tag === "Unclear") {
        return yield* Effect.fail(toFailure("JudgeUnclear", "judge could not determine a solution from the solver's answer"))
      }
      // The judged SolveResult travels inside extractedCsp (this harness has no MiniZinc);
      // compile passes it through, solve lifts it out for the grader.
      return {
        extractedCsp: { directSolution: solution, judgeVerdict: verdict, solveResult: mapped.solveResult },
        model: solverModel,
      }
    }).pipe(
      Effect.catch((error) => {
        if (typeof error === "object" && error !== null && "_tag" in error && error._tag === "ExtractionFailed") {
          return Effect.fail(error as DirectSolveFailure)
        }
        const e = error as { _tag?: string; message?: string; providerMessage?: string; detail?: string }
        if (e._tag === "SchemaRejected") return Effect.fail(toFailure("SchemaRejected", e.providerMessage ?? "judge rejected schema"))
        if (e._tag === "SchemaViolation") return Effect.fail(toFailure("SchemaViolation", e.detail ?? "judge response invalid"))
        return Effect.fail(toFailure("ProviderError", e.message ?? String(error)))
      }),
    ),
  compile: (extraction) =>
    Effect.succeed({
      extractedCsp: extraction.extractedCsp,
      model: extraction.model,
      mzn: null,
    }),
  solve: (compilation) =>
    Effect.succeed({
      extractedCsp: compilation.extractedCsp,
      model: compilation.model,
      mzn: compilation.mzn,
      solveResult: (compilation.extractedCsp as { solveResult: SolveResult }).solveResult,
    }),
}

// --- Prose completion ---------------------------------------------------------------------------
// The solver step is deliberately NOT a forced tool call: the baseline measures what the model
// produces in its own notation (sections, tables, grids), exactly like the free-form sessions
// that motivated ADR-008. Structured output enters only at the judge step.

const PROSE_TIMEOUT_MS = 300_000

function requestProseCompletion(request: {
  readonly model: string
  readonly systemPrompt: string
  readonly userPrompt: string
}): Effect.Effect<string, ProviderError> {
  const route = resolveBaseRoute()
  const client = new OpenRouter({
    apiKey: route.apiKey,
    ...(route.serverURL !== undefined ? { serverURL: route.serverURL } : {}),
  })
  return Effect.tryPromise({
    try: () =>
      client.chat.send(
        {
          chatRequest: {
            model: request.model,
            messages: [
              { role: "system", content: request.systemPrompt },
              { role: "user", content: request.userPrompt },
            ],
          },
        },
        { retries: { strategy: "none" }, timeoutMs: PROSE_TIMEOUT_MS },
      ),
    catch: (error) =>
      new ProviderError({
        message: error instanceof OpenRouterError ? error.message : error instanceof Error ? error.message : String(error),
      }),
  }).pipe(
    Effect.timeout(PROSE_TIMEOUT_MS),
    Effect.catchTag("TimeoutError", () =>
      Effect.fail(new ProviderError({ message: `Direct solve by ${request.model} timed out after ${PROSE_TIMEOUT_MS}ms` })),
    ),
    Effect.flatMap((response) => {
      if (!("choices" in response)) {
        return Effect.fail(new ProviderError({ message: "Received a streamed response; direct-solve only sends non-streaming requests." }))
      }
      const rawContent = response.choices[0]?.message?.content ?? ""
      const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent)
      if (content.trim() === "") {
        return Effect.fail(new ProviderError({ message: `Direct solve by ${request.model} returned empty content` }))
      }
      return Effect.succeed(content)
    }),
  )
}
