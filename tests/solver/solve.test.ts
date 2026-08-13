import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { Effect } from "effect"
import { solve } from "../../src/solver/solve.ts"

const UNSATISFIABLE_MODEL = "var 1..2: x; constraint x > 5; solve satisfy;"
const UNIQUELY_SOLVABLE_MODEL = "var 1..2: x; constraint x > 1; solve satisfy;"
const MULTIPLY_SATISFIABLE_MODEL =
  "var 1..3: x; var 1..3: y; constraint x != y; solve satisfy;"

function run<A>(effect: Effect.Effect<A, unknown>): Promise<A> {
  return Effect.runPromise(effect)
}

function tempDirSnapshot(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.includes("minizinc"))
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
  const before = tempDirSnapshot()
  await run(solve({ model: UNIQUELY_SOLVABLE_MODEL }))
  await run(solve({ model: "not a valid model" })).catch(() => undefined)
  const after = tempDirSnapshot()
  assert.deepEqual(after, before)
})
