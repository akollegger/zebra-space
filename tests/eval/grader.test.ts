import { test } from "node:test"
import assert from "node:assert/strict"
import {
  COP_OPTIMA,
  alignArraysByOverlap,
  gradeAmbiguous,
  gradeCop,
  gradeDeterminate,
  gradeFlatRecord,
  gradeNonProblem,
  gradeParallelArrays,
  gradeRowKeyedMapping,
  gradeSubjective,
  gradeSubset,
  isExcludedVerdict,
  isPassingVerdict,
  normalizeToken,
} from "../../src/eval/grader.ts"

// ADR-007 §2.2: normalization reuses the compiler's sanitizeIdentifier (no duplicate) plus
// the integer passthrough and the versioned alias table.

test("normalizeToken: integers pass through, identifiers sanitize+fold, aliases resolve", () => {
  assert.deepEqual(normalizeToken("42", {}), { normalized: "42", aliasApplied: false })
  assert.deepEqual(normalizeToken("Orange Juice", {}), { normalized: "orangejuice", aliasApplied: false })
  assert.deepEqual(normalizeToken("true", {}), { normalized: "true", aliasApplied: false })
  const aliases = { "hardcover book set": ["book_set"] }
  assert.deepEqual(normalizeToken("book_set", aliases), { normalized: "hardcoverbookset", aliasApplied: true })
  // Found live in code review: a token spelled EXACTLY as the canonical (just a case/separator
  // rendering the deterministic fold alone already bridges) must NOT report aliasApplied: true —
  // no curated variant was actually needed to reach this match, only the fold was.
  assert.deepEqual(normalizeToken("hardcover book set", aliases), { normalized: "hardcoverbookset", aliasApplied: false })
  assert.deepEqual(normalizeToken("unrelated", aliases), { normalized: "unrelated", aliasApplied: false })
})

// Found live 2026-09-16 (SPIKE-014 `formalize-mzn` blast-radius investigation): a model
// authoring a MiniZinc identifier directly is free to choose any spelling convention for the
// SAME value the answer key spells one particular way — sanitizeIdentifier alone (no
// case-folding, no separator-bridging) treated every one of these as a different token, so a
// genuinely correct solve graded as a false MISMATCH. Confirmed against 17 re-solved,
// hand-checked cases from a real frontier-tier run before this fix.
test("normalizeToken: case and separator-style variants of the same value converge (formalize-mzn grading gap)", () => {
  const variants = ["Lucky Strike", "Lucky_Strike", "LuckyStrike", "LUCKY_STRIKE", "lucky strike"]
  const normalized = variants.map((v) => normalizeToken(v, {}).normalized)
  assert.equal(new Set(normalized).size, 1, `expected all variants to converge, got: ${normalized.join(", ")}`)
})

test("gradeFlatRecord: a model-authored identifier in a different case/separator convention still matches", () => {
  const result = gradeFlatRecord({ suspect: "Professor Plum" }, { suspect: "PROFESSOR_PLUM" })
  assert.equal(result.verdict, "MATCH")
})

