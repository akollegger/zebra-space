import { test } from "node:test"
import assert from "node:assert/strict"
import { Effect } from "effect"
import { STAGED_PROMPT_VERSION, extractStaged } from "../../src/extraction/extract.ts"
import { lookupHarness } from "../../src/eval/harness.ts"
import { startStubServer } from "./support/stub-server.ts"

// Offline coverage for staged extraction (ADR-009): vocabulary-then-constraints assembly,
// stage-named failures, and harness registration. All traffic goes to the HTTP stub.

async function withOverrideStub<A>(
  handler: (exchange: import("./support/stub-server.ts").StubExchange, callIndex: number) => void,
  use: (stub: import("./support/stub-server.ts").StubServer) => Promise<A>,
): Promise<A> {
  const stub = await startStubServer(handler)
  const previousOverride = process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE
  const previousLocal = process.env.ZEBRA_LOCAL_BASE_URL
  const previousKey = process.env.OPENROUTER_API_KEY
  process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = stub.baseUrl
  delete process.env.ZEBRA_LOCAL_BASE_URL
  process.env.OPENROUTER_API_KEY = "dummy"
  try {
    return await use(stub)
  } finally {
    await stub.close()
    if (previousOverride === undefined) delete process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE
    else process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = previousOverride
    if (previousLocal === undefined) delete process.env.ZEBRA_LOCAL_BASE_URL
    else process.env.ZEBRA_LOCAL_BASE_URL = previousLocal
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = previousKey
  }
}

const VOCAB = {
  entities: [{ id: "H1", type: "house" }],
  domains: [{ variable: "color", entityType: "house", values: ["Red", "Blue"] }],
}

const CONSTRAINTS = {
  constraints: [{ kind: "assignment", entity: "H1", variable: "color", value: "Red" }],
}

test("staged: vocabulary then constraints assemble deterministically", async () => {
  await withOverrideStub(
    (exchange, callIndex) => {
      if (callIndex === 0) {
        assert.equal(exchange.request.schemaName, "ExtractedVocabulary")
        exchange.respondWithJson(VOCAB)
      } else {
        assert.equal(exchange.request.schemaName, "ExtractedConstraints")
        // Stage 2 sees the fixed vocabulary in its prompt.
        assert.match(exchange.request.systemPrompt, /H1/)
        assert.match(exchange.request.systemPrompt, /color/)
        exchange.respondWithJson(CONSTRAINTS)
      }
    },
    async (stub) => {
      const result = await Effect.runPromise(extractStaged("prose", { model: "test/model" }))
      assert.equal(result.model, "test/model")
      assert.deepEqual(result.extractedCsp.entities, VOCAB.entities)
      assert.deepEqual(result.extractedCsp.domains, VOCAB.domains)
      assert.deepEqual(result.extractedCsp.constraints, CONSTRAINTS.constraints)
      assert.deepEqual(result.vocabulary, VOCAB)
      assert.equal(stub.requests.length, 2)
    },
  )
})

test("staged: stage-1 schema violation names the stage and skips stage 2", async () => {
  await withOverrideStub(
    (exchange) => {
      exchange.respondWithProse("not a vocabulary")
    },
    async (stub) => {
      const outcome = await Effect.runPromise(
        extractStaged("prose", {}).pipe(
          Effect.map(() => ({ _tag: "Ok" as const })),
          Effect.catch((e) => Effect.succeed({ _tag: "Err" as const, e })),
        ),
      )
      assert.equal(outcome._tag, "Err")
      if (outcome._tag === "Err") {
        assert.equal(outcome.e._tag, "SchemaViolation")
        assert.match(outcome.e.detail, /stage 1-vocabulary/)
      }
      assert.equal(stub.requests.length, 1)
    },
  )
})

test("staged: invented constraint kind fails decode with stage 2 named", async () => {
  await withOverrideStub(
    (exchange, callIndex) => {
      if (callIndex === 0) exchange.respondWithJson(VOCAB)
      else exchange.respondWithJson({ constraints: [{ kind: "rightOf", a: "H1", b: "H2" }] })
    },
    async (stub) => {
      const outcome = await Effect.runPromise(
        extractStaged("prose", {}).pipe(
          Effect.map(() => ({ _tag: "Ok" as const })),
          Effect.catch((e) => Effect.succeed({ _tag: "Err" as const, e })),
        ),
      )
      assert.equal(outcome._tag, "Err")
      if (outcome._tag === "Err") {
        // The live "rightOf" failure: decode rejects the unknown kind, stage named.
        assert.equal(outcome.e._tag, "SchemaViolation")
        assert.match(outcome.e.detail, /stage 2-constraints/)
      }
      assert.equal(stub.requests.length, 2)
    },
  )
})

test("staged: stage-2 transport failure keeps a stage-named detail (no spread loss)", async () => {
  // Regression: Data.TaggedError fields are non-enumerable, so tagging errors by spread
  // silently dropped message/detail and raw JSON carried no diagnostic (PZL-0028 pilot).
  await withOverrideStub(
    (exchange, callIndex) => {
      if (callIndex === 0) exchange.respondWithJson(VOCAB)
      else exchange.respondWithError(500, "boom")
    },
    async () => {
      const outcome = await Effect.runPromise(
        extractStaged("prose", {}).pipe(
          Effect.map(() => ({ _tag: "Ok" as const })),
          Effect.catch((e) => Effect.succeed({ _tag: "Err" as const, e })),
        ),
      )
      assert.equal(outcome._tag, "Err")
      if (outcome._tag === "Err") {
        assert.equal(outcome.e._tag, "ProviderError")
        assert.match(outcome.e.message, /stage 2-constraints/)
      }
    },
  )
})

test("registry: staged-single-shot is registered with 2-call budget and staged prompt version", async () => {
  const { stagedSingleShotHarness } = await import("../../src/eval/harness.ts")
  assert.equal(lookupHarness("staged-single-shot"), stagedSingleShotHarness)
  assert.equal(stagedSingleShotHarness.maxCallsPerPuzzle, 2)
  assert.equal(stagedSingleShotHarness.promptVersion, STAGED_PROMPT_VERSION)
})
