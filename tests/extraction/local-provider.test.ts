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

test("resolveProviderRoute: forceOpenRouter ignores ZEBRA_LOCAL_BASE_URL (ADR-008 §2.4 judge routing)", () => {
  process.env.ZEBRA_LOCAL_BASE_URL = "http://localhost:1234/v1"
  process.env.OPENROUTER_API_KEY = "test-key"
  try {
    // Without the flag, local mode wins — this is the exact silent-rerouting risk the flag exists to close.
    const local = resolveProviderRoute("JudgeVerdict")
    assert.equal(local.serverURL, "http://localhost:1234/v1")
    assert.equal(local.apiKey, "local")

    const forced = resolveProviderRoute("JudgeVerdict", { forceOpenRouter: true })
    assert.equal(forced.serverURL, undefined)
    assert.equal(forced.apiKey, "test-key")
    assert.deepEqual(forced.toolChoice, { type: "function", function: { name: "JudgeVerdict" } })
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

test("timeout enforcement: a hung server fails in ~timeoutMs, not forever", async () => {
  // Regression guard for the 50-minute PZL-0001 hang against a 10-minute timeout: if neither
  // Effect.timeout nor the SDK's timeoutMs can interrupt a stalled local connection, this
  // test hangs the suite instead of failing fast.
  // Bound arithmetic, not slack: timeoutMs 500 x up to 3 attempts (initial + 2 retries at
  // 300/600ms exponential backoff) lands ~2s; the 5s bound has ~2.5x headroom over the
  // designed worst case while still catching a dead timeout path (which would hang until
  // the suite runner kills it, orders of magnitude over).
  const Payload = Schema.Struct({ colors: Schema.Array(Schema.String) })
  await withLocalStub(
    (_exchange) => {
      // Never respond — hold the connection open like a wedged local server.
    },
    async () => {
      const started = Date.now()
      const outcome = await Effect.runPromise(
        requestStructuredCompletion({
          model: "local/test-model",
          systemPrompt: "sys",
          userPrompt: "user",
          schemaName: "extract",
          jsonSchema: { type: "object" },
          schema: Payload,
          timeoutMs: 500,
        }).pipe(
          Effect.map(() => ({ _tag: "Ok" as const })),
          Effect.catch((e) => Effect.succeed({ _tag: "Err" as const, tag: e._tag })),
        ),
      )
      const elapsed = Date.now() - started
      assert.equal(outcome._tag, "Err")
      assert.ok(elapsed < 5_000, `timeout took ${elapsed}ms, expected ~2s`)
    },
  )
})
