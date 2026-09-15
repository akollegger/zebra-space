import { test } from "node:test"
import assert from "node:assert/strict"
import { Effect } from "effect"
import { EXTRACTION_PROMPT_VERSION, STAGED_PROMPT_VERSION, extractionPrompts } from "../../src/extraction/extract.ts"
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

test("registry: extraction harnesses share the current extraction prompt version", () => {
  // direct-solve carries its own DIRECT_SOLVE_PROMPT_VERSION (own prompts, own assertion below),
  // and staged-single-shot carries its own STAGED_PROMPT_VERSION (ADR-009's separate two-stage
  // prompt set, own assertion below) — this loop's coincidental pass before SPIKE-011's stage-1
  // prompt revision (both version constants happened to equal 1) was itself the bug this
  // exclusion fixes, not a regression this spike introduced.
  for (const harness of listHarnesses().filter((h) => h.id !== "direct-solve" && h.id !== "staged-single-shot")) {
    assert.equal(harness.promptVersion, EXTRACTION_PROMPT_VERSION)
  }
  assert.equal(lookupHarness("staged-single-shot")?.promptVersion, STAGED_PROMPT_VERSION)
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
    extract: () => Effect.succeed({ extractedCsp: { stub: true }, model: "stub-model", actualCostUsd: undefined }),
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
  assert.deepEqual(extraction, { extractedCsp: { stub: true }, model: "stub-model", actualCostUsd: undefined })
  const compilation = await Effect.runPromise(stub.compile(extraction))
  assert.equal(compilation.mzn, "stub-mzn")
  const solution = await Effect.runPromise(stub.solve(compilation))
  assert.equal(solution.solveResult._tag, "Unsatisfiable")
})

// --- ADR-010 §2.2 stage forwarding (T010) -------------------------------------------------
// compile/solve forward actualCostUsd unchanged; a measured 0 stays 0 (never coerced to
// absent), and absent stays absent (never fabricated as 0).

const FORWARD_CSP = {
  entities: [{ id: "H1", type: "house" }],
  domains: [{ variable: "color", entityType: "house", values: ["Red", "Blue"] }],
  constraints: [],
}

test("ADR-010: compile forwards a measured zero unchanged, never as absent", async () => {
  const compilation = await Effect.runPromise(
    fullCriticHarness.compile({ extractedCsp: FORWARD_CSP, model: "m", actualCostUsd: 0 }),
  )
  assert.equal(compilation.actualCostUsd, 0)
})

test("ADR-010: compile forwards an absent actual unchanged, never as zero", async () => {
  const compilation = await Effect.runPromise(
    fullCriticHarness.compile({ extractedCsp: FORWARD_CSP, model: "m", actualCostUsd: undefined }),
  )
  assert.equal(compilation.actualCostUsd, undefined)
  assert.ok("actualCostUsd" in compilation)
})

test("ADR-010: compile forwards a measured sum unchanged", async () => {
  const compilation = await Effect.runPromise(
    fullCriticHarness.compile({ extractedCsp: FORWARD_CSP, model: "m", actualCostUsd: 0.375 }),
  )
  assert.equal(compilation.actualCostUsd, 0.375)
})
