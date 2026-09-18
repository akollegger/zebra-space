import lemmatize from "wink-lemmatizer"
import { sanitizeIdentifier } from "../compiler/compile.ts"
import type { Assignment, SolveResult } from "../solver/types.ts"

// ADR-007 §2.1/§2.2: pairing-aware grader with per-class verdicts. Pure functions over
// already-solved output — no LLM, no solver, no filesystem — so the whole module is
// unit-testable offline against fixtures.

/** ADR-007 §2.1: one outcome class per answer-key entry. Absent marker means determinate. */
export type OutcomeClass = "determinate" | "cop" | "ambiguous" | "subjective" | "non-problem"

export type DeterminateVerdict = "MATCH" | "MISMATCH"
export type CopVerdict = "OPTIMUM_ATTAINED" | "FEASIBLE_ONLY" | "INFEASIBLE"
export type AmbiguousVerdict = "READING_MATCHED" | "NO_MATCHING_READING"
export type SubjectiveVerdict = "PREMISE_FREE_MATCH" | "PREMISE_SILENTLY_PROMOTED"
export type NonProblemVerdict = "DECLINED_CORRECTLY" | "UNDECLINED"

export type GraderVerdict =
  | DeterminateVerdict
  | CopVerdict
  | AmbiguousVerdict
  | SubjectiveVerdict
  | NonProblemVerdict

/** Verdicts that count toward the pass rate; the rest are reported, not graded. */
export function isPassingVerdict(verdict: GraderVerdict): boolean {
  return (
    verdict === "MATCH" ||
    verdict === "OPTIMUM_ATTAINED" ||
    verdict === "READING_MATCHED" ||
    verdict === "PREMISE_FREE_MATCH" ||
    verdict === "DECLINED_CORRECTLY"
  )
}

/** Verdicts excluded from the pass-rate denominator (reported alongside, never silent). */
export function isExcludedVerdict(verdict: GraderVerdict): boolean {
  return verdict === "FEASIBLE_ONLY" || verdict === "UNDECLINED"
}

// --- Normalization (ADR-007 §2.2) ---------------------------------------------------

/** canonical -> variants, from eval/aliases.json. Exact lookup only, never fuzzy. */
export type AliasTable = Record<string, readonly string[]>

/**
 * Collects normalized tokens from a solved-assignment value, recursing through arrays and
 * unwrapping single-key records. Scalar domains solve wrapped one level deep ({e: value} —
 * seen live on PZL-0004), so the inner value must compare, not the wrapper. Returns how
 * many collected tokens resolved through the alias table, so callers report honest counts.
 */
function collectActualTokens(value: unknown, aliases: AliasTable, into: Set<string>): number {
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + collectActualTokens(item, aliases, into), 0)
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 1 && entries[0] !== undefined) {
      return collectActualTokens(entries[0][1], aliases, into)
    }
    return 0
  }
  const token = tokenOf(value)
  if (token === undefined) return 0
  const result = normalizeToken(token, aliases)
  into.add(result.normalized)
  return result.aliasApplied ? 1 : 0
}

