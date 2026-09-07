// SPIKE-007 sub-question 3: does ExecutionPlan (the built-in cheap-then-frontier composition
// primitive) and ordinary Effect.retry/Schedule work as expected, reproducing ADR-004's
// tier-escalation pattern without fighting the module's own abstractions?
import { OpenRouterClient, OpenRouterLanguageModel } from "@effect/ai-openrouter"
import { Config, Effect, ExecutionPlan, Layer, Schedule } from "effect"
import { LanguageModel } from "effect/unstable/ai"
import { FetchHttpClient } from "effect/unstable/http"

const OpenRouterClientLayer = OpenRouterClient.layerConfig({
  apiKey: Config.redacted("OPENROUTER_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer))

// Cheap tier deliberately broken (bad model id) so the plan must escalate to the frontier tier,
// mirroring ADR-004's cheap-then-frontier critic loop shape.
const Plan = ExecutionPlan.make(
  { provide: OpenRouterLanguageModel.model("openai/does-not-exist-9000"), attempts: 2 },
  { provide: OpenRouterLanguageModel.model("openai/gpt-4o-mini"), attempts: 1 },
)

const program = LanguageModel.generateText({
  prompt: "Reply with exactly one word: hello",
}).pipe(
  Effect.withExecutionPlan(Plan),
  // Ordinary Effect.retry/Schedule composes around a LanguageModel + ExecutionPlan call the
  // same way provider.ts's PROVIDER_ERROR_RETRY_SCHEDULE already does — nothing special needed.
  Effect.retry({ schedule: Schedule.exponential("200 millis"), times: 1 }),
  Effect.provide(OpenRouterClientLayer),
)

Effect.runPromise(program)
  .then((response) => {
    console.log("Final text:", response.text)
    console.log("finishReason:", response.finishReason)
  })
  .catch((error) => {
    console.error("Unhandled failure:", error)
    process.exit(1)
  })
