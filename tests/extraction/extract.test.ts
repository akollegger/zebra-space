import { test } from "node:test"
import assert from "node:assert/strict"
import { Effect } from "effect"
import { extract } from "../../src/extraction/extract.ts"
import type { ExtractedCsp } from "../../src/extraction/types.ts"
import { startStubServer, type StubHandler, type StubServer } from "./support/stub-server.ts"

const CHEAP_MODEL = "stub/cheap"
const FRONTIER_MODEL = "stub/frontier"

const SAMPLE_CSP: ExtractedCsp = {
  entities: [{ id: "E1", type: "Thing" }],
  domains: [{ variable: "x", entityType: "Thing", values: ["A", "B"] }],
  constraints: [],
}

async function withStub<A>(handler: StubHandler, use: (stub: StubServer) => Promise<A>): Promise<A> {
  const stub = await startStubServer(handler)
  const previousOverride = process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE
  const previousKey = process.env.OPENROUTER_API_KEY
  process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = stub.baseUrl
  process.env.OPENROUTER_API_KEY = "test-key"
  try {
    return await use(stub)
  } finally {
    await stub.close()
    if (previousOverride === undefined) delete process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE
    else process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = previousOverride
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = previousKey
  }
}

function runExtract(prose = "a puzzle") {
  return Effect.runPromise(extract(prose, { model: CHEAP_MODEL, frontierModel: FRONTIER_MODEL }))
}

function runExtractFails(prose = "a puzzle") {
  return Effect.runPromise(Effect.flip(extract(prose, { model: CHEAP_MODEL, frontierModel: FRONTIER_MODEL })))
}

test("SC-001/Acceptance Scenario 1: an immediate accept resolves to the stub's ExtractedCsp on the cheap tier", async () => {
  await withStub(
    (exchange) => {
      exchange.respondWithJson(
        exchange.request.schemaName === "FidelityCritique" ? { accepted: true, issues: [] } : SAMPLE_CSP,
      )
    },
    async (stub) => {
      const result = await runExtract()
      assert.deepEqual(result.extractedCsp, SAMPLE_CSP)
      assert.equal(result.model, CHEAP_MODEL)
      assert.equal(stub.requests.length, 2)
      assert.equal(stub.requests[0]?.schemaName, "ExtractedCsp")
      assert.equal(stub.requests[1]?.schemaName, "FidelityCritique")
    },
  )
})

test("FR-006/Edge Cases: a rejection is followed by an informed revision carrying the critic's issues", async () => {
  let critiqueCalls = 0
  await withStub(
    (exchange) => {
      if (exchange.request.schemaName === "FidelityCritique") {
        critiqueCalls += 1
        exchange.respondWithJson(
          critiqueCalls === 1
            ? { accepted: false, issues: ["missing the third clue"] }
            : { accepted: true, issues: [] },
        )
      } else {
        exchange.respondWithJson(SAMPLE_CSP)
      }
    },
    async (stub) => {
      const result = await runExtract()
      assert.equal(result.model, CHEAP_MODEL)
      const extractionRequests = stub.requests.filter((r) => r.schemaName === "ExtractedCsp")
      assert.equal(extractionRequests.length, 2)
      assert.match(extractionRequests[1]?.userPrompt ?? "", /missing the third clue/)
    },
  )
})

test("ADR-004 §2.5: exhausting the cheap tier's revisions (3 attempts) escalates to the frontier tier", async () => {
  await withStub(
    (exchange) => {
      if (exchange.request.schemaName === "FidelityCritique") {
        exchange.respondWithJson(
          exchange.request.model === FRONTIER_MODEL
            ? { accepted: true, issues: [] }
            : { accepted: false, issues: ["still not faithful"] },
        )
      } else {
        exchange.respondWithJson(SAMPLE_CSP)
      }
    },
    async (stub) => {
      const result = await runExtract()
      assert.equal(result.model, FRONTIER_MODEL)
      const cheapCritiques = stub.requests.filter(
        (r) => r.schemaName === "FidelityCritique" && r.model === CHEAP_MODEL,
      )
      assert.equal(cheapCritiques.length, 3)
      const frontierCritiques = stub.requests.filter(
        (r) => r.schemaName === "FidelityCritique" && r.model === FRONTIER_MODEL,
      )
      assert.equal(frontierCritiques.length, 1)
    },
  )
})