// SPIKE-015 §5.2: a domain-name comparison rejected "game move"/"game moves" against ground
// truth's "move" purely for plain pluralization — a gap distinct from synonym variance, and
// mechanically predictable (folding a plural to its singular), unlike an open-ended alias.
// Folded into comparisonKey itself (ADR-011 §2.1) rather than requiring a curated alias entry
// per pair, via wink-lemmatizer's dictionary/rule-based noun lemmatizer (not a hand-rolled
// suffix strip — see comparisonKey's own docstring for why a first attempt at this using a bare
// trailing-"s" regex was replaced before merge).
test("normalizeToken: plain pluralization folds without a curated alias entry", () => {
  assert.equal(normalizeToken("moves", {}).normalized, normalizeToken("move", {}).normalized)
  assert.equal(normalizeToken("animals", {}).normalized, normalizeToken("animal", {}).normalized)
  // The common "-es" sibilant plural must ALSO fold — the exact case a bare trailing-"s" strip
  // missed (found live in code review before merge).
  assert.equal(normalizeToken("buses", {}).normalized, normalizeToken("bus", {}).normalized)
  assert.equal(normalizeToken("boxes", {}).normalized, normalizeToken("box", {}).normalized)
  // Short words ending in "s" must NOT fold — stripping would collide unrelated words
  // ("bus" -> "bu", "gas" -> "ga") rather than recovering a real singular/plural pair.
  assert.notEqual(normalizeToken("bus", {}).normalized, "bu")
  assert.notEqual(normalizeToken("gas", {}).normalized, "ga")
  // A doubled trailing "s" (e.g. "class") must not lose one s either.
  assert.equal(normalizeToken("class", {}).normalized, "class")
  // Two DIFFERENT real words must never collide just because one is "the other plus s" — the
  // false-positive a bare trailing-"s" strip introduced (found live in code review before
  // merge: "news"/"new" and "lens"/"len" both silently collapsed together).
  assert.notEqual(normalizeToken("news", {}).normalized, normalizeToken("new", {}).normalized)
  assert.notEqual(normalizeToken("lens", {}).normalized, normalizeToken("len", {}).normalized)
})

// Found live in code review (second pass): the actual SPIKE-015 §5.2 motivating case combines a
// QUALIFIER word and a PLURAL together ("game moves"), not just a bare plural. Lemmatizing the
// whole merged compound ("gamemoves") never folds (wink-lemmatizer only accepts a stripped
// candidate that is itself a real dictionary word, and "gamemove" is not one) — comparisonKey
// must lemmatize each underscore-separated word BEFORE merging, so "game"+"moves" folds to
// "game"+"move" first, THEN merges to "gamemove", matching "game move" / "game_move".
test("normalizeToken: a qualifier plus a plural together folds per-word, not as one merged compound", () => {
  assert.equal(normalizeToken("game moves", {}).normalized, normalizeToken("game move", {}).normalized)
  assert.equal(normalizeToken("game_moves", {}).normalized, normalizeToken("game_move", {}).normalized)
})

test("gradeParallelArrays: identical grids match regardless of entity declaration order", () => {
  const expected = { color: ["Red", "Blue"], pet: ["Dog", "Cat"] }
  const reordered = { pet: ["Dog", "Cat"], color: ["Red", "Blue"] }
  assert.equal(gradeParallelArrays(expected, reordered).verdict, "MATCH")
})

test("gradeParallelArrays: a transposed pairing mismatches (the old vocabulary-only blind spot)", () => {
  const expected = { color: ["Red", "Blue"], pet: ["Dog", "Cat"] }
  const transposed = { color: ["Red", "Blue"], pet: ["Cat", "Dog"] }
  const result = gradeParallelArrays(expected, transposed)
  assert.equal(result.verdict, "MISMATCH")
  assert.match(result.detail, /row mismatch/)
})

test("gradeParallelArrays: renamed actual keys align by vocabulary overlap", () => {
  const expected = { color: ["Red", "Blue"], pet: ["Dog", "Cat"] }
  const renamed = { house_color: ["Red", "Blue"], animal: ["Dog", "Cat"] }
  assert.equal(gradeParallelArrays(expected, renamed).verdict, "MATCH")
})

test("gradeParallelArrays: ambiguous alignment fails loudly instead of guessing", () => {
  const expected = { a: ["X", "Y"], b: ["X", "Y"] }
  const actual = { c: ["X", "Y"], d: ["X", "Y"] }
  const result = gradeParallelArrays(expected, actual)
  assert.equal(result.verdict, "MISMATCH")
  assert.match(result.detail, /no unambiguous alignment/)
})

test("alignArraysByOverlap: zero overlap is unalignable", () => {
  const result = alignArraysByOverlap({ a: ["X"] }, { b: ["Y"] })
  assert.ok("unalignable" in result)
})