/**
 * Case/separator-insensitive comparison key derived from a sanitized identifier. Bridges the
 * spelling conventions a model is free to choose when it authors a MiniZinc identifier directly
 * (PascalCase-merged, underscore-separated, ALL-CAPS, digit-prefixed, ...) rather than having
 * `compile.ts` derive it mechanically from an extracted string — found live 2026-09-16 in
 * `formalize-mzn` (17/42 `SOLVE_UNIQUE`+`MISMATCH` cases re-checked by hand, all 17 were the
 * puzzle's actual correct answer under a different spelling convention than the answer key's own
 * literal string). This is still an EXACT comparison, not fuzzy matching: it only folds different
 * renderings of the same sanitized identifier together, never merges two different values.
 *
 * Also folds plain pluralization (ADR-011 §2.1 — found live in SPIKE-015 §5.2: a domain-name
 * comparison rejected "moves" against "move" purely for this) via `wink-lemmatizer`'s dictionary/
 * rule-based noun lemmatizer, not a hand-rolled suffix strip. A first attempt using a bare
 * trailing-"s" regex (stripping one "s" when the stem was >=3 chars and not "ss") shipped and was
 * caught by code review before merge: it folded unrelated real words together whenever one was
 * "the other plus a trailing s" ("news"/"new", "lens"/"len" both collapsed to "new"/"len"), and
 * it missed the common "-es" sibilant plural entirely ("buses"/"bus" stayed distinct). Both are
 * exactly the failure modes a real lemmatizer (dictionary-aware, not suffix-blind) is built to
 * avoid — verified directly: `lemmatize.noun("news")` returns `"news"` (unchanged, no collision)
 * and `lemmatize.noun("buses")` returns `"bus"` (folds correctly). Still an approximation, not a
 * proof: a lemmatizer can occasionally fold a proper noun that merely looks pluralizable (e.g.
 * "Chesterfields" -> "chesterfield"), but that only matters if a puzzle's OWN vocabulary has a
 * competing singular value to collide with, which none observed so far does — not an assertion
 * taken on faith: `tests/eval/grader.test.ts`'s own "no two distinct values across the real
 * answer-key catalog collide" test scans every value in `eval/answer-keys.json` and fails loudly
 * if this ever stops being true, rather than silently producing a false MATCH at grading time.
 *
 * Lemmatizes PER UNDERSCORE-SEPARATED WORD, not the whole merged phrase — found live in code
 * review (second pass): SPIKE-015's actual motivating case is a QUALIFIER plus a PLURAL together
 * ("game moves" against a domain-name alias table entry whose variant is "game move"). Running
 * the lemmatizer on the whole merged compound ("gamemoves") never folds, since a lemmatizer only
 * accepts a stripped candidate that is itself a real dictionary word (`isNoun` in
 * `wink-lemmatizer`'s own source) and "gamemove"/"gamemoves" are not real words. Lemmatizing each
 * word before merging ("game"+"moves" -> "game"+"move" -> "gamemove") folds correctly and still
 * converges with the single-word cases above (no `_` to split on, one word, same result).
 */
function comparisonKey(sanitized: string): string {
  const words = sanitized.toLowerCase().split("_").filter((w) => w !== "")
  return words.map((w) => lemmatize.noun(w)).join("")
}

/**
 * Normalizes one token for comparison: integer passthrough, then the compiler's own
 * `sanitizeIdentifier` (imported, not duplicated), folded to a case/separator-insensitive
 * comparison key, then the alias table. Returns the normalized token plus whether an alias was
 * applied (logged, never silent).
 *
 * `aliasApplied` is only true when a listed VARIANT's own fold matched — never when the token's
 * fold already equals the canonical's own fold. Found live in code review: the original code
 * checked `key === comparisonKey(canonical)` too, so a token needing no alias at all (already
 * spelled identically to the canonical, or converging via the deterministic fold alone — case,
 * separator, or now pluralization) still reported `aliasApplied: true` whenever it happened to
 * match some canonical's OWN key, corrupting the "how many tokens needed the curated table"
 * audit count this flag exists to report. The pluralization fold widened this: any token whose
 * plural fold matches a canonical entry's name (regardless of that entry's actual variants list)
 * would false-positive. Checking only `variants` fixes this without changing `normalized` for any
 * existing case — if `key === comparisonKey(canonical)`, the fallthrough return already yields
 * the identical value via `key` itself.
 */
export function normalizeToken(token: string, aliases: AliasTable): { readonly normalized: string; readonly aliasApplied: boolean } {
  if (/^-?\d+$/.test(token)) return { normalized: token, aliasApplied: false }
  const key = comparisonKey(sanitizeIdentifier(token))
  for (const [canonical, variants] of Object.entries(aliases)) {
    if (variants.some((v) => comparisonKey(sanitizeIdentifier(v)) === key)) {
      return { normalized: comparisonKey(sanitizeIdentifier(canonical)), aliasApplied: true }
    }
  }
  return { normalized: key, aliasApplied: false }
}

