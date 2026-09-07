// SPIKE-007 sub-question 2: does the raw OpenRouter cost surface cleanly, and would reading it
// need less code than ADR-010's onCost-callback design?
import { readFile } from "node:fs/promises"
import { OpenRouterClient, OpenRouterLanguageModel } from "@effect/ai-openrouter"
import { Config, Effect, Layer } from "effect"
import { LanguageModel } from "effect/unstable/ai"
import { FetchHttpClient } from "effect/unstable/http"

const OpenRouterClientLayer = OpenRouterClient.layerConfig({
  apiKey: Config.redacted("OPENROUTER_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer))

async function stripFrontmatter(path: string): Promise<string> {
  const raw = await readFile(path, "utf8")
  return raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim()
}

const program = Effect.gen(function* () {
  const prose = yield* Effect.promise(() =>
    stripFrontmatter(new URL("../../../../catalog/puzzles/PZL-0004-whodunit.md", import.meta.url).pathname),
  )
  const response = yield* LanguageModel.generateText({
    prompt: `Solve this puzzle in one short paragraph:\n\n${prose}`,
  }).pipe(Effect.provide(OpenRouterLanguageModel.model("openai/gpt-4o-mini")))

  const finishPart = response.content.find((part) => part.type === "finish")
  console.log("normalized usage (Response.Usage, token counts only):")
  console.log(JSON.stringify(response.usage, null, 2))
  console.log("\nfinish part metadata (raw OpenRouter passthrough):")
  console.log(JSON.stringify((finishPart as { metadata?: unknown })?.metadata, null, 2))
}).pipe(Effect.provide(OpenRouterClientLayer))

Effect.runPromise(program).catch((error) => {
  console.error("Unhandled failure:", error)
  process.exit(1)
})