test("gradeRowKeyedMapping: numeric-keyed records compare as pair sets", () => {
  const expected = { "1": 2, "2": 4, "3": 1, "4": 3 }
  assert.equal(gradeRowKeyedMapping(expected, { "1": 2, "2": 4, "3": 1, "4": 3 }).verdict, "MATCH")
  const wrong = gradeRowKeyedMapping(expected, { "1": 2, "2": 1, "3": 4, "4": 3 })
  assert.equal(wrong.verdict, "MISMATCH")
  assert.match(wrong.detail, /row 2/)
})

test("gradeRowKeyedMapping: single positional array reads rows 1..n in index order", () => {
  const expected = { "1": 2, "2": 4, "3": 1, "4": 3 }
  assert.equal(gradeRowKeyedMapping(expected, { columns: [2, 4, 1, 3] }).verdict, "MATCH")
  assert.equal(gradeRowKeyedMapping(expected, { columns: [2, 1, 4, 3] }).verdict, "MISMATCH")
})

test("gradeSubset: PZL-0014 shape — expected items present among extras is a MATCH", () => {
  const actual = { item: ["Rice", "First Aid Kit", "Book Set", "Skillet", "Toolbox"], packed: ["Yes", "Yes", "Yes", "No", "No"] }
  assert.equal(gradeSubset(["Rice", "First Aid Kit", "Book Set"], actual).verdict, "MATCH")
  const missing = gradeSubset(["Rice", "Skillet", "Tent"], actual)
  assert.equal(missing.verdict, "MISMATCH")
  assert.match(missing.detail, /Tent/)
})

test("gradeDeterminate: dispatches PZL-0006, subset, parallel arrays, flat records", () => {
  const rowMapping = gradeDeterminate("PZL-0006", { row_to_column: { "1": 2, "2": 4 } }, { "1": 2, "2": 4 })
  assert.equal(rowMapping.verdict, "MATCH")
  const subset = gradeDeterminate("PZL-0014", { items: ["Rice"] }, { item: ["Rice", "Book Set"] })
  assert.equal(subset.verdict, "MATCH")
  const parallel = gradeDeterminate("PZL-0001", { color: ["Red"], pet: ["Dog"] }, { color: ["Red"], pet: ["Dog"] })
  assert.equal(parallel.verdict, "MATCH")
  const parallelMismatch = gradeDeterminate("PZL-0001", { color: ["Red"], pet: ["Dog"] }, { color: ["Red"], pet: ["Cat"] })
  assert.equal(parallelMismatch.verdict, "MISMATCH")
  const flat = gradeDeterminate("PZL-0003", { mapping: { A: 1 } }, { mapping: ["A=1"] })
  assert.equal(flat.verdict, "MATCH")
})

test("gradeDeterminate: parallel-array path unwraps MiniZinc's {e: value} enum shape (found live 2026-09-16, PZL-0002's own historical full-critic runs)", () => {
  // The exact shape a real solve() returns for an enum-typed domain — confirmed against
  // design/spikes/SPIKE-008.../results/comparison-2026-09-15T11-24-35-879Z.json's committed
  // PZL-0002 record, which silently misgraded a correct extraction as MISMATCH before this fix.
  const wrapped = gradeDeterminate(
    "PZL-0002",
    { color: ["Blue", "Red", "Green"], animal: ["Dog", "Cat", "Zebra"] },
    { color: [{ e: "Blue" }, { e: "Red" }, { e: "Green" }], animal: [{ e: "Dog" }, { e: "Cat" }, { e: "Zebra" }] },
  )
  assert.equal(wrapped.verdict, "MATCH")
})

test("gradeDeterminate: parallel-array path unwraps a doubly-nested single-key wrapper too (PR #32 review comment — recursive, not depth-1-only)", () => {
  // No known live shape nests two levels deep today, but the unwrap is recursive on purpose
  // (matching collectActualTokens's own recursive unwrap) so a future, deeper solved shape
  // still resolves instead of silently stopping at depth 1.
  const doublyWrapped = gradeDeterminate(
    "PZL-0002",
    { color: ["Blue"] },
    { color: [{ outer: { e: "Blue" } }] },
  )
  assert.equal(doublyWrapped.verdict, "MATCH")
})

