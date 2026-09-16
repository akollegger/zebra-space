// SPIKE-014 §2 step 2 (2nd representation variant): `formalize-mzn` — same Stage 2 job as
// formalize-json.ts (given puzzle prose + an already-completed direct-solve trace, formalize
// the CSP that trace already worked out), but straight into MiniZinc source TEXT instead of
// ExtractedCsp JSON. Reuses direct-solve.ts's own `requestProseCompletion` unchanged (a plain
// prose completion, no forced tool call, no JSON Schema at all — MiniZinc is plain text) since
// this is the same mechanics `direct-solve`'s own Stage 1 already uses.
//
// This is this spike's own answer to RFC-003 §7.1 ("is the intermediate representation close
// enough to a MiniZinc AST to serialize directly?") — no JSON Schema to violate at all, unlike
// formalize-json's 69KB/134-anyOf-union ExtractedCsp schema (SPIKE-014 §5.1's dominant failure
// class). MiniZinc's own compiler still catches an identifier collision natively (the same class
// compile.ts's detectIdentifierCollision exists to make actionable) — this variant tests whether
// that structural difference alone moves the MATCH rate, or whether formalize-mzn just trades one
// failure surface for another.
//
// Deliberately NOT run through compile.ts/ExtractedCsp at all — solve() takes a raw MiniZinc
// string with no dependency on either (confirmed before scoping this variant in, see SPIKE.md
// §1's "second, genuinely open sub-question"), so this is a fully independent path, not a
// shortcut that skips verification.

import { Effect } from "effect"
import { requestProseCompletion } from "../../../../../src/eval/direct-solve.ts"

function systemPrompt(): string {
  return [
    "You are given a logic puzzle and a worked solution that already solved it — the solution",
    "may be fully correct, partially correct, or wrong; that does not matter here. Your ONLY job",
    "is to FORMALIZE the constraint-satisfaction problem that solution already worked out as a",
    "complete MiniZinc model. TRANSCRIBE the structure the solution already committed to — do",
    "not re-solve the puzzle, second-guess the solution, or correct anything that looks wrong or",
    "incomplete.",
    "",
    "Write idiomatic MiniZinc:",
    '- Start with `include "globals.mzn";` whenever you use any global constraint (`alldifferent`,',
    "  `all_different`, `alldifferent_except_0`, etc.) — these are UNDEFINED without that",
    "  include, which is a compile error, not a warning.",
    "- Declare a fixed integer range (e.g. `1..3`) for an entity axis with no other natural",
    "  identity (houses, positions, days) — represent each attribute category over that axis as",
    "  `array[1..N] of var SomeEnum: variableName;`. Declare an `enum` for every closed set of",
    "  named values (colors, animals, suspects, ...) — never `var int` for something that is",
    "  actually one of a fixed, named set.",
    "- If the puzzle narrows down ONE unstated scenario rather than several distinct entities",
    '  (e.g. "there has been a murder — who did it, with what, where?"), declare each attribute',
    "  as a single scalar `var SomeEnum`, not an array.",
    "- `enum` is ONLY for a closed set of NAMED categories (colors, animals, suspects, days of",
    "  the week spelled out, ...). A quantity that is actually a NUMBER — a time, a count, a",
    "  score, an amount — must be a plain `int`/numeric domain (e.g. `array[DRUG] of var {9, 11,",
    '  16}: drugTime;` or `var 0..23: hour;`), never `enum TIME = { 9, 11, 16 };` — enum members',
    "  must be identifiers, not numeric literals, and that is a compile error.",
    "- State every clue as one or more `constraint` statements in plain MiniZinc syntax, using",
    "  `alldifferent`/`forall`/arithmetic/comparison operators as needed.",
    "- Write the logical-and/or operators EXACTLY as `/\\` and `\\/` (each is ONE backslash) —",
    "  do NOT double them (`/\\\\`, `\\\\/`) as if escaping a string literal; this is raw source",
    "  text, not a quoted string, and a doubled backslash is a syntax error.",
    "- Each `exists(i in ...)(...)` or `forall(i in ...)(...)` is its OWN closed expression — a",
    "  generator variable (e.g. `i`) is only in scope INSIDE that same pair of parentheses. If a",
    '  clue needs one quantified variable to constrain a SECOND search ("the entity with attr1=x',
    'is somewhere before the entity with attr2=y"), nest the second exists/forall INSIDE the',
    "  first's body (so `j` in `exists(i in ...)(exists(j in (i+1)..N)(...))` can reference `i`) —",
    "  never write two side-by-side `exists(...)` calls joined by `->` or another operator and",
    "  expect a generator variable from the first to be visible in the second; it will not be,",
    "  and referencing it there is an undefined-identifier compile error.",
    "- Do NOT include an `output` item — every declared decision variable is emitted",
    "  automatically as JSON by the solver that runs this model, and an explicit output item",
    "  would only get in the way of that.",
    "- Every variable and enum-member name MUST be a distinct, valid MiniZinc identifier —",
    "  MiniZinc's identifier and enum-member namespaces are GLOBAL, so two different things",
    "  (e.g. an entity id and a domain value, or the same name reused across two different",
    "  entity types) must never share a name.",
    "- Output ONLY the MiniZinc source — no prose commentary before or after it.",
  ].join("\n")
}

function userPrompt(prose: string, trace: string): string {
  return `Puzzle:\n\n${prose}\n\nWorked solution:\n\n${trace}`
}

/** The model tends to wrap code in a fenced block even when told not to add commentary — strip
 * it if present, otherwise use the response as-is (trimmed). Exported for mzn-oracle-repair.ts,
 * which needs the identical post-processing on its own completion. */
export function extractMzn(raw: string): string {
  const fenced = raw.match(/```(?:minizinc|mzn)?\n([\s\S]*?)```/)
  return (fenced?.[1] ?? raw).trim()
}

/** Found live 2026-09-16 (PZL-0010): the model sometimes doubles the and/or operators' single
 * backslash (`/\\`, `\\/`) as if escaping them for a quoted string, which is never valid
 * MiniZinc either way this run — a purely mechanical, always-safe normalization, kept alongside
 * (not instead of) the prompt instruction against it, since a deterministic fix costs nothing
 * and a prompt instruction alone is not guaranteed to hold on every sample. Exported for
 * mzn-oracle-repair.ts, which needs the identical post-processing on its own completion. */
export function normalizeEscapedOperators(mzn: string): string {
  return mzn.replace(/\/\\{2,}/g, "/\\").replace(/\\{2,}\//g, "\\/")
}

export interface FormalizeMznResult {
  readonly mzn: string | undefined
  readonly costUsd: number | undefined
  readonly ok: boolean
  readonly error?: string
}

/** One call: given the puzzle prose and an ALREADY-COMPLETED solve trace, formalize the whole
 * CSP as MiniZinc source text. Mirrors formalize-json.ts's Effect.catch-before-runPromise
 * pattern (SPIKE-012 oracle-repair.ts's own convention). */
export async function formalizeToMinizinc(model: string, prose: string, trace: string): Promise<FormalizeMznResult> {
  const attempt = await Effect.runPromise(
    requestProseCompletion({
      model,
      systemPrompt: systemPrompt(),
      userPrompt: userPrompt(prose, trace),
    }).pipe(
      Effect.map((result): FormalizeMznResult => ({ mzn: normalizeEscapedOperators(extractMzn(result.value)), costUsd: result.costUsd, ok: true })),
      Effect.catch((e) => Effect.succeed<FormalizeMznResult>({ mzn: undefined, costUsd: e.costUsd, ok: false, error: e.message })),
    ),
  )
  return attempt
}
