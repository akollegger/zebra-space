import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { Effect } from "effect"
import { loadDeck } from "../../src/deck/load.ts"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const FIXTURES_DIR = join(HERE, "fixtures")

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf8")
}

test("US1/FR-002: a deck whose every reference resolves is accepted as structurally valid", async () => {
  const deck = await Effect.runPromise(loadDeck(readFixture("valid-deck.yaml")))
  assert.equal(deck.id, "DECK-0000")
  assert.equal(deck.cards.length, 7)
})

test("US1/FR-002: a card's dangling dependsOn reference is rejected, naming the card and target", async () => {
  const error = await Effect.runPromise(Effect.flip(loadDeck(readFixture("dangling-reference.yaml"))))
  assert.equal(error._tag, "DanglingReference")
  if (error._tag === "DanglingReference") {
    assert.equal(error.card, "domain-colors")
    assert.equal(error.field, "dependsOn")
    assert.equal(error.target, "domain-registry")
  }
})

test("US1/FR-003: a dependsOn cycle is rejected, naming a card in the cycle", async () => {
  const error = await Effect.runPromise(Effect.flip(loadDeck(readFixture("dependency-cycle.yaml"))))
  assert.equal(error._tag, "DependencyCycle")
  if (error._tag === "DependencyCycle") {
    assert.ok(error.cards.includes("card-a"))
    assert.ok(error.cards.includes("card-b"))
  }
})

test("US1/FR-004: an unsupported tier is rejected, naming the card and tier", async () => {
  const error = await Effect.runPromise(Effect.flip(loadDeck(readFixture("unsupported-tier.yaml"))))
  assert.equal(error._tag, "UnsupportedTier")
  if (error._tag === "UnsupportedTier") {
    assert.equal(error.card, "domain-colors")
    assert.equal(error.tier, "ambiguous")
  }
})

test("US1/FR-004: an unrecognized constraint kind is rejected, naming the constraint id and kind", async () => {
  const error = await Effect.runPromise(
    Effect.flip(loadDeck(readFixture("unsupported-constraint-kind.yaml"))),
  )
  assert.equal(error._tag, "UnsupportedConstraintKind")
  if (error._tag === "UnsupportedConstraintKind") {
    assert.equal(error.constraintId, "c-bogus")
    assert.equal(error.kind, "exclusivity")
  }
})
