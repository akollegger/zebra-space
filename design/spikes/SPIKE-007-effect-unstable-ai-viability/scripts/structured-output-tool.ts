// Follow-up to structured-output.ts: LanguageModel.generateObject defaults to OpenRouter's
// `response_format: json_schema` mode (confirmed by reading OpenRouterLanguageModel.js), which
// this project's own hand-rolled provider.ts deliberately avoids (ADR-004 §2.1, per SPIKE-005's
// finding that a genuinely forced tool call is far more reliably honored than response_format).
// This variant instead forces a named tool call via Tool/Toolkit + toolChoice, mirroring what
// provider.ts already does, to see whether that path is more reliable for the models that failed
// against generateObject's default (Claude Sonnet 4.5 replying in prose both times).
import { readFile } from "node:fs/promises"
import { OpenRouterClient, OpenRouterLanguageModel } from "@effect/ai-openrouter"
import { Config, Effect, Layer, Schema } from "effect"
import { LanguageModel, Tool, Toolkit } from "effect/unstable/ai"
import { FetchHttpClient } from "effect/unstable/http"
import { Constraint, Domain, Entity } from "./schema.ts"

const ExtractCsp = Tool.make("ExtractCsp", {
  description: "Record the extracted constraint satisfaction problem.",
  parameters: {
    entities: Schema.Array(Entity),
    domains: Schema.Array(Domain),
    constraints: Schema.Array(Constraint),
  },
  success: Schema.Void,
})

const ExtractToolkit = Toolkit.make(ExtractCsp)

const ExtractToolkitLayer = ExtractToolkit.toLayer(
  Effect.succeed(
    ExtractToolkit.of({
      // No-op handler — this tool exists only to force a structured call; we read the call's
      // own decoded params directly rather than doing anything with the "result".
      ExtractCsp: () => Effect.void,
    }),
  ),
)

const OpenRouterClientLayer = OpenRouterClient.layerConfig({
  apiKey: Config.redacted("OPENROUTER_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer))

const MODELS = ["openai/gpt-4o-mini", "anthropic/claude-sonnet-4.5"] as const
const PUZZLES = ["PZL-0002-context-graphs-example.md", "PZL-0004-whodunit.md"] as const

function systemPrompt(): string {
  return [
    "You extract a constraint satisfaction problem from a logic puzzle's prose.",
    "Call ExtractCsp with entities (id + type), domains (variable, entityType, finite values),",
    "and constraints using ONLY these kinds: assignment, linkedAttributes, allDifferent,",
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
      const result = yield* LanguageModel.generateText({
        prompt: `${systemPrompt()}\n\nPuzzle:\n\n${prose}`,
        toolkit: ExtractToolkit,
        toolChoice: { tool: "ExtractCsp" },
      }).pipe(
        Effect.provide(OpenRouterLanguageModel.model(modelId)),
        Effect.map((response) => ({ ok: true as const, response })),
        Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
      )
      if (result.ok) {
        const call = result.response.toolCalls[0]
        console.log(`\n=== ${label}: OK (${result.response.toolCalls.length} tool call(s)) ===`)
        console.log(`finishReason=${result.response.finishReason}`)
        console.log(JSON.stringify(call?.params ?? null, null, 2))
      } else {
        console.log(`\n=== ${label}: FAILED ===`)
        console.log(JSON.stringify(result.error, null, 2))
      }
    }
  }
}).pipe(Effect.provide([OpenRouterClientLayer, ExtractToolkitLayer]))

Effect.runPromise(program).catch((error) => {
  console.error("Unhandled failure:", error)
  process.exit(1)
})
