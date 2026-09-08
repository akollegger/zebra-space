// SPIKE-007 sub-question 1: does OpenRouterLanguageModel's structured-output path reliably
// decode a schema shaped like ExtractedCsp, on both verified models, for real catalog puzzles?
//
// Run: node design/spikes/SPIKE-007-effect-unstable-ai-viability/scripts/structured-output.ts
import { readFile } from "node:fs/promises"
import { OpenRouterClient, OpenRouterLanguageModel } from "@effect/ai-openrouter"
import { Config, Effect, Layer } from "effect"
import { LanguageModel } from "effect/unstable/ai"
import { FetchHttpClient } from "effect/unstable/http"
import { SpikeExtractedCsp } from "./schema.ts"

const OpenRouterClientLayer = OpenRouterClient.layerConfig({
  apiKey: Config.redacted("OPENROUTER_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer))

const MODELS = ["openai/gpt-4o-mini", "anthropic/claude-sonnet-4.5"] as const

const PUZZLES = ["PZL-0002-context-graphs-example.md", "PZL-0004-whodunit.md"] as const

function systemPrompt(): string {
  return [
    "You extract a constraint satisfaction problem from a logic puzzle's prose.",
    "Produce entities (id + type), domains (variable, entityType, finite values), and",
    "constraints using ONLY these kinds: assignment, linkedAttributes, allDifferent,",
    "adjacency, notEqual. Do not invent other constraint kinds.",
  ].join("\n")
}

async function stripFrontmatter(path: string): Promise<string> {
  const raw = await readFile(path, "utf8")
  return raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim()
}

const program = Effect.gen(function* () {
  for (const puzzleFile of PUZZLES) {
    const prose = yield* Effect.promise(() =>
      stripFrontmatter(new URL(`../../../../catalog/puzzles/${puzzleFile}`, import.meta.url).pathname),
    )
    for (const modelId of MODELS) {
      const label = `${puzzleFile} x ${modelId}`
      const result = yield* LanguageModel.generateObject({
        objectName: "ExtractedCsp",
        prompt: `${systemPrompt()}\n\nPuzzle:\n\n${prose}`,
        schema: SpikeExtractedCsp,
      }).pipe(
        Effect.provide(OpenRouterLanguageModel.model(modelId)),
        Effect.map((response) => ({ ok: true as const, response })),
        Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
      )
      if (result.ok) {
        const { entities, domains, constraints } = result.response.value
        console.log(`\n=== ${label}: OK ===`)
        console.log(`entities=${entities.length} domains=${domains.length} constraints=${constraints.length}`)
        console.log(
          `finishReason=${result.response.finishReason} outputTokens=${result.response.usage.outputTokens.total}`,
        )
        console.log(JSON.stringify(result.response.value, null, 2))
      } else {
        console.log(`\n=== ${label}: FAILED ===`)
        console.log(JSON.stringify(result.error, null, 2))
      }
    }
  }
}).pipe(Effect.provide(OpenRouterClientLayer))

Effect.runPromise(program).catch((error) => {
  console.error("Unhandled failure:", error)
  process.exit(1)
})
