import { OpenRouter } from "@openrouter/sdk"
import { OpenRouterError } from "@openrouter/sdk/models/errors"
import { Effect, Schema } from "effect"
import { requestStructuredCompletion, resolveBaseRoute } from "../extraction/provider.ts"
import { ProviderError, toProviderSchema } from "../extraction/types.ts"
import type { EvalHarness, HarnessModelOpts } from "./harness.ts"

export type DirectSolveModelOpts = HarnessModelOpts

// Baseline harness: ask the model to solve the puzzle directly in prose, then have a judge
// model GRADE that prose against the answer key (ADR-008). This separates "can't reason
// about this puzzle" from "can't speak our ExtractedCsp schema" — without the baseline,
// every extraction failure is ambiguous between the two, and the schema tax (extraction
// pass rate vs. direct-solve rate) can't be measured.
//
// The judge JUDGES — it does not transcribe. An earlier revision had the judge emit the
// solution as structured assignments for our grader to score; that reduced the judge to a
// lossy serializer (empty records, comma-joined strings, incoherent keys, prose transcribed
// as answers — three prompt revisions changed failure shape, never rate). Semantic
// comparison with paraphrase tolerance is what LLMs do well; lossless structured emission
// is what they do poorly. The verdict schema below has no transcription surface.

// --- Prompt versions ----------------------------------------------------------------------
// Matched fixed prompts: the SAME wording for every model, so model comparisons don't inherit
// prompt differences. Versioned like the extraction prompts: a wording change bumps the
// version, and runs record it, so a pass-rate shift is attributable to the prompt edit.

export const DIRECT_SOLVE_PROMPT_VERSION = 2

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
    "You are grading a puzzle solution against its answer key. You receive the puzzle prose,",
    "a solver model's prose answer, and the expected answer with its outcome class. Compare",
    "the solver's FULL solution (every assigned value, not just the headline answers) against",
    "the expectation for that class and return the JudgeVerdict tool call:",
    "",
    "- determinate: the solver must state the unique solution and every value must match the",
    "  expected answer (paraphrases allowed: 'hardcover book set' for 'book_set'; pairing and",
    "  order matter — a transposed grid is wrong even with the right vocabulary).",
    "- cop: only the optimum VALUE matters (e.g. total_value 18), never the arrangement.",
    "  Correct iff the solver's stated optimum equals the recorded one.",
    "- ambiguous: the entry lists readings, each with an expected result. Correct iff the",
    "  solver's outcome matches SOME reading's result (and its answer, when recorded).",
    "- subjective: the entry records a premise-free expectation and a premise-loaded answer.",
    "  Correct iff the solver reaches the premise-free outcome WITHOUT importing the unstated",
    "  premise. A unique solution matching the premise-loaded answer is 'incorrect': the solver",
    "  silently promoted a premise the prose never stated.",
    "- non-problem: the puzzle has a named failing condition (no demand, no determinate",
    "  answer space, irrelevant model, ...). Correct iff the solver DECLINES — reports the",
    "  defect instead of modeling. Solving the underlying model and presenting it as the answer",
    "  is 'incorrect', no matter how good the model is.",
    "",
    "Verdicts:",
    "- 'correct': the solver's solution satisfies the class expectation above.",
    "- 'incorrect': it does not (wrong values, wrong optimum, no matching reading, silent",
    "  premise promotion, undeclined non-problem). Say which expectation failed and how.",
    "- 'unclear': the solver's answer is incoherent, refuses, or states no determinate result",
    "  to grade.",
    "Judge ONLY what the solver wrote — never solve the puzzle yourself, never fill gaps from",
    "the prose. A fluent but answer-free response is 'unclear', not 'correct'.",
  ].join("\n")
}

function judgeUserPrompt(prose: string, solution: string, answerKeyJson: string): string {
  return `Puzzle prose:\n\n${prose}\n\nSolver answer:\n\n${solution}\n\nExpected answer (JSON):\n\n${answerKeyJson}`
}

// --- Judge verdict schema -------------------------------------------------------------------

/** The judge's verdict: a judgment with a reason, not a transcription. No assignment surface. */
export const JudgeVerdict = Schema.Struct({
  verdict: Schema.Union([Schema.Literal("correct"), Schema.Literal("incorrect"), Schema.Literal("unclear")]),
  reason: Schema.String,
})

export type JudgeVerdict = Schema.Schema.Type<typeof JudgeVerdict>

const judgeVerdictJsonSchema = toProviderSchema(JudgeVerdict)

/** Back-compat alias: the transcriber schema is gone; imports resolve to JudgeVerdict. */
export { JudgeVerdict as DirectSolutionVerdict }

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
 * Baseline harness (ADR-008): direct solve in prose, then judge grades against the key.
 * Two LLM calls per puzzle (solve + judge). The judge model defaults to z-ai/glm-5.3-flash
 * and is overridden by ZEBRA_JUDGE_MODEL (env) or --judge-model (flag, wins). There is no
 * MiniZinc involved: the judge's verdict travels inside extractedCsp, compile passes it
 * through, solve lifts out the outcome the runner records. promptVersion covers BOTH
 * prompts — either wording change bumps it.
 *
 * The runner (not this harness) maps verdicts to display outcomes: 'correct' →
 * class-appropriate pass, 'incorrect' → corresponding fail, 'unclear' → JudgeUnclear.
 * The answer key reaches the judge via modelOpts.answerKeyJson (serialized by the runner);
 * absent keys fail loudly rather than judging blind.
 */
export const directSolveHarness: EvalHarness = {
  id: "direct-solve",
  description: "direct solve in prose, judge grades against the answer key (ADR-008 baseline)",
  promptVersion: DIRECT_SOLVE_PROMPT_VERSION,
  maxCallsPerPuzzle: 2,
  extract: (prose, modelOpts: DirectSolveModelOpts) =>
    Effect.gen(function* () {
      const solverModel = modelOpts.model ?? "openai/gpt-4o-mini"
      const judgeModel = modelOpts.judgeModel ?? process.env.ZEBRA_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL
      const answerKeyJson = modelOpts.answerKeyJson
      if (answerKeyJson === undefined) {
        return yield* Effect.fail(toFailure("JudgeUnclear", "no answer key provided to the judge"))
      }
      const solution = yield* requestProseCompletion({
        model: solverModel,
        systemPrompt: solveSystemPrompt(),
        userPrompt: solveUserPrompt(prose),
      })
      const verdict = yield* requestStructuredCompletion({
        model: judgeModel,
        systemPrompt: judgeSystemPrompt(),
        userPrompt: judgeUserPrompt(prose, solution, answerKeyJson),
        schemaName: "JudgeVerdict",
        jsonSchema: judgeVerdictJsonSchema,
        schema: JudgeVerdict,
      })
      // The verdict travels inside extractedCsp (this harness has no MiniZinc);
      // compile passes it through, solve lifts it out for the runner to record.
      return {
        extractedCsp: { directSolution: solution, judgeVerdict: verdict },
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
      // No SolveResult exists — the judge already graded. The runner reads judgeVerdict
      // from extractedCsp and maps it to an outcome directly; this placeholder only
      // satisfies the stage shape and is never graded.
      solveResult: { _tag: "Unsatisfiable" as const },
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