function normalizeAll(tokens: readonly string[], aliases: AliasTable): { readonly normalized: readonly string[]; readonly aliasesApplied: number } {
  let aliasesApplied = 0
  const normalized = tokens.map((t) => {
    const result = normalizeToken(t, aliases)
    if (result.aliasApplied) aliasesApplied += 1
    return result.normalized
  })
  return { normalized, aliasesApplied }
}

// --- Solved-assignment access ---------------------------------------------------------

function tokenOf(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined
}

/** MiniZinc's own JSON output wraps an enum-typed scalar one level deep ({e: value} — see
 * `collectActualTokens`'s own comment, "seen live on PZL-0004"). Unwraps recursively, matching
 * `collectActualTokens`'s own recursive unwrap, rather than assuming exactly one level — a
 * different solved shape nesting deeper should still resolve, not silently stop at depth 1.
 * `tokenOf` itself does not unwrap, so any caller reading directly from a solved `Assignment`
 * (rather than through `collectActualTokens`) needs this first. */
function unwrapSingleKeyRecord(value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>)
    // entries[0] is statically string|undefined under noUncheckedIndexedAccess even though the
    // length check above guarantees it exists at runtime — the `!` reflects that gap, not a
    // skipped safety check.
    if (entries.length === 1) return unwrapSingleKeyRecord(entries[0]![1])
  }
  return value
}

// --- Parallel-array grading (ADR-007 §2.2) --------------------------------------------

/** Aligns each expected key to the unmatched actual key with the most vocabulary overlap. */
export function alignArraysByOverlap(
  expected: Record<string, readonly string[]>,
  actual: Record<string, readonly string[]>,
): { readonly alignment: Record<string, string> } | { readonly unalignable: string } {
  const actualKeys = Object.keys(actual)
  const used = new Set<string>()
  const alignment: Record<string, string> = {}
  for (const expectedKey of Object.keys(expected)) {
    const expectedTokens = new Set(expected[expectedKey])
    let bestKey: string | undefined
    let bestOverlap = -1
    let tied = false
    for (const actualKey of actualKeys) {
      if (used.has(actualKey)) continue
      const actualTokens = actual[actualKey] ?? []
      const overlap = actualTokens.filter((t) => expectedTokens.has(t)).length
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        bestKey = actualKey
        tied = false
      } else if (overlap === bestOverlap && overlap > 0) {
        tied = true
      }
    }
    if (bestKey === undefined || bestOverlap <= 0 || tied) {
      return { unalignable: `no unambiguous alignment for expected array "${expectedKey}"` }
    }
    used.add(bestKey)
    alignment[expectedKey] = bestKey
  }
  return { alignment }
}

function rowMultiset(arrays: Record<string, readonly string[]>): readonly string[] {
  const keys = Object.keys(arrays).sort()
  const first = arrays[keys[0] ?? ""]
  if (first === undefined) return []
  const rows: string[] = []
  for (let i = 0; i < first.length; i++) {
    rows.push(keys.map((k) => arrays[k]?.[i] ?? "").join("|"))
  }
  return rows.sort()
}

/**
 * Grades parallel-array answers: aligns by vocabulary overlap, then compares rows (positional
 * tuples across aligned arrays) as multisets. Order-invariant across entities, sensitive to
 * transposed pairings. Returns the verdict plus how many aliases were applied.
 */
