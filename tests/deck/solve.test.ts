import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { Effect } from "effect"
import { loadDeck } from "../../src/deck/load.ts"
import { deckCsp, solveDeck } from "../../src/deck/solve.ts"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const FIXTURES_DIR = join(HERE, "fixtures")

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf8")
}

async function loadFixture(name: string) {
  return await Effect.runPromise(loadDeck(readFixture(name)))
}

test("US2: deckCsp flattens deck.csp.constraints into an ExtractedCsp array", async () => {
  const deck = await loadFixture("valid-deck.yaml")
  const csp = deckCsp(deck)
  assert.deepEqual(csp.entities, deck.csp.entities)
  assert.deepEqual(csp.domains, deck.csp.domains)
  assert.equal(csp.constraints.length, Object.keys(deck.csp.constraints).length)
  for (const constraint of Object.values(deck.csp.constraints)) {
    assert.ok(csp.constraints.some((c) => JSON.stringify(c) === JSON.stringify(constraint)))
  }
})

test("US2/FR-006/FR-007: solveDeck reports UniquelySolvable for a deck with exactly one solution", async () => {
  const deck = await loadFixture("valid-deck.yaml")
  const solved = await Effect.runPromise(solveDeck(deck))
  assert.equal(solved.outcome._tag, "UniquelySolvable")
})

test("US2/FR-007: solveDeck reports Unsatisfiable for contradictory constraints", async () => {
  const deck = await loadFixture("unsatisfiable-deck.yaml")
  const solved = await Effect.runPromise(solveDeck(deck))
  assert.equal(solved.outcome._tag, "Unsatisfiable")
  assert.equal(solved.answer, undefined)
})

test("US2/FR-007: solveDeck reports MultiplySatisfiable with no fabricated answer", async () => {
  const deck = await loadFixture("multiply-satisfiable-deck.yaml")
  const solved = await Effect.runPromise(solveDeck(deck))
  assert.equal(solved.outcome._tag, "MultiplySatisfiable")
  assert.equal(solved.answer, undefined)
})

test("US3/FR-008: solveDeck returns the correct closure answer for a uniquely solved deck", async () => {
  const deck = await loadFixture("valid-deck.yaml")
  const solved = await Effect.runPromise(solveDeck(deck))
  assert.equal(solved.answer, "house-2")
})

test("US3/FR-009: solveDeck reports AmbiguousMatch instead of guessing when the closure matches more than one entity", async () => {
  const deck = await loadFixture("ambiguous-answer-deck.yaml")
  const solved = await Effect.runPromise(solveDeck(deck))
  assert.equal(solved.outcome._tag, "UniquelySolvable")
  assert.equal(solved.answer, "AmbiguousMatch")
})
