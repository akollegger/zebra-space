import { test } from "node:test"
import assert from "node:assert/strict"
import { Effect } from "effect"
import { compileRepairHarness } from "../../src/eval/harness.ts"
import type { ExtractedCsp } from "../../src/extraction/types.ts"
import { startStubServer, type StubHandler, type StubServer } from "../extraction/support/stub-server.ts"

// T016 follow-up (PR review of ADR-010): compileRepairHarness's own extract stage — the one
// place a repair retry can follow an already-billed successful attempt — had no dedicated
// coverage forcing a real compile failure through to the retry. Offline, stubbed at the HTTP
// boundary exactly like tests/extraction/extract.test.ts.

const VALID_CSP: ExtractedCsp = {
  entities: [{ id: "E1", type: "Thing" }],
  domains: [{ variable: "x", entityType: "Thing", values: ["A", "B"] }],
  constraints: [],
}

// Compiles fine on its own vocabulary (allDifferent references a variable that was never
// declared) — src/compiler/compile.ts's "Unknown variable" CompileError — so this always
// triggers repairAfterCompileFailure's retry path.
const UNCOMPILABLE_CSP: ExtractedCsp = {
  entities: [{ id: "E1", type: "Thing" }],
  domains: [{ variable: "x", entityType: "Thing", values: ["A", "B"] }],
  constraints: [{ kind: "allDifferent", variable: "no-such-variable" }],
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

test("compile-repair: a successful repair retry sums the first attempt's cost with the retry's", async () => {
  await withStub(
    (exchange, callIndex) => {
      if (callIndex === 0) exchange.respondWithJson(UNCOMPILABLE_CSP, { cost: 0.1 })
      else exchange.respondWithJson(VALID_CSP, { cost: 0.2 })
    },
    async (stub) => {
      const result = await Effect.runPromise(
        compileRepairHarness.extract("a puzzle", { model: "stub/cheap" }),
      )
      assert.deepEqual(result.extractedCsp, VALID_CSP)
      assert.equal(result.actualCostUsd, 0.1 + 0.2)
      assert.equal(stub.requests.length, 2)
    },
  )
})

test("compile-repair: a billed first attempt followed by a failed retry still reports the first attempt's cost", async () => {
  await withStub(
    (exchange, callIndex) => {
      if (callIndex === 0) exchange.respondWithJson(UNCOMPILABLE_CSP, { cost: 0.1 })
      // The retry itself gets a real, billed response that fails to conform (SchemaViolation) —
      // this must not make the first attempt's already-billed cost vanish (found in PR review
      // of ADR-010: the raw error from extractSingleShot's retry only ever carried its OWN call's
      // cost, discarding the first attempt's).
      else exchange.respondWithProse("I decline to call the tool.", { cost: 0.05 })
    },
    async () => {
      const error = await Effect.runPromise(
        Effect.flip(compileRepairHarness.extract("a puzzle", { model: "stub/cheap" })),
      )
      assert.equal(error.tag, "SchemaViolation")
      assert.equal(error.actualCostUsd, 0.1 + 0.05)
    },
  )
})

test("compile-repair: a billed first attempt followed by a transport-failing retry still reports the first attempt's cost", async () => {
  await withStub(
    (exchange, callIndex) => {
      if (callIndex === 0) exchange.respondWithJson(UNCOMPILABLE_CSP, { cost: 0.1 })
      else exchange.respondWithError(500, "upstream exploded")
    },
    async () => {
      const error = await Effect.runPromise(
        Effect.flip(compileRepairHarness.extract("a puzzle", { model: "stub/cheap" })),
      )
      assert.equal(error.tag, "ProviderError")
      // The retry's own transport failure never billed (no response was ever parsed) — only
      // the first attempt's 0.1 survives.
      assert.equal(error.actualCostUsd, 0.1)
    },
  )
})
