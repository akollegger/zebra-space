import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { solve } from "../../src/solver/solve.ts"

const UNSATISFIABLE_MODEL = "var 1..2: x; constraint x > 5; solve satisfy;"
const UNIQUELY_SOLVABLE_MODEL = "var 1..2: x; constraint x > 1; solve satisfy;"
const MULTIPLY_SATISFIABLE_MODEL =
  "var 1..3: x; var 1..3: y; constraint x != y; solve satisfy;"

function run<A>(effect: Effect.Effect<A, unknown>): Promise<A> {
  return Effect.runPromise(effect)
}

test("SC-001: an unsatisfiable model is classified as Unsatisfiable", async () => {
  const result = await run(solve({ model: UNSATISFIABLE_MODEL }))
  assert.equal(result._tag, "Unsatisfiable")
})

test("SC-002: a uniquely solvable model is classified as UniquelySolvable with the correct assignment", async () => {
  const result = await run(solve({ model: UNIQUELY_SOLVABLE_MODEL }))
  assert.equal(result._tag, "UniquelySolvable")
  if (result._tag === "UniquelySolvable") {
    assert.equal(result.assignment.x, 2)
  }
})

test("SC-003: a multiply satisfiable model is classified as MultiplySatisfiable without over-searching", async () => {
  const result = await run(solve({ model: MULTIPLY_SATISFIABLE_MODEL }))
  assert.equal(result._tag, "MultiplySatisfiable")
  if (result._tag === "MultiplySatisfiable") {
    assert.equal(result.assignments.length, 2)
  }
})

test("FR-004: a solution's keys are the model's own variable names, not positional indices", async () => {
  const model =
    "var 1..2: favoriteColor; var 1..2: luckyNumber; constraint favoriteColor != luckyNumber; constraint favoriteColor = 2; solve satisfy;"
  const result = await run(solve({ model }))
  assert.equal(result._tag, "UniquelySolvable")
  if (result._tag === "UniquelySolvable") {
    assert.deepEqual(Object.keys(result.assignment).sort(), ["favoriteColor", "luckyNumber"])
    assert.equal(result.assignment.favoriteColor, 2)
    assert.equal(result.assignment.luckyNumber, 1)
  }
})

test("SC-005: no temp files remain after a solve attempt, success or failure", async () => {
  // Scope os.tmpdir() to a dedicated, empty scratch directory for this test only, via the
  // TMPDIR env var it reads (not cached — re-read on every call). Avoids the flakiness of
  // scanning the *global* OS tmpdir, which other concurrently-running test files also write
  // "minizinc-*" entries into (node --test runs test files concurrently by default).
  const scratchDir = mkdtempSync(join(tmpdir(), "solve-cleanup-test-"))
  const originalTmpdir = process.env.TMPDIR
  process.env.TMPDIR = scratchDir

  try {
    await run(solve({ model: UNIQUELY_SOLVABLE_MODEL }))
    await run(solve({ model: "not a valid model" })).catch(() => undefined)
    assert.deepEqual(readdirSync(scratchDir), [])
  } finally {
    if (originalTmpdir === undefined) {
      delete process.env.TMPDIR
    } else {
      process.env.TMPDIR = originalTmpdir
    }
    rmSync(scratchDir, { recursive: true, force: true })
  }
})