export function gradeParallelArrays(
  expected: Record<string, readonly string[]>,
  actual: Record<string, readonly string[]>,
  aliases: AliasTable = {},
): { readonly verdict: DeterminateVerdict; readonly detail: string; readonly aliasesApplied: number } {
  const normalizedExpected: Record<string, readonly string[]> = {}
  let aliasesApplied = 0
  for (const [key, tokens] of Object.entries(expected)) {
    const result = normalizeAll(tokens, aliases)
    normalizedExpected[key] = result.normalized
    aliasesApplied += result.aliasesApplied
  }
  const normalizedActual: Record<string, readonly string[]> = {}
  for (const [key, tokens] of Object.entries(actual)) {
    const result = normalizeAll(tokens, aliases)
    normalizedActual[key] = result.normalized
    aliasesApplied += result.aliasesApplied
  }

  const aligned = alignArraysByOverlap(normalizedExpected, normalizedActual)
  if ("unalignable" in aligned) return { verdict: "MISMATCH", detail: aligned.unalignable, aliasesApplied }

  const expectedRows = rowMultiset(
    Object.fromEntries(Object.entries(normalizedExpected).map(([k]) => [k, normalizedExpected[k]!])),
  )
  const actualRows = rowMultiset(
    Object.fromEntries(
      Object.entries(normalizedExpected).map(([expectedKey]) => {
        const actualKey = aligned.alignment[expectedKey]!
        return [expectedKey, normalizedActual[actualKey]!]
      }),
    ),
  )
  if (expectedRows.length !== actualRows.length) {
    return { verdict: "MISMATCH", detail: `row count ${actualRows.length} != expected ${expectedRows.length}`, aliasesApplied }
  }
  for (let i = 0; i < expectedRows.length; i++) {
    if (expectedRows[i] !== actualRows[i]) {
      return { verdict: "MISMATCH", detail: `row mismatch: [${actualRows.join("; ")}] != [${expectedRows.join("; ")}]`, aliasesApplied }
    }
  }
  return { verdict: "MATCH", detail: "all rows match under overlap alignment", aliasesApplied }
}

// --- PZL-0006 row-keyed mapping (ADR-007 §2.2: explicit per-puzzle rule) ------------------

/**
 * Both sides reduce to row→column pair sets. The expected side reads `{row_to_column: {r: c}}`
 * directly. The actual side reads a numeric-keyed record directly, or a positional array under
 * the documented assumption that rows are numbered 1..n in index order. String row keys and
 * integer column values compare exactly after normalization.
 */
export function gradeRowKeyedMapping(
  expected: Record<string, string | number>,
  actual: Assignment,
  aliases: AliasTable = {},
): { readonly verdict: DeterminateVerdict; readonly detail: string; readonly aliasesApplied: number } {
  let aliasesApplied = 0
  const normalized = (token: string): string => {
    const result = normalizeToken(token, aliases)
    if (result.aliasApplied) aliasesApplied += 1
    return result.normalized
  }
  const done = (verdict: DeterminateVerdict, detail: string): { readonly verdict: DeterminateVerdict; readonly detail: string; readonly aliasesApplied: number } => ({
    verdict,
    detail,
    aliasesApplied,
  })
  const expectedPairs = new Map<string, string>()
  for (const [row, col] of Object.entries(expected)) {
    expectedPairs.set(normalized(String(row)), normalized(String(col)))
  }

  const actualPairs = new Map<string, string>()
  const actualKeys = Object.keys(actual)
  const numericKeyed = actualKeys.length > 0 && actualKeys.every((k) => /^\d+$/.test(k))
  if (numericKeyed) {
    for (const [row, col] of Object.entries(actual)) {
      const token = tokenOf(col)
      if (token === undefined) return done("MISMATCH", `non-scalar value at row ${row}`)
      actualPairs.set(normalized(row), normalized(token))
    }
  } else if (actualKeys.length === 1) {
    const sole = actual[actualKeys[0]!]!
    if (!Array.isArray(sole)) return done("MISMATCH", "expected a numeric-keyed record or a single positional array")
    sole.forEach((col, index) => {
      const token = tokenOf(col)
      if (token !== undefined) actualPairs.set(String(index + 1), normalized(token))
    })
  } else {
    return done("MISMATCH", "expected a numeric-keyed record or a single positional array")
  }

  if (expectedPairs.size !== actualPairs.size) {
    return done("MISMATCH", `pair count ${actualPairs.size} != expected ${expectedPairs.size}`)
  }
  for (const [row, col] of expectedPairs) {
    if (actualPairs.get(row) !== col) {
      return done("MISMATCH", `row ${row}: got ${actualPairs.get(row) ?? "∅"}, expected ${col}`)
    }
  }
  return done("MATCH", "all row→column pairs match")
}

// --- Subset shape (ADR-007 §2.2: PZL-0014) ----------------------------------------------

/**
 * Every expected item must appear among the actual assignment's values; extra actual values
 * are not a mismatch. Fixes the false MISMATCH of subset-vs-full-assignment comparison.
 */
