import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { Effect } from "effect"
import { classifyCards } from "../../src/deck/classify.ts"
import { loadDeck } from "../../src/deck/load.ts"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const FIXTURES_DIR = join(HERE, "fixtures")

async function loadFixture(name: string) {
  const text = readFileSync(join(FIXTURES_DIR, name), "utf8")
  return await Effect.runPromise(loadDeck(text))
}

test("US3/FR-005: a card with no reveals and no constraints is classified as noise", async () => {
  const deck = await loadFixture("redundant-cards-deck.yaml")
  const classifications = classifyCards(deck)
  assert.equal(classifications["noise-card"], "noise")
})

test("US3/FR-005: the first card naming a shared constraint is primary; the second is redundant", async () => {
  const deck = await loadFixture("redundant-cards-deck.yaml")
  const classifications = classifyCards(deck)
  assert.equal(classifications["red-house1"], "constraint")
  assert.equal(classifications["red-house1-echo"], "redundant")
})

test("US3/FR-005: the same first-appearance rule applies to a shared reveals target", async () => {
  const deck = await loadFixture("redundant-cards-deck.yaml")
  const classifications = classifyCards(deck)
  assert.equal(classifications["domain-colors"], "domain")
  assert.equal(classifications["domain-colors-echo"], "redundant")
})
