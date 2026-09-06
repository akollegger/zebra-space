import { test } from "node:test"
import assert from "node:assert/strict"
import { Effect } from "effect"
import {
  DIRECT_SOLVE_PROMPT_VERSION,
  directSolveHarness,
  toSolveResult,
} from "../../src/eval/direct-solve.ts"
import { lookupHarness } from "../../src/eval/harness.ts"
import { startStubServer } from "../extraction/support/stub-server.ts"

// Offline coverage for the direct-solve baseline (ADR-008): verdict mapping, the two-call
// sequence (prose solve, then judge tool call) against the stub, and harness registration.

test("toSolveResult: unique/multiple/unsatisfiable map to SolveResults, unclear does not", () => {
  const unique = toSolveResult({ outcome: "unique", assignments: [{ culprit: "Plum" }] })
  assert.equal(unique._tag, "Ok")
  assert.equal(unique._tag === "Ok" && unique.solveResult._tag, "UniquelySolvable")

  const multi = toSolveResult({ outcome: "multiple", assignments: [{ a: 1 }, { a: 2 }] })
  assert.equal(multi._tag === "Ok" && multi.solveResult._tag, "MultiplySatisfiable")

  const unsat = toSolveResult({ outcome: "unsatisfiable", assignments: [] })
  assert.equal(unsat._tag === "Ok" && unsat.solveResult._tag, "Unsatisfiable")

  assert.deepEqual(toSolveResult({ outcome: "unclear", assignments: [] }), { _tag: "Unclear" })
})

test("toSolveResult: missing assignments degrade to empty records, never throw", () => {
  const unique = toSolveResult({ outcome: "unique", assignments: [] })
  assert.equal(unique._tag, "Ok")
  const multi = toSolveResult({ outcome: "multiple", assignments: [{ a: 1 }] })
  assert.equal(multi._tag === "Ok" && multi.solveResult._tag, "MultiplySatisfiable")
  if (multi._tag === "Ok" && multi.solveResult._tag === "MultiplySatisfiable") {
    assert.deepEqual(multi.solveResult.assignments[1], { a: 1 })
  }
})

test("harness: direct-solve issues a prose solve then a judge tool call", async () => {
  const stub = await startStubServer((exchange, callIndex) => {
    if (callIndex === 0) {
      // Solver step: prose, no tools involved. The stub always replies in tool-call form
      // when a handler calls respondWithJson; respondWithProse simulates the free prose.
      exchange.respondWithProse("The culprit is Plum. Reasoning: ...")
    } else {
      exchange.respondWithJson({ outcome: "unique", assignments: [{ culprit: "Plum" }] })
    }
  })
  const previousOverride = process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE
  const previousLocal = process.env.ZEBRA_LOCAL_BASE_URL
  const previousKey = process.env.OPENROUTER_API_KEY
  process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = stub.baseUrl
  delete process.env.ZEBRA_LOCAL_BASE_URL
  process.env.OPENROUTER_API_KEY = "dummy"
  try {
    // The solver prose call goes to the same stub endpoint (no tools declared); the stub
    // records it. requestProseCompletion reads message.content, which respondWithProse sets.
    const extraction = await Effect.runPromise(
      directSolveHarness.extract("puzzle prose", { model: "test/solver", judgeModel: "test/judge" }),
    )
    assert.equal(extraction.model, "test/solver")
    const csp = extraction.extractedCsp as { solveResult: { _tag: string } }
    assert.equal(csp.solveResult._tag, "UniquelySolvable")
    // Two calls: solve (prose) + judge (tool call by schema name).
    assert.equal(stub.requests.length, 2)
    assert.equal(stub.requests[1]?.schemaName, "DirectSolutionVerdict")

    const compilation = await Effect.runPromise(directSolveHarness.compile(extraction))
    assert.equal(compilation.mzn, null)
    const solution = await Effect.runPromise(directSolveHarness.solve(compilation))
    assert.equal(solution.solveResult._tag, "UniquelySolvable")
    assert.equal(solution.mzn, null)
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

test("harness: judge unclear surfaces as JudgeUnclear extraction failure", async () => {
  const stub = await startStubServer((exchange, callIndex) => {
    if (callIndex === 0) exchange.respondWithProse("I cannot determine anything.")
    else exchange.respondWithJson({ outcome: "unclear", assignments: [] })
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
    if (outcome._tag === "Err") assert.equal(outcome.e.tag, "JudgeUnclear")
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