export function gradeSubset(
  expectedItems: readonly string[],
  actual: Assignment,
  aliases: AliasTable = {},
): { readonly verdict: DeterminateVerdict; readonly detail: string; readonly aliasesApplied: number } {
  const actualTokens = new Set<string>()
  let aliasesApplied = 0
  for (const value of Object.values(actual)) aliasesApplied += collectActualTokens(value, aliases, actualTokens)
  const missing = expectedItems.filter((item) => {
    const result = normalizeToken(item, aliases)
    if (result.aliasApplied) aliasesApplied += 1
    return !actualTokens.has(result.normalized)
  })
  return missing.length === 0
    ? { verdict: "MATCH", detail: "all expected items present", aliasesApplied }
    : { verdict: "MISMATCH", detail: `missing items: ${missing.join(", ")}`, aliasesApplied }
}

// --- Determinate dispatch ---------------------------------------------------------------

/** Keys whose answers are parallel arrays graded by row-multiset comparison. */
/** Exported so callers preparing an `Assignment` for grading (e.g. `recoverEntityKeyedArrays`)
 * can skip transforms that only make sense for OTHER answer-key shapes — these puzzles' answer
 * keys are positional-by-declared-order, never entity-id-keyed, so an entity-keying transform
 * is actively counterproductive here, not just unnecessary (found live 2026-09-16). */
export const PARALLEL_ARRAY_PUZZLES = new Set(["PZL-0001", "PZL-0002", "PZL-0008", "PZL-0010"])

/**
 * Grades a determinate puzzle's solved assignment against its answer-key entry. Dispatches on
 * answer shape: parallel arrays, row-keyed mapping (PZL-0006 only), subset (single-key
 * `items`), else the status-quo token-subset check. Non-unique solve results never reach
 * here — the caller maps them to MISMATCH-detail first (only UniquelySolvable is comparable).
 */
export function gradeDeterminate(
  puzzleId: string,
  expected: unknown,
  assignment: Assignment,
  aliases: AliasTable = {},
): { readonly verdict: DeterminateVerdict; readonly detail: string; readonly aliasesApplied: number } {
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
    return { verdict: "MISMATCH", detail: "answer key is not a shaped object", aliasesApplied: 0 }
  }
  const expectedRecord = expected as Record<string, unknown>

  if (puzzleId === "PZL-0006" && expectedRecord.row_to_column !== undefined) {
    const mapping = expectedRecord.row_to_column
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
      return { verdict: "MISMATCH", detail: "row_to_column is not a mapping", aliasesApplied: 0 }
    }
    return gradeRowKeyedMapping(mapping as Record<string, string | number>, assignment, aliases)
  }

  const keys = Object.keys(expectedRecord)
  if (keys.length === 1 && keys[0] === "items" && Array.isArray(expectedRecord.items)) {
    const items: string[] = []
    for (const item of expectedRecord.items as unknown[]) {
      const token = tokenOf(item)
      if (token === undefined) {
        return { verdict: "MISMATCH", detail: "subset answer contains a non-scalar item", aliasesApplied: 0 }
      }
      items.push(token)
    }
    return gradeSubset(items, assignment, aliases)
  }

  if (PARALLEL_ARRAY_PUZZLES.has(puzzleId)) {
    const expectedArrays: Record<string, readonly string[]> = {}
    for (const [key, value] of Object.entries(expectedRecord)) {
      if (!Array.isArray(value)) return { verdict: "MISMATCH", detail: `expected array "${key}" is not an array`, aliasesApplied: 0 }
      const tokens: string[] = []
      for (const item of value) {
        const token = tokenOf(item)
        if (token === undefined) return { verdict: "MISMATCH", detail: `non-scalar in expected array "${key}"`, aliasesApplied: 0 }
        tokens.push(token)
      }
      expectedArrays[key] = tokens
    }
    const actualArrays: Record<string, readonly string[]> = {}
    for (const [key, value] of Object.entries(assignment)) {
      const arr = Array.isArray(value) ? value : undefined
      if (arr === undefined) continue
      const tokens: string[] = []
      let scalar = true
      for (const item of arr) {
        // Found live (2026-09-16): an enum-valued domain solves as {e: value} per array slot
        // (the same shape collectActualTokens already unwraps elsewhere in this file) — without
        // unwrapping here, every item fails tokenOf, the whole key is silently dropped from
        // actualArrays, and alignArraysByOverlap starves for anything to align against
        // ("no unambiguous alignment"). Confirmed this was misgrading real, correct
        // full-critic extractions as MISMATCH on PZL-0001/0002/0010's own historical runs.
        const token = tokenOf(unwrapSingleKeyRecord(item))
        if (token === undefined) {
          scalar = false
          break
        }
        tokens.push(token)
      }
      if (scalar) actualArrays[key] = tokens
    }
    return gradeParallelArrays(expectedArrays, actualArrays, aliases)
  }

  return gradeFlatRecord(expectedRecord, assignment, aliases)
}

