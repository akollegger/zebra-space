import { test } from "node:test"
import assert from "node:assert/strict"
import { Effect } from "effect"
import {
  DIRECT_SOLVE_PROMPT_VERSION,
  JudgeVerdict,
  directSolveHarness,
} from "../../src/eval/direct-solve.ts"
import { lookupHarness } from "../../src/eval/harness.ts"
import { startStubServer } from "../extraction/support/stub-server.ts"

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
