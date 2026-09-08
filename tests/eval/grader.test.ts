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

test("normalizeToken: integers pass through, identifiers sanitize, aliases resolve", () => {
  assert.deepEqual(normalizeToken("42", {}), { normalized: "42", aliasApplied: false })
  assert.deepEqual(normalizeToken("Orange Juice", {}), { normalized: "Orange_Juice", aliasApplied: false })
  assert.deepEqual(normalizeToken("true", {}), { normalized: "true_", aliasApplied: false })
  const aliases = { "hardcover book set": ["book_set"] }
  assert.deepEqual(normalizeToken("book_set", aliases), { normalized: "hardcover_book_set", aliasApplied: true })
  assert.deepEqual(normalizeToken("hardcover book set", aliases), { normalized: "hardcover_book_set", aliasApplied: true })
  assert.deepEqual(normalizeToken("unrelated", aliases), { normalized: "unrelated", aliasApplied: false })
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

test("gradeDeterminate: a non-scalar subset item grades MISMATCH, never throws", () => {
  const result = gradeDeterminate("PZL-0014", { items: [["Rice"]] }, { item: ["Rice"] })
  assert.equal(result.verdict, "MISMATCH")
  assert.match(result.detail, /non-scalar/)
})

test("gradeFlatRecord: single-key wrapped values ({e: value}) unwrap before comparing", () => {
  const wrapped = gradeFlatRecord({ culprit: "Professor Plum" }, { culprit: { e: "Professor_Plum" } })
  assert.equal(wrapped.verdict, "MATCH")
})

test("aliasesApplied: row-keyed and subset paths count both sides, dispatch passes through", () => {
  const aliases = { "hardcover book set": ["book_set"] }
  const rowKeyed = gradeRowKeyedMapping({ "1": "hardcover book set" }, { "1": "book_set" }, aliases)
  assert.equal(rowKeyed.verdict, "MATCH")
  assert.equal(rowKeyed.aliasesApplied, 2)
  const subset = gradeSubset(["hardcover book set"], { item: ["book_set"] }, aliases)
  assert.equal(subset.verdict, "MATCH")
  assert.equal(subset.aliasesApplied, 2)
  const viaDispatchRow = gradeDeterminate("PZL-0006", { row_to_column: { "1": "hardcover book set" } }, { "1": "book_set" }, aliases)
  assert.equal(viaDispatchRow.aliasesApplied, 2)
  const viaDispatchSubset = gradeDeterminate("PZL-0014", { items: ["hardcover book set"] }, { item: ["book_set"] }, aliases)
  assert.equal(viaDispatchSubset.aliasesApplied, 2)
})

test("gradeSubset: single-key wrapped values unwrap before comparing", () => {
  assert.equal(gradeSubset(["Rice"], { item: { e: "Rice" } }).verdict, "MATCH")
})

test("gradeFlatRecord: paraphrase resolves through the alias table and is counted", () => {
  const aliases = { "hardcover book set": ["book_set"] }
  const result = gradeFlatRecord({ items: ["hardcover book set"] }, { item: ["book_set"] }, aliases)
  assert.equal(result.verdict, "MATCH")
  assert.equal(result.aliasesApplied, 2)
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
