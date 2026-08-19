import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { Effect } from "effect"
import { solve } from "../../src/solver/solve.ts"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const CATALOG_MZN_DIR = join(HERE, "..", "..", "catalog", "mzn")

test("SC-004/FR-009: PZL-0004 (Whodunit) solves uniquely, matching its recorded answer key", async () => {
  const model = readFileSync(join(CATALOG_MZN_DIR, "PZL-0004-whodunit.mzn"), "utf8")
  const result = await Effect.runPromise(solve({ model }))

  assert.equal(result._tag, "UniquelySolvable")
  if (result._tag === "UniquelySolvable") {
    // eval/answer-keys.json: Professor Plum, Candlestick, Conservatory.
    // Enum-typed variables come back wrapped as { e: "Name" } — research.md Finding 6.
    assert.deepEqual(result.assignment.culprit, { e: "Plum" })
    assert.deepEqual(result.assignment.weapon, { e: "Candlestick" })
    assert.deepEqual(result.assignment.room, { e: "Conservatory" })
  }
})