test("gradeDeterminate: a non-scalar subset item grades MISMATCH, never throws", () => {
  const result = gradeDeterminate("PZL-0014", { items: [["Rice"]] }, { item: ["Rice"] })
  assert.equal(result.verdict, "MISMATCH")
  assert.match(result.detail, /non-scalar/)
})

test("gradeFlatRecord: single-key wrapped values ({e: value}) unwrap before comparing", () => {
  const wrapped = gradeFlatRecord({ culprit: "Professor Plum" }, { culprit: { e: "Professor_Plum" } })
  assert.equal(wrapped.verdict, "MATCH")
})

// Expected side is spelled EXACTLY as the canonical ("hardcover book set") — the deterministic
// fold alone bridges that, no curated variant needed, so it must NOT count. Actual side is
// spelled as the listed variant ("book_set") — that's the one real alias resolution. Updated in
// code review from an earlier version of this test that expected 2 (both sides counted, before
// normalizeToken's canonical-self-match false-positive was fixed — see normalizeToken's own
// docstring).
test("aliasesApplied: row-keyed and subset paths count both sides, dispatch passes through", () => {
  const aliases = { "hardcover book set": ["book_set"] }
  const rowKeyed = gradeRowKeyedMapping({ "1": "hardcover book set" }, { "1": "book_set" }, aliases)
  assert.equal(rowKeyed.verdict, "MATCH")
  assert.equal(rowKeyed.aliasesApplied, 1)
  const subset = gradeSubset(["hardcover book set"], { item: ["book_set"] }, aliases)
  assert.equal(subset.verdict, "MATCH")
  assert.equal(subset.aliasesApplied, 1)
  const viaDispatchRow = gradeDeterminate("PZL-0006", { row_to_column: { "1": "hardcover book set" } }, { "1": "book_set" }, aliases)
  assert.equal(viaDispatchRow.aliasesApplied, 1)
  const viaDispatchSubset = gradeDeterminate("PZL-0014", { items: ["hardcover book set"] }, { item: ["book_set"] }, aliases)
  assert.equal(viaDispatchSubset.aliasesApplied, 1)
})

test("gradeSubset: single-key wrapped values unwrap before comparing", () => {
  assert.equal(gradeSubset(["Rice"], { item: { e: "Rice" } }).verdict, "MATCH")
})

test("gradeFlatRecord: paraphrase resolves through the alias table and is counted", () => {
  const aliases = { "hardcover book set": ["book_set"] }
  const result = gradeFlatRecord({ items: ["hardcover book set"] }, { item: ["book_set"] }, aliases)
  assert.equal(result.verdict, "MATCH")
  // Only the "book_set" side is a real variant resolution; the canonical-spelled side needs no
  // alias at all (see the test above for why this is 1, not 2).
  assert.equal(result.aliasesApplied, 1)
})

test("gradeCop: optimum attained in any enumerated solution; otherwise FEASIBLE_ONLY; unsatisfiable is INFEASIBLE", () => {
  for (const [puzzleId, optimum] of Object.entries(COP_OPTIMA)) {
    const attained = gradeCop(puzzleId, { _tag: "UniquelySolvable", assignment: { [optimum.optimumField]: optimum.optimumValue } })
    assert.equal(attained.verdict, "OPTIMUM_ATTAINED", puzzleId)
    const feasible = gradeCop(puzzleId, { _tag: "UniquelySolvable", assignment: { [optimum.optimumField]: optimum.optimumValue - 1 } })
    assert.equal(feasible.verdict, "FEASIBLE_ONLY", puzzleId)
    const multi = gradeCop(puzzleId, {
      _tag: "MultiplySatisfiable",
      assignments: [{ [optimum.optimumField]: 0 }, { [optimum.optimumField]: optimum.optimumValue }],
    })
    assert.equal(multi.verdict, "OPTIMUM_ATTAINED", puzzleId)
    // An infeasible model is a wrong extraction, never a variant of feasible-but-suboptimal —
    // it must be a counted failure (ADR-007 §2.1), distinct from the excluded FEASIBLE_ONLY.
    const infeasible = gradeCop(puzzleId, { _tag: "Unsatisfiable" })
    assert.equal(infeasible.verdict, "INFEASIBLE", puzzleId)
  }
  // A puzzle with no recorded optimum stays FEASIBLE_ONLY regardless of solve result — that
  // branch is about missing grading data, not about the solve outcome.
  assert.equal(gradeCop("PZL-9999", { _tag: "Unsatisfiable" }).verdict, "FEASIBLE_ONLY")
})

