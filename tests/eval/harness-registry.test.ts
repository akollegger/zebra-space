import { test } from "node:test"
import assert from "node:assert/strict"
import { Effect } from "effect"
import { EXTRACTION_PROMPT_VERSION, extractionPrompts } from "../../src/extraction/extract.ts"
import {
  WORKFLOW_TO_HARNESS_ID,
  compileRepairHarness,
  fullCriticHarness,
  listHarnesses,
  lookupHarness,
  singleShotHarness,
  type EvalHarness,
} from "../../src/eval/harness.ts"

// The harness seam: built-in harnesses are registered, prompt versions are exposed, and a
// custom harness with stub stages fits the interface without touching the runner.

test("registry: the built-in harnesses resolve by id with distinct budgets", () => {
  assert.equal(lookupHarness("full-critic"), fullCriticHarness)
  assert.equal(lookupHarness("single-shot"), singleShotHarness)
  assert.equal(lookupHarness("compile-repair"), compileRepairHarness)
  assert.equal(lookupHarness("no-such-harness"), undefined)
  assert.deepEqual(
    [fullCriticHarness, singleShotHarness, compileRepairHarness].map((h) => h.maxCallsPerPuzzle),
    [12, 1, 2],
  )
  assert.ok(listHarnesses().length >= 3)
})

test("registry: local-single-shot is registered with single-shot budget and shared prompt version", async () => {
  const { localSingleShotHarness } = await import("../../src/eval/harness.ts")
  assert.equal(lookupHarness("local-single-shot"), localSingleShotHarness)
  assert.equal(localSingleShotHarness.maxCallsPerPuzzle, 1)
  assert.equal(localSingleShotHarness.promptVersion, EXTRACTION_PROMPT_VERSION)
})

test("registry: legacy workflow flags map to harness ids", () => {
  assert.deepEqual(WORKFLOW_TO_HARNESS_ID, {
    full: "full-critic",
    "no-critic": "single-shot",
    "compile-repair-only": "compile-repair",
  })
})

test("registry: all built-ins share the current extraction prompt version", () => {
  for (const harness of listHarnesses()) {
    assert.equal(harness.promptVersion, EXTRACTION_PROMPT_VERSION)
  }
})

test("prompts: extractionPrompts exposes the versioned prompt text", () => {
  const prompts = extractionPrompts()
  assert.equal(prompts.version, EXTRACTION_PROMPT_VERSION)
  assert.match(prompts.extractionSystem, /constraint-satisfaction-problem/)
  assert.match(prompts.critiqueSystem, /fidelity/)
})

test("seam: a custom harness with stub stages runs stage-by-stage through the interface", async () => {
  const stub: EvalHarness = {
    id: "stub",
    description: "offline stub for interface conformance",
    promptVersion: 99,
    maxCallsPerPuzzle: 0,
    extract: () => Effect.succeed({ extractedCsp: { stub: true }, model: "stub-model" }),
    compile: (extraction) => Effect.succeed({ ...extraction, mzn: "stub-mzn" }),
    solve: (compilation) =>
      Effect.succeed({
        ...compilation,
        solveResult: { _tag: "Unsatisfiable" as const },
      }),
  }
  assert.equal(lookupHarness("stub", [stub]), stub)
  assert.ok(!listHarnesses().some((h) => h.id === "stub"))

  const extraction = await Effect.runPromise(stub.extract("prose", {}))
  assert.deepEqual(extraction, { extractedCsp: { stub: true }, model: "stub-model" })
  const compilation = await Effect.runPromise(stub.compile(extraction))
  assert.equal(compilation.mzn, "stub-mzn")
  const solution = await Effect.runPromise(stub.solve(compilation))
  assert.equal(solution.solveResult._tag, "Unsatisfiable")
})
