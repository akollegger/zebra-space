import { test } from "node:test"
import assert from "node:assert/strict"
import { loadAnswerValueAliases, stringsMatch } from "../../src/eval/aliases.ts"

// ADR-011 §2.2: the ONE loader for eval/aliases.json, replacing the two duplicated loadAliases()
// bodies (scripts/eval-extraction.ts, SPIKE-008's puzzles.ts).
test("loadAnswerValueAliases: reads eval/aliases.json's existing entry", async () => {
  const aliases = await loadAnswerValueAliases()
  assert.deepEqual(aliases["hardcover book set"], ["book_set", "book set", "hardcover_book_set"])
})

// User Story 1 (spec.md): a known correct answer, spelled two ways, matches; a genuinely
// different value does not.
test("stringsMatch: known variant pair matches, unrelated pair does not", () => {
  assert.equal(stringsMatch("Hardcover Book Set", "book_set", { "hardcover book set": ["book_set"] }), true)
  assert.equal(stringsMatch("Red", "Bed"), false)
})

// FR-002: case/whitespace/separator variance folds without any alias-table entry at all.
test("stringsMatch: case/whitespace/separator variants of the same value match with no alias table", () => {
  assert.equal(stringsMatch("Lucky Strike", "LuckyStrike"), true)
  assert.equal(stringsMatch("lucky_strike", "LUCKY STRIKE"), true)
})

// User Story 1, Acceptance Scenario 2 (spec.md): the SAME logic that serves answer-value
// comparisons also serves a domain-name-shaped comparison (SPIKE-015 §5.2's "game move"/
// "moves" vs "move" case) — no separately-written heuristic.
test("stringsMatch: a domain-name-shaped alias table matches a qualifier/plural variant of the domain's own name", () => {
  const domainNameAliases = { move: ["game move", "player move"] }
  assert.equal(stringsMatch("game move", "move", domainNameAliases), true)
  assert.equal(stringsMatch("moves", "move", domainNameAliases), true) // plural fold, no alias needed
  // The ACTUAL SPIKE-015 §5.2 motivating phrase combines the qualifier AND the plural together
  // ("game moves") — found live in code review (second pass) that this combined case wasn't
  // separately tested, and it exercises a real, distinct code path: the listed variant is
  // "game move" (singular), so this only matches if comparisonKey's per-word lemmatization folds
  // "game moves" to the same key as the listed variant's own fold, not merely if each half works
  // in isolation.
  assert.equal(stringsMatch("game moves", "move", domainNameAliases), true)
  assert.equal(stringsMatch("action", "move", domainNameAliases), false) // genuine synonym: correctly NOT matched
})

// User Story 3 (spec.md), FR-006: no similarity/embedding/edit-distance signal ever decides a
// live match by itself. "Bed" and "Red" are one Levenshtein edit apart and superficially close
// (ADR-011 §2.3's own named risk) yet must never match without an explicit alias entry.
test("stringsMatch: a superficially similar but unlisted pair never matches (no live fuzzy promotion)", () => {
  assert.equal(stringsMatch("Bed", "Red"), false)
  assert.equal(stringsMatch("Rock", "Sock"), false)
  assert.equal(stringsMatch("move", "action"), false)
})