test("gradeAmbiguous: pipeline outcome must equal some reading's result", () => {
  const readings = [
    { result: "uniquely solvable", answer: { x: ["A"] } },
    { result: "multiply satisfiable", solution_count: 2 },
  ]
  const matched = gradeAmbiguous(readings, { _tag: "MultiplySatisfiable", assignments: [{}, {}] }, "PZL-0028")
  assert.equal(matched.verdict, "READING_MATCHED")
  const answerMatched = gradeAmbiguous(readings, { _tag: "UniquelySolvable", assignment: { x: ["A"] } }, "PZL-0028")
  assert.equal(answerMatched.verdict, "READING_MATCHED")
  const noMatch = gradeAmbiguous(readings, { _tag: "Unsatisfiable" }, "PZL-0028")
  assert.equal(noMatch.verdict, "NO_MATCHING_READING")
  const wrongAnswer = gradeAmbiguous(readings, { _tag: "UniquelySolvable", assignment: { x: ["B"] } }, "PZL-0028")
  assert.equal(wrongAnswer.verdict, "NO_MATCHING_READING")
})

test("gradeSubjective: premise-free outcome passes; premise-loaded unique solution is flagged", () => {
  const entry = { without_premise: { result: "multiply satisfiable" }, with_premise: { answer: { x: ["A"] } } }
  assert.equal(gradeSubjective(entry, { _tag: "MultiplySatisfiable", assignments: [{}, {}] }, "PZL-0033").verdict, "PREMISE_FREE_MATCH")
  const promoted = gradeSubjective(entry, { _tag: "UniquelySolvable", assignment: { x: ["A"] } }, "PZL-0033")
  assert.equal(promoted.verdict, "PREMISE_SILENTLY_PROMOTED")
  const uniqueOther = gradeSubjective(entry, { _tag: "UniquelySolvable", assignment: { x: ["B"] } }, "PZL-0033")
  assert.equal(uniqueOther.verdict, "PREMISE_SILENTLY_PROMOTED")
})

test("gradeNonProblem: every run is UNDECLINED with the failing condition named", () => {
  const result = gradeNonProblem("Demand")
  assert.equal(result.verdict, "UNDECLINED")
  assert.match(result.detail, /Demand/)
})

test("verdict accounting: passes count, FEASIBLE_ONLY and UNDECLINED are excluded", () => {
  for (const verdict of ["MATCH", "OPTIMUM_ATTAINED", "READING_MATCHED", "PREMISE_FREE_MATCH", "DECLINED_CORRECTLY"] as const) {
    assert.equal(isPassingVerdict(verdict), true, verdict)
    assert.equal(isExcludedVerdict(verdict), false, verdict)
  }
  for (const verdict of ["FEASIBLE_ONLY", "UNDECLINED"] as const) {
    assert.equal(isPassingVerdict(verdict), false, verdict)
    assert.equal(isExcludedVerdict(verdict), true, verdict)
  }
  for (const verdict of ["MISMATCH", "NO_MATCHING_READING", "PREMISE_SILENTLY_PROMOTED"] as const) {
    assert.equal(isPassingVerdict(verdict), false, verdict)
    assert.equal(isExcludedVerdict(verdict), false, verdict)
  }
})
