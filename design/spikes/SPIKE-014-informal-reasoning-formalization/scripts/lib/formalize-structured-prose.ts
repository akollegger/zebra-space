// SPIKE-014 §2 step 2 (6th variant): `formalize-mzn+structured-prose` — splits `formalize-mzn`'s
// single prose->MiniZinc call into two: Stage 2a restates the already-completed solve as an
// explicit, structured-but-still-natural-language draft (every entity, domain, and constraint
// named as its own sentence, nothing left implicit); Stage 2b transcribes THAT draft into
// MiniZinc, not the raw trace.
//
// Hypothesis (raised 2026-09-16, in response to "why is translation harder than solving, and
// could a more formal prose intermediate close the gap?"): §5.4's three semantic failure
// mechanisms (silently dropping a stated global constraint, incomplete relational coverage,
// self-contradiction across restated constraints) all look like the same thing — the model
// solves incrementally, applying constraints as it goes without ever being forced to declare a
// COMPLETE, closed set up front, then formalize-mzn asks it to produce that complete, syntactically
// exact set in the SAME pass it also has to get MiniZinc's grammar right in. Stage 2a is meant to
// force the completeness/explicitness work in a format with no compiler to reject it (fluent
// natural language, not unfamiliar DSL syntax) so Stage 2b's job shrinks to a closer-to-mechanical
// transcription.
//
// Known risk, named rather than assumed away: SPIKE-013 §5.8 (`post-hoc-shaped`) found that
// decomposing formalization — even with the solved trace as context — regressed vocabulary
// construction almost back to blind-guess numbers. That was per-clue tool-call decomposition;
// this is a two-stage single-call-each pipeline (closer to a compiler's parse->IR->codegen than
// per-clue decomposition), but the risk that splitting the task hurts rather than helps is real
// and this variant exists specifically to test it, not to assume the hypothesis is correct.

import { Effect } from "effect"
import { requestProseCompletion } from "../../../../../src/eval/direct-solve.ts"
import { extractMzn, normalizeEscapedOperators } from "./formalize-mzn.ts"

function structuredProseSystemPrompt(): string {
  return [
    "You are given a logic puzzle and a worked solution that already solved it — the solution",
    "may be fully correct, partially correct, or wrong; that does not matter here. Your ONLY job",
    "is to restate the constraint-satisfaction problem that solution already worked out as a",
    "COMPLETE, EXPLICIT specification, in plain English sentences. Do not re-solve the puzzle,",
    "second-guess the solution, or correct anything that looks wrong or incomplete.",
    "",
    "Write three labeled sections:",
    "",
    "ENTITIES: name every entity axis and every attribute category assigned to it. For example:",
    '- "Houses are arranged in a left-to-right row, numbered 1 through 5. Each house has exactly',
    'one Color, one Animal, and one Drink."',
    '- "There are five suspects: Ann, Ben, Cho, Dev, Eve. Each has exactly one Alibi and one',
    'Motive."',
    "",
    "DOMAINS: for every attribute category, give its complete set of possible values, using",
    "whichever of these four patterns actually fits — do not force a value into the wrong shape:",
    '- A fixed set of interchangeable names with no inherent order or arithmetic relationship:',
    '"Color: one of Red, Blue, Green — these are labels; none is \'more\' than another."',
    '- A position or count with a natural order, usually tied to the entity axis itself: "House',
    'position: an integer from 1 to 5, where 1 is leftmost."',
    '- A quantity that can be compared, added, or subtracted, even if it LOOKS like a label at',
    'first glance (clock times, ages, scores, amounts of money): "Departure time: a number of',
    'hours, one of 9, 11, 16 — these are NOT interchangeable names like colors; 16 is 5 more than',
    '11, and a clue like \'at least 2 hours apart\' is arithmetic on these numbers, not a naming',
    'distinction." Ask yourself: could a clue ever say one value is \'more than\', \'before\', or',
    '\'N units apart from\' another? If yes, it is this kind of quantity, never the interchangeable-',
    "names kind above, even if every value happens to have a conventional name (like \"9am\").",
    '- A single unstated scenario with one value per attribute, not an array of several entities:',
    '"There is one culprit, one weapon, one room — not a list of several suspects/weapons/rooms',
    'each getting an assignment."',
    "",
    "CONSTRAINTS: state EVERY constraint the puzzle prose asserts as its own standalone",
    "sentence, including ones the solution applied without commenting on it explicitly — most",
    "importantly, ANY global uniqueness constraint the puzzle implies (e.g. \"each animal is in",
    "exactly one pen\", \"no two houses share a color\") even if the worked solution never wrote it",
    "out in so many words. Do not merge two distinct constraints into one sentence, and do not",
    "silently drop a clue because the solution's own reasoning treated it as obvious. If two",
    "clues might restate the same constraint, say so explicitly rather than listing both",
    "independently as if unrelated. When a constraint chains more than one relation (e.g. \"X is",
    "somewhere before Y, which is somewhere before Z\"), state the chain as ONE sentence preserving",
    "the order it must hold in, rather than splitting it into separate sentences whose relative",
    "order has to be re-inferred later.",
    "",
    "Be exhaustive and explicit — this restatement is the ONLY input the next step will see; it",
    "will not have the original puzzle prose or the worked solution to fall back on, so anything",
    "you leave implicit here is lost.",
  ].join("\n")
}

function structuredProseUserPrompt(prose: string, trace: string): string {
  return `Puzzle:\n\n${prose}\n\nWorked solution:\n\n${trace}`
}

export interface FormalizeStructuredProseResult {
  readonly structuredProse: string | undefined
  readonly costUsd: number | undefined
  readonly ok: boolean
  readonly error?: string
}

