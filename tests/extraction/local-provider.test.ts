import { test } from "node:test"
import assert from "node:assert/strict"
import { Effect, Schema } from "effect"
import { resolveProviderRoute, requestStructuredCompletion } from "../../src/extraction/provider.ts"
import { startStubServer, type StubHandler, type StubServer } from "./support/stub-server.ts"

// Offline coverage for the local provider route (ZEBRA_LOCAL_BASE_URL → LM Studio et al):
// route resolution and the string-form tool_choice the local route sends. All traffic goes to
// the HTTP stub, never the network.

async function withLocalStub<A>(handler: StubHandler, use: (stub: StubServer) => Promise<A>): Promise<A> {
  const stub = await startStubServer(handler)
  const previousLocal = process.env.ZEBRA_LOCAL_BASE_URL
  const previousOverride = process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE
  const previousKey = process.env.OPENROUTER_API_KEY
  process.env.ZEBRA_LOCAL_BASE_URL = stub.baseUrl
  delete process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE
  delete process.env.OPENROUTER_API_KEY
  try {
    return await use(stub)
  } finally {
    await stub.close()
    if (previousLocal === undefined) delete process.env.ZEBRA_LOCAL_BASE_URL
    else process.env.ZEBRA_LOCAL_BASE_URL = previousLocal
    if (previousOverride === undefined) delete process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE
    else process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = previousOverride
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = previousKey
  }
}

test("resolveProviderRoute: local base URL wins, with dummy key and required tool_choice", () => {
  process.env.ZEBRA_LOCAL_BASE_URL = "http://localhost:1234/v1"
  try {
    const route = resolveProviderRoute("ExtractedCsp")
    assert.equal(route.serverURL, "http://localhost:1234/v1")
    assert.equal(route.apiKey, "local")
    assert.equal(route.toolChoice, "required")
  } finally {
    delete process.env.ZEBRA_LOCAL_BASE_URL
  }
})

test("resolveProviderRoute: empty local base URL falls through to OpenRouter defaults", () => {
  process.env.ZEBRA_LOCAL_BASE_URL = ""
  process.env.OPENROUTER_API_KEY = "test-key"
  try {
    const route = resolveProviderRoute("ExtractedCsp")
    assert.equal(route.serverURL, undefined)
    assert.equal(route.apiKey, "test-key")
    assert.deepEqual(route.toolChoice, { type: "function", function: { name: "ExtractedCsp" } })
  } finally {
    delete process.env.ZEBRA_LOCAL_BASE_URL
    delete process.env.OPENROUTER_API_KEY
  }
})

test("local route: completion succeeds with no API key and sends tool_choice required", async () => {
  const Payload = Schema.Struct({ colors: Schema.Array(Schema.String) })
  await withLocalStub(
    (exchange) => {
      exchange.respondWithJson({ colors: ["red", "blue"] })
    },
    async (stub) => {
      const result = await Effect.runPromise(
        requestStructuredCompletion({
          model: "local/test-model",
          systemPrompt: "sys",
          userPrompt: "user",
          schemaName: "extract",
          jsonSchema: { type: "object" },
          schema: Payload,
        }),
      )
      assert.deepEqual(result, { colors: ["red", "blue"] })
      assert.equal(stub.requests.length, 1)
      assert.equal(stub.requests[0]?.toolChoice, "required")
      assert.equal(stub.requests[0]?.schemaName, "extract")
    },
  )
})

test("local route: local-single-shot harness is registered with zero-cost budget", async () => {
  const { lookupHarness } = await import("../../src/eval/harness.ts")
  const harness = lookupHarness("local-single-shot")
  assert.ok(harness !== undefined)
  assert.equal(harness.maxCallsPerPuzzle, 1)
})
