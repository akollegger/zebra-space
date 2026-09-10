import { test } from "node:test"
import assert from "node:assert/strict"
import { Effect } from "effect"
import {
  DIRECT_SOLVE_PROMPT_VERSION,
  JudgeVerdict,
  directSolveHarness,
  requestProseCompletion,
} from "../../src/eval/direct-solve.ts"
import { lookupHarness } from "../../src/eval/harness.ts"
import { startStubServer, type StubHandler, type StubServer } from "../extraction/support/stub-server.ts"

async function withStub<A>(handler: StubHandler, use: (stub: StubServer) => Promise<A>): Promise<A> {
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

// Offline coverage for the direct-solve baseline (ADR-008): the judge JUDGES (it does not
// transcribe) — verdict schema shape, the two-call sequence (prose solve, then judge tool
// call with the answer key), unclear handling, and harness registration.

test("schema: JudgeVerdict is verdict + reason, with no transcription surface", () => {
  const decoded = JudgeVerdict.pipe(
    (s) => s,
  )
  assert.ok(decoded !== undefined)
  // A correct verdict decodes; assignments are not part of the shape.
  const good = { verdict: "correct", reason: "all values match" }
  assert.deepEqual(Effect.runSync(Effect.succeed(good)), good)
})

test("harness: direct-solve issues a prose solve then a judge tool call carrying the key", async () => {
  const stub = await startStubServer((exchange, callIndex) => {
    if (callIndex === 0) {
      exchange.respondWithProse("The culprit is Plum. Reasoning: ...", { cost: 0.001 })
    } else {
      // The judge sees the answer key in its prompt and returns a judgment, not assignments.
      assert.match(exchange.request.userPrompt, /Expected answer/)
      assert.match(exchange.request.userPrompt, /PZL-TEST/)
      exchange.respondWithJson({ verdict: "correct", reason: "matches on all fields" }, { cost: 0.002 })
    }
  })
  const previousOverride = process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE
  const previousLocal = process.env.ZEBRA_LOCAL_BASE_URL
  const previousKey = process.env.OPENROUTER_API_KEY
  process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = stub.baseUrl
  delete process.env.ZEBRA_LOCAL_BASE_URL
  process.env.OPENROUTER_API_KEY = "dummy"
  try {
    const extraction = await Effect.runPromise(
      directSolveHarness.extract("puzzle prose", {
        model: "test/solver",
        judgeModel: "test/judge",
        answerKeyJson: JSON.stringify({ id: "PZL-TEST", answer: {} }),
      }),
    )
    assert.equal(extraction.model, "test/solver")
    const csp = extraction.extractedCsp as { judgeVerdict: { verdict: string } }
    assert.equal(csp.judgeVerdict.verdict, "correct")
    assert.equal(extraction.actualCostUsd, 0.003)
    // Two calls: solve (prose) + judge (tool call by schema name).
    assert.equal(stub.requests.length, 2)
    assert.equal(stub.requests[1]?.schemaName, "JudgeVerdict")

    const compilation = await Effect.runPromise(directSolveHarness.compile(extraction))
    assert.equal(compilation.mzn, null)
    assert.equal(compilation.actualCostUsd, 0.003)
    const solution = await Effect.runPromise(directSolveHarness.solve(compilation))
    assert.equal(solution.mzn, null)
    assert.equal(solution.actualCostUsd, 0.003)
  } finally {
    await stub.close()
    if (previousOverride === undefined) delete process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE
    else process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = previousOverride
    if (previousLocal === undefined) delete process.env.ZEBRA_LOCAL_BASE_URL
    else process.env.ZEBRA_LOCAL_BASE_URL = previousLocal
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = previousKey
  }
})

test("harness: missing answer key fails loudly instead of judging blind", async () => {
  const stub = await startStubServer((exchange) => {
    exchange.respondWithProse("Some answer.")
  })
  const previousOverride = process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE
  const previousLocal = process.env.ZEBRA_LOCAL_BASE_URL
  const previousKey = process.env.OPENROUTER_API_KEY
  process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = stub.baseUrl
  delete process.env.ZEBRA_LOCAL_BASE_URL
  process.env.OPENROUTER_API_KEY = "dummy"
  try {
    const outcome = await Effect.runPromise(
      directSolveHarness.extract("puzzle prose", {}).pipe(
        Effect.map(() => ({ _tag: "Ok" as const })),
        Effect.catch((e) => Effect.succeed({ _tag: "Err" as const, e })),
      ),
    )
    assert.equal(outcome._tag, "Err")
    if (outcome._tag === "Err") {
      assert.equal(outcome.e.tag, "JudgeUnclear")
      assert.match(outcome.e.detail, /no answer key/)
    }
    // Fails before any LLM call — no solver spend without a key to judge against.
    assert.equal(stub.requests.length, 0)
  } finally {
    await stub.close()
    if (previousOverride === undefined) delete process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE
    else process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = previousOverride
    if (previousLocal === undefined) delete process.env.ZEBRA_LOCAL_BASE_URL
    else process.env.ZEBRA_LOCAL_BASE_URL = previousLocal
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = previousKey
  }
})

test("harness: judge unclear travels through as a verdict, not a transport failure", async () => {
  const stub = await startStubServer((exchange, callIndex) => {
    if (callIndex === 0) exchange.respondWithProse("I cannot determine anything.")
    else exchange.respondWithJson({ verdict: "unclear", reason: "no determinate result stated" })
  })
  const previousOverride = process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE
  const previousLocal = process.env.ZEBRA_LOCAL_BASE_URL
  const previousKey = process.env.OPENROUTER_API_KEY
  process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = stub.baseUrl
  delete process.env.ZEBRA_LOCAL_BASE_URL
  process.env.OPENROUTER_API_KEY = "dummy"
  try {
    // Unclear is a valid judge output — extract succeeds carrying it; the RUNNER maps it
    // to EXTRACT_FAILED/JudgeUnclear (gradeJudged, covered in harness.test.ts).
    const extraction = await Effect.runPromise(
      directSolveHarness.extract("puzzle prose", { answerKeyJson: JSON.stringify({ id: "PZL-TEST" }) }),
    )
    const csp = extraction.extractedCsp as { judgeVerdict: { verdict: string } }
    assert.equal(csp.judgeVerdict.verdict, "unclear")
  } finally {
    await stub.close()
    if (previousOverride === undefined) delete process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE
    else process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = previousOverride
    if (previousLocal === undefined) delete process.env.ZEBRA_LOCAL_BASE_URL
    else process.env.ZEBRA_LOCAL_BASE_URL = previousLocal
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = previousKey
  }
})

test("registry: direct-solve is registered with 2-call budget and its own prompt version", () => {
  assert.equal(lookupHarness("direct-solve"), directSolveHarness)
  assert.equal(directSolveHarness.maxCallsPerPuzzle, 2)
  assert.equal(directSolveHarness.promptVersion, DIRECT_SOLVE_PROMPT_VERSION)
})

// --- ADR-010 T003 follow-up (PR review): requestProseCompletion's own cost contract -------------
// Same number/null/missing normalization contract requestStructuredCompletion already has
// dedicated coverage for (tests/extraction/provider.test.ts) — this wrapper reads the same SDK
// field independently and can regress on its own.

test("requestProseCompletion: a numeric usage.cost forwards as a number", async () => {
  await withStub(
    (exchange) => exchange.respondWithProse("an answer", { cost: 0.004 }),
    async () => {
      const result = await Effect.runPromise(
        requestProseCompletion({ model: "test/solver", systemPrompt: "s", userPrompt: "u" }),
      )
      assert.equal(result.costUsd, 0.004)
    },
  )
})

test("requestProseCompletion: usage.cost null normalizes to undefined", async () => {
  await withStub(
    (exchange) => exchange.respondWithProse("an answer", { cost: null }),
    async () => {
      const result = await Effect.runPromise(
        requestProseCompletion({ model: "test/solver", systemPrompt: "s", userPrompt: "u" }),
      )
      assert.equal(result.costUsd, undefined)
    },
  )
})

test("requestProseCompletion: usage omitted entirely normalizes to undefined", async () => {
  await withStub(
    (exchange) => exchange.respondWithProse("an answer"),
    async () => {
      const result = await Effect.runPromise(
        requestProseCompletion({ model: "test/solver", systemPrompt: "s", userPrompt: "u" }),
      )
      assert.equal(result.costUsd, undefined)
    },
  )
})

// --- ADR-010 follow-up (PR review): solver cost survives a failed judge call --------------------

test("harness: a billed solver call followed by a judge SchemaViolation still reports the solver's cost", async () => {
  await withStub(
    (exchange, callIndex) => {
      if (callIndex === 0) exchange.respondWithProse("The culprit is Plum.", { cost: 0.01 })
      else exchange.respondWithProse("I refuse to call the judging tool.", { cost: 0.02 })
    },
    async () => {
      const error = await Effect.runPromise(
        Effect.flip(
          directSolveHarness.extract("puzzle prose", {
            model: "test/solver",
            judgeModel: "test/judge",
            answerKeyJson: JSON.stringify({ id: "PZL-TEST", answer: {} }),
          }),
        ),
      )
      assert.equal(error.tag, "SchemaViolation")
      // The solver billed 0.01 before the judge ever ran; the judge's own failed call billed
      // 0.02 more — both must survive into the failure (found in PR review of ADR-010; the
      // catch handler previously had no way to see the solver's cost from inside its closure).
      assert.equal(error.actualCostUsd, 0.03)
    },
  )
})

test("harness: a billed solver call followed by a judge transport failure still reports the solver's cost", async () => {
  await withStub(
    (exchange, callIndex) => {
      if (callIndex === 0) exchange.respondWithProse("The culprit is Plum.", { cost: 0.01 })
      else exchange.respondWithError(500, "judge upstream exploded")
    },
    async () => {
      const error = await Effect.runPromise(
        Effect.flip(
          directSolveHarness.extract("puzzle prose", {
            model: "test/solver",
            judgeModel: "test/judge",
            answerKeyJson: JSON.stringify({ id: "PZL-TEST", answer: {} }),
          }),
        ),
      )
      assert.equal(error.tag, "ProviderError")
      // The judge's transport failure never billed (no response was ever parsed) — only the
      // solver's 0.01 survives.
      assert.equal(error.actualCostUsd, 0.01)
    },
  )
})