/** Stage 2a: puzzle prose + completed solve trace -> an explicit, structured-prose restatement
 * of entities/domains/constraints. Plain prose completion, same mechanics as formalize-mzn.ts's
 * own Stage 2 call (and direct-solve.ts's Stage 1) — no forced tool call, no JSON Schema. */
export async function formalizeToStructuredProse(model: string, prose: string, trace: string): Promise<FormalizeStructuredProseResult> {
  const attempt = await Effect.runPromise(
    requestProseCompletion({
      model,
      systemPrompt: structuredProseSystemPrompt(),
      userPrompt: structuredProseUserPrompt(prose, trace),
    }).pipe(
      Effect.map((result): FormalizeStructuredProseResult => ({ structuredProse: result.value.trim(), costUsd: result.costUsd, ok: true })),
      Effect.catch((e) => Effect.succeed<FormalizeStructuredProseResult>({ structuredProse: undefined, costUsd: e.costUsd, ok: false, error: e.message })),
    ),
  )
  return attempt
}

/** Stage 2b: reuses formalize-mzn.ts's own MiniZinc-authoring rules verbatim (same syntax
 * pitfalls apply regardless of what feeds this call), but the ONLY input is Stage 2a's
 * structured-prose draft — no raw trace, no original puzzle prose — to test directly whether
 * that draft is complete enough to stand alone. */
function translateSystemPrompt(): string {
  return [
    "You are given a structured specification of a constraint-satisfaction problem — entities,",
    "domains, and constraints already enumerated explicitly. Your ONLY job is to TRANSCRIBE that",
    "specification as a complete MiniZinc model. Do not re-derive, re-solve, or second-guess the",
    "specification — every entity, domain, and constraint it states must appear in the model,",
    "and nothing should be added that it does not state.",
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
    "- If the specification describes ONE unstated scenario rather than several distinct",
    "  entities (e.g. a single culprit/weapon/location to determine), declare each attribute as",
    "  a single scalar `var SomeEnum`, not an array.",
    "- `enum` is ONLY for a closed set of NAMED categories. A quantity the specification labels",
    "  as a NUMBER — a time, a count, a score, an amount — must be a plain `int`/numeric domain",
    '  (e.g. `array[DRUG] of var {9, 11, 16}: drugTime;` or `var 0..23: hour;`), never `enum',
    '  TIME = { 9, 11, 16 };` — enum members must be identifiers, not numeric literals, and',
    "  that is a compile error. Do NOT rely only on how the DOMAINS section happens to phrase a",
    "  value's name to decide this — CHECK THE CONSTRAINTS SECTION TOO: if any constraint does",
    '  arithmetic or ordering on an attribute\'s values ("at least N hours after", "N units apart",',
    '  "before", "more than", a sum or difference), that attribute is a NUMBER, full stop, even if',
    "  the domain list wrote its values as clock-like strings (`9am`) or the specification never",
    "  used the word \"number\" at all. A closed set of values with NO such arithmetic/ordering",
    "  constraint anywhere in the specification is the only case where `enum` is correct.",
    "- State every constraint the specification lists as one or more `constraint` statements in",
    "  plain MiniZinc syntax, using `alldifferent`/`forall`/arithmetic/comparison operators as",
    "  needed.",
    "- Write the logical-and/or operators EXACTLY as `/\\` and `\\/` (each is ONE backslash) —",
    "  do NOT double them (`/\\\\`, `\\\\/`) as if escaping a string literal; this is raw source",
    "  text, not a quoted string, and a doubled backslash is a syntax error.",
    "- Each `exists(i in ...)(...)` or `forall(i in ...)(...)` is its OWN closed expression — a",
    "  generator variable (e.g. `i`) is only in scope INSIDE that same pair of parentheses. If a",
    "  constraint needs one quantified variable to constrain a SECOND search, nest the second",
    "  exists/forall INSIDE the first's body (so `j` in `exists(i in ...)(exists(j in",
    "  (i+1)..N)(...))` can reference `i`) — never write two side-by-side `exists(...)` calls",
    "  joined by `->` or another operator and expect a generator variable from the first to be",
    "  visible in the second; it will not be, and referencing it there is an undefined-identifier",
    "  compile error.",
    "- Do NOT include an `output` item — every declared decision variable is emitted",
    "  automatically as JSON by the solver that runs this model, and an explicit output item",
    "  would only get in the way of that.",
    "- Every variable and enum-member name MUST be a distinct, valid MiniZinc identifier —",
    "  MiniZinc's identifier and enum-member namespaces are GLOBAL, so two different things",
    "  must never share a name.",
    "- Output ONLY the MiniZinc source — no prose commentary before or after it.",
  ].join("\n")
}

function translateUserPrompt(structuredProse: string): string {
  return `Specification:\n\n${structuredProse}`
}

export interface TranslateToMinizincResult {
  readonly mzn: string | undefined
  readonly costUsd: number | undefined
  readonly ok: boolean
  readonly error?: string
}

/** Stage 2b: structured-prose draft -> MiniZinc source text. Same post-processing
 * (extractMzn, normalizeEscapedOperators) as formalize-mzn.ts's single-call version. */
export async function translateStructuredProseToMinizinc(model: string, structuredProse: string): Promise<TranslateToMinizincResult> {
  const attempt = await Effect.runPromise(
    requestProseCompletion({
      model,
      systemPrompt: translateSystemPrompt(),
      userPrompt: translateUserPrompt(structuredProse),
    }).pipe(
      Effect.map((result): TranslateToMinizincResult => ({ mzn: normalizeEscapedOperators(extractMzn(result.value)), costUsd: result.costUsd, ok: true })),
      Effect.catch((e) => Effect.succeed<TranslateToMinizincResult>({ mzn: undefined, costUsd: e.costUsd, ok: false, error: e.message })),
    ),
  )
  return attempt
}