test("FR-005/FR-008: rejecting every attempt on both tiers fails with CriticRejected carrying every attempt", async () => {
  await withStub(
    (exchange) => {
      exchange.respondWithJson(
        exchange.request.schemaName === "FidelityCritique" ? { accepted: false, issues: ["nope"] } : SAMPLE_CSP,
      )
    },
    async () => {
      const error = await runExtractFails()
      assert.equal(error._tag, "CriticRejected")
      if (error._tag === "CriticRejected") {
        assert.equal(error.attempts.length, 6)
        const models = new Set(error.attempts.map((a) => a.model))
        assert.deepEqual(models, new Set([CHEAP_MODEL, FRONTIER_MODEL]))
        assert.ok(error.attempts.every((a) => a.critique.accepted === false))
      }
    },
  )
})

test("FR-012/Acceptance Scenario 3: a provider failure fails with ProviderError, not CriticRejected", async () => {
  const stub = await startStubServer(() => {})
  const closedUrl = stub.baseUrl
  await stub.close()

  const previousOverride = process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE
  const previousKey = process.env.OPENROUTER_API_KEY
  process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = closedUrl
  process.env.OPENROUTER_API_KEY = "test-key"
  try {
    const error = await runExtractFails()
    assert.equal(error._tag, "ProviderError")
  } finally {
    if (previousOverride === undefined) delete process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE
    else process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = previousOverride
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = previousKey
  }
})

test("A missing/invalid API key produces a clear message, not OpenRouter's raw 401 body text", async () => {
  await withStub(
    (exchange) => {
      exchange.respondWithError(401, "No cookie auth credentials found")
    },
    async () => {
      const error = await runExtractFails()
      assert.equal(error._tag, "ProviderError")
      if (error._tag === "ProviderError") {
        assert.match(error.message, /OPENROUTER_API_KEY is missing or invalid/)
        assert.doesNotMatch(error.message, /cookie/i)
      }
    },
  )
})

test("FR-010: extract() uses the model identifiers it's given instead of the built-in defaults", async () => {
  await withStub(
    (exchange) => {
      exchange.respondWithJson(
        exchange.request.schemaName === "FidelityCritique" ? { accepted: true, issues: [] } : SAMPLE_CSP,
      )
    },
    async (stub) => {
      const result = await Effect.runPromise(
        extract("a puzzle", { model: "custom/cheap-model", frontierModel: "custom/frontier-model" }),
      )
      assert.equal(result.model, "custom/cheap-model")
      assert.ok(stub.requests.every((r) => r.model === "custom/cheap-model"))
      assert.ok(!stub.requests.some((r) => r.model === "openai/gpt-4o-mini"))
    },
  )
})

test("ADR-004 §2.7: the schema actually sent to the provider contains no $ref/$defs", async () => {
  await withStub(
    (exchange) => {
      exchange.respondWithJson(
        exchange.request.schemaName === "FidelityCritique" ? { accepted: true, issues: [] } : SAMPLE_CSP,
      )
    },
    async (stub) => {
      await runExtract()
      assert.ok(stub.requests.length > 0)
      for (const request of stub.requests) {
        const serialized = JSON.stringify(request.toolParameters)
        assert.ok(serialized !== undefined, "the forced tool must carry a parameters schema")
        assert.doesNotMatch(serialized, /\$ref/, `${request.schemaName} schema leaked a $ref`)
        assert.doesNotMatch(serialized, /\$defs/, `${request.schemaName} schema leaked $defs`)
      }
    },
  )
})

test("ADR-004 §2.1: the request is a forced single tool call, not response_format", async () => {
  await withStub(
    (exchange) => {
      exchange.respondWithJson(
        exchange.request.schemaName === "FidelityCritique" ? { accepted: true, issues: [] } : SAMPLE_CSP,
      )
    },
    async (stub) => {
      await runExtract()
      // The stub derives schemaName from tool_choice, so a non-empty value here proves the
      // forced-tool shape reached the wire at all.
      assert.deepEqual(
        stub.requests.map((r) => r.schemaName),
        ["ExtractedCsp", "FidelityCritique"],
      )
    },
  )
})

