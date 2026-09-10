import { test } from "node:test"
import assert from "node:assert/strict"
import { Effect, Schema } from "effect"
import { requestStructuredCompletion } from "../../src/extraction/provider.ts"
import { startStubServer } from "./support/stub-server.ts"

// ADR-010 §2.1 provider contract: every successful completion returns { value, costUsd },
// where costUsd is response.usage.cost when that is a number and undefined otherwise
// (null/missing — local and free-tier routes never bill dollars). All traffic goes to the
// HTTP stub, never the network.

const Payload = Schema.Struct({ colors: Schema.Array(Schema.String) })

async function withStub<A>(
  usage: { readonly cost?: number | null } | undefined,
  use: () => Promise<A>,
): Promise<A> {
  const stub = await startStubServer((exchange) => {
    if (usage === undefined) exchange.respondWithJson({ colors: ["red"] })
    else exchange.respondWithJson({ colors: ["red"] }, usage)
  })
  const previousOverride = process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE
  const previousKey = process.env.OPENROUTER_API_KEY
  process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = stub.baseUrl
  process.env.OPENROUTER_API_KEY = "test-key"
  try {
    return await use()
  } finally {
    await stub.close()
    if (previousOverride === undefined) delete process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE
    else process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = previousOverride
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = previousKey
  }
}

function request() {
  return requestStructuredCompletion({
    model: "test/model",
    systemPrompt: "sys",
    userPrompt: "user",
    schemaName: "Payload",
    jsonSchema: { type: "object" },
    schema: Payload,
  })
}

test("cost contract: a numeric usage.cost forwards as a number alongside the decoded value", async () => {
  await withStub({ cost: 0.0042 }, async () => {
    const result = await Effect.runPromise(request())
    assert.deepEqual(result.value, { colors: ["red"] })
    assert.equal(result.costUsd, 0.0042)
  })
})

test("cost contract: a measured zero stays 0, never undefined (absence and zero differ)", async () => {
  await withStub({ cost: 0 }, async () => {
    const result = await Effect.runPromise(request())
    assert.equal(result.costUsd, 0)
  })
})

test("cost contract: usage.cost null normalizes to undefined", async () => {
  await withStub({ cost: null }, async () => {
    const result = await Effect.runPromise(request())
    assert.equal(result.costUsd, undefined)
  })
})

test("cost contract: usage omitted entirely normalizes to undefined", async () => {
  await withStub(undefined, async () => {
    const result = await Effect.runPromise(request())
    assert.equal(result.costUsd, undefined)
  })
})