/**
 * Status-quo token-subset check for flat-record answers (digit maps, single values,
 * compound `entity=value` tokens): every expected token must appear among the actual tokens.
 * Already pairing-aware for this shape via compound tokens.
 */
export function gradeFlatRecord(
  expected: Record<string, unknown>,
  actual: Assignment,
  aliases: AliasTable = {},
): { readonly verdict: DeterminateVerdict; readonly detail: string; readonly aliasesApplied: number } {
  const expectedTokens: string[] = []
  for (const value of Object.values(expected)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const token = tokenOf(item)
        if (token !== undefined) expectedTokens.push(token)
      }
    } else {
      const token = tokenOf(value)
      if (token !== undefined) expectedTokens.push(token)
    }
  }
  const actualTokens = new Set<string>()
  let aliasesApplied = 0
  for (const value of Object.values(actual)) aliasesApplied += collectActualTokens(value, aliases, actualTokens)
  const missing: string[] = []
  for (const token of expectedTokens) {
    const result = normalizeToken(token, aliases)
    if (result.aliasApplied) aliasesApplied += 1
    if (!actualTokens.has(result.normalized)) missing.push(token)
  }
  return missing.length === 0
    ? { verdict: "MATCH", detail: "all expected tokens present", aliasesApplied }
    : { verdict: "MISMATCH", detail: `missing tokens: ${missing.join(", ")}`, aliasesApplied }
}

// --- Per-class grading (ADR-007 §2.1) -----------------------------------------------------

export interface CopEntry {
  readonly optimumField: string
  readonly optimumValue: number
}

/** Per-puzzle optimum table (ADR-007 §2.1): field name and value per COP entry. */
export const COP_OPTIMA: Record<string, CopEntry> = {
  "PZL-0022": { optimumField: "total_value", optimumValue: 18 },
  "PZL-0023": { optimumField: "total_hours", optimumValue: 20 },
  "PZL-0024": { optimumField: "total_cost", optimumValue: 15 },
  "PZL-0025": { optimumField: "num_crates", optimumValue: 3 },
  "PZL-0026": { optimumField: "total_priority", optimumValue: 18 },
  "PZL-0027": { optimumField: "total_distance_miles", optimumValue: 80 },
}