test("A provider rejecting the schema fails with SchemaRejected, distinct from ProviderError", async () => {
  await withStub(
    (exchange) => {
      exchange.respondWithError(
        400,
        "ref loops are only supported if they include optional or nullable property values",
      )
    },
    async () => {
      const error = await runExtractFails()
      assert.equal(error._tag, "SchemaRejected")
      if (error._tag === "SchemaRejected") {
        assert.equal(error.model, CHEAP_MODEL)
        assert.match(error.providerMessage, /ref loop/)
      }
    },
  )
})

test("A model persistently replying in prose retries within each tier, escalates, then fails with the frontier tier's SchemaViolation", async () => {
  await withStub(
    (exchange) => {
      exchange.respondWithProse("Sure! Here is an example object: { \"id\": 1 }")
    },
    async (stub) => {
      const error = await runExtractFails()
      assert.equal(error._tag, "SchemaViolation")
      if (error._tag === "SchemaViolation") {
        assert.match(error.detail, /prose instead of calling the required tool/)
        // Every round is a schema violation, so it never reaches FidelityCritique — the final
        // error should come from the frontier tier (the last one attempted), not the cheap tier.
        assert.equal(error.model, FRONTIER_MODEL)
      }
      // 3 rounds (1 initial + MAX_REVISIONS_PER_TIER=2 repairs) per tier, both tiers exhausted.
      assert.equal(stub.requests.length, 6)
      assert.ok(stub.requests.every((r) => r.schemaName === "ExtractedCsp"))
      const cheapRequests = stub.requests.filter((r) => r.model === CHEAP_MODEL)
      const frontierRequests = stub.requests.filter((r) => r.model === FRONTIER_MODEL)
      assert.equal(cheapRequests.length, 3)
      assert.equal(frontierRequests.length, 3)
    },
  )
})

test("A schema-invalid tool call is retried with a repair prompt and succeeds within the same tier", async () => {
  let extractionCalls = 0
  await withStub(
    (exchange) => {
      if (exchange.request.schemaName === "FidelityCritique") {
        exchange.respondWithJson({ accepted: true, issues: [] })
        return
      }
      extractionCalls += 1
      if (extractionCalls === 1) {
        // Missing every required field — a schema violation, not a decode of SAMPLE_CSP.
        exchange.respondWithJson({})
      } else {
        exchange.respondWithJson(SAMPLE_CSP)
      }
    },
    async (stub) => {
      const result = await runExtract()
      assert.equal(result.model, CHEAP_MODEL)
      assert.deepEqual(result.extractedCsp, SAMPLE_CSP)
      const extractionRequests = stub.requests.filter((r) => r.schemaName === "ExtractedCsp")
      assert.equal(extractionRequests.length, 2)
      assert.match(extractionRequests[1]?.userPrompt ?? "", /did not match the required schema/)
      assert.match(extractionRequests[1]?.userPrompt ?? "", /Validation error/)
    },
  )
})

test("A schema-invalid CRITIQUE response (not extraction) is also retried with a repair prompt, not just abandoned", async () => {
  // Code review finding: only extractOnce's SchemaViolation was ever caught — a schema-invalid
  // *critique* (e.g. the critic model replying in prose) still propagated straight out of
  // runTier uncaught, skipping the frontier tier the same way the original bug did for
  // extraction. The extraction itself always succeeds here; only the first critique call fails.
  let critiqueCalls = 0
  await withStub(
    (exchange) => {
      if (exchange.request.schemaName !== "FidelityCritique") {
        exchange.respondWithJson(SAMPLE_CSP)
        return
      }
      critiqueCalls += 1
      if (critiqueCalls === 1) {
        exchange.respondWithProse("Sure! Here's my judgment in plain text.")
      } else {
        exchange.respondWithJson({ accepted: true, issues: [] })
      }
    },
    async (stub) => {
      const result = await runExtract()
      assert.equal(result.model, CHEAP_MODEL)
      assert.deepEqual(result.extractedCsp, SAMPLE_CSP)
      const critiqueRequests = stub.requests.filter((r) => r.schemaName === "FidelityCritique")
      assert.equal(critiqueRequests.length, 2)
      assert.match(critiqueRequests[1]?.userPrompt ?? "", /did not match the required schema/)
      // Only ONE extraction call — the critique repair reused the same extractedCsp, no
      // re-extraction was needed.
      assert.equal(stub.requests.filter((r) => r.schemaName === "ExtractedCsp").length, 1)
    },
  )
})