function solvedNumber(assignment: Assignment, field: string): number | undefined {
  const raw = assignment[field]
  if (typeof raw === "number") return raw
  if (typeof raw === "string" && /^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  return undefined
}

/**
 * COP grading (ADR-007 §2.1): attains the recorded optimum value in any enumerated solution →
 * OPTIMUM_ATTAINED; solves successfully without it in capped output → FEASIBLE_ONLY (excluded
 * from the pass rate, never a silent pass or fail); the solve result is Unsatisfiable →
 * INFEASIBLE (a counted failure — an infeasible model is a wrong extraction, not a variant of
 * feasible-but-suboptimal). Arrangement is never compared.
 */
export function gradeCop(
  puzzleId: string,
  solveResult: SolveResult,
): { readonly verdict: CopVerdict; readonly detail: string } {
  const optimum = COP_OPTIMA[puzzleId]
  if (optimum === undefined) return { verdict: "FEASIBLE_ONLY", detail: `no recorded optimum for ${puzzleId}` }
  if (solveResult._tag === "Unsatisfiable") {
    return { verdict: "INFEASIBLE", detail: "no solution enumerated" }
  }
  const assignments: readonly Assignment[] =
    solveResult._tag === "UniquelySolvable" ? [solveResult.assignment] : solveResult.assignments
  for (const assignment of assignments) {
    if (solvedNumber(assignment, optimum.optimumField) === optimum.optimumValue) {
      return { verdict: "OPTIMUM_ATTAINED", detail: `${optimum.optimumField}=${optimum.optimumValue} attained` }
    }
  }
  return {
    verdict: "FEASIBLE_ONLY",
    detail: `optimum ${optimum.optimumField}=${optimum.optimumValue} not in capped output`,
  }
}

export interface AmbiguousReading {
  readonly result: string
  readonly answer?: unknown
  readonly solution_count?: number
}

/**
 * Ambiguous grading: the pipeline's outcome must equal some reading's result (answer
 * additionally compared when that reading records one). Otherwise NO_MATCHING_READING.
 */
export function gradeAmbiguous(
  readings: readonly AmbiguousReading[],
  solveResult: SolveResult,
  puzzleId: string,
  aliases: AliasTable = {},
): { readonly verdict: AmbiguousVerdict; readonly detail: string } {
  const outcomeName =
    solveResult._tag === "UniquelySolvable"
      ? "uniquely solvable"
      : solveResult._tag === "MultiplySatisfiable"
        ? "multiply satisfiable"
        : "unsatisfiable"
  for (const reading of readings) {
    if (reading.result !== outcomeName) continue
    if (solveResult._tag === "UniquelySolvable" && reading.answer !== undefined) {
      const graded = gradeDeterminate(puzzleId, reading.answer, solveResult.assignment, aliases)
      if (graded.verdict === "MATCH") {
        return { verdict: "READING_MATCHED", detail: `outcome and answer match a "${reading.result}" reading` }
      }
      continue
    }
    return { verdict: "READING_MATCHED", detail: `outcome matches a "${reading.result}" reading` }
  }
  return { verdict: "NO_MATCHING_READING", detail: `pipeline outcome "${outcomeName}" matches no reading` }
}

export interface SubjectiveEntry {
  readonly without_premise?: { readonly result?: string } | undefined
  readonly with_premise?: { readonly answer?: unknown } | undefined
}

/**
 * Subjective grading: the expectation is the premise-free class (MultiplySatisfiable for
 * every catalog entry in this class). PREMISE_SILENTLY_PROMOTED when uniquely solved with
 * an assignment matching the with_premise answer.
 */
export function gradeSubjective(
  entry: SubjectiveEntry,
  solveResult: SolveResult,
  puzzleId: string,
  aliases: AliasTable = {},
): { readonly verdict: SubjectiveVerdict; readonly detail: string } {
  if (solveResult._tag === "MultiplySatisfiable") {
    return { verdict: "PREMISE_FREE_MATCH", detail: "premise-free outcome (multiply satisfiable) as expected" }
  }
  if (solveResult._tag === "UniquelySolvable" && entry.with_premise?.answer !== undefined) {
    const graded = gradeDeterminate(puzzleId, entry.with_premise.answer, solveResult.assignment, aliases)
    if (graded.verdict === "MATCH") {
      return { verdict: "PREMISE_SILENTLY_PROMOTED", detail: "unique solution matches the premise-loaded answer — premise was silently promoted" }
    }
  }
  return { verdict: "PREMISE_SILENTLY_PROMOTED", detail: `unexpected outcome "${solveResult._tag}" for a subjective entry` }
}

/**
 * Non-problem grading: no decline path exists yet, so every run reports UNDECLINED with the
 * failing condition named — excluded from the pass rate, never a silent MATCH.
 */
export function gradeNonProblem(failingCondition: string | undefined): { readonly verdict: NonProblemVerdict; readonly detail: string } {
  return {
    verdict: "UNDECLINED",
    detail: failingCondition !== undefined ? `no decline path yet (failing condition: ${failingCondition})` : "no decline path yet",
  }
}
