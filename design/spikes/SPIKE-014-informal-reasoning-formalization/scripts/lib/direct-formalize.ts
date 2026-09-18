// SPIKE-014 §2 step 2 (7th/8th variants): `direct-mzn` and `direct-structured-prose` — a
// zero-shot control this spike hadn't run yet: skip Stage 1 (the free solve) ENTIRELY. Every
// prior variant (`formalize-json`, `formalize-mzn`, `+structured-prose`) is given the puzzle
// prose AND an already-completed Stage-1 trace to transcribe FROM. This isolates a question none
// of them answer: does having that completed trace actually help, or would formalizing straight
// from the puzzle prose — no prior free-solve step at all — do just as well (or badly)?
//
// `direct-mzn`: puzzle prose -> MiniZinc, one call, no trace. The model must both figure out the
// CSP the puzzle describes AND write valid MiniZinc in the same pass — closer to `formalize-mzn`
// than to `direct-solve`, since there's no separate "show your reasoning in prose first" step;
// unlike `formalize-mzn`, there's no already-worked solution to lean on, so if it needs the
// trace's derivation structure (the mechanism §5.9 diagnosed), this should show it directly.
//
// `direct-structured-prose`: puzzle prose -> a structured-prose restatement (Stage 2a's own job,
// but with NO Stage-1 trace to restate FROM — the model has to derive entities/domains/
// constraints straight from the puzzle, not transcribe a completed derivation), then Stage 2b
// (translateStructuredProseToMinizinc, reused unchanged) transcribes that into MiniZinc.
//
// Run against BOTH tiers already used in this spike (gpt-4o-mini, claude-sonnet-4.5) — not a
// third, weaker model; the point is comparing "given a trace" vs "not given a trace" at the SAME
// two capability levels this spike already measured, not testing a new capability floor.

import { Effect } from "effect"
import { requestProseCompletion } from "../../../../../src/eval/direct-solve.ts"
import { extractMzn, normalizeEscapedOperators } from "./formalize-mzn.ts"

function directMznSystemPrompt(): string {
  return [
    "You are given a logic puzzle. Read it carefully, work out the constraint-satisfaction",
    "problem it describes, and write it as a complete MiniZinc model. You are NOT asked to state",
    "the puzzle's answer in prose — write ONLY the MiniZinc model; the solver that runs it will",
    "determine the answer.",
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
    "  must be identifiers, not numeric literals, and that is a compile error. If a clue does",
    "  arithmetic or ordering on a value (\"at least N hours after\", \"N units apart\", \"before\",",
    "  \"more than\"), that attribute is a NUMBER, even if its values look like labels (`9am`).",
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

function directMznUserPrompt(prose: string): string {
  return `Puzzle:\n\n${prose}`
}

export interface DirectFormalizeMznResult {
  readonly mzn: string | undefined
  readonly costUsd: number | undefined
  readonly ok: boolean
  readonly error?: string
}

/** `direct-mzn`: puzzle prose -> MiniZinc, ONE call, no Stage-1 trace at all. */
export async function directFormalizeToMinizinc(model: string, prose: string): Promise<DirectFormalizeMznResult> {
  const attempt = await Effect.runPromise(
    requestProseCompletion({
      model,
      systemPrompt: directMznSystemPrompt(),
      userPrompt: directMznUserPrompt(prose),
    }).pipe(
      Effect.map((result): DirectFormalizeMznResult => ({ mzn: normalizeEscapedOperators(extractMzn(result.value)), costUsd: result.costUsd, ok: true })),
      Effect.catch((e) => Effect.succeed<DirectFormalizeMznResult>({ mzn: undefined, costUsd: e.costUsd, ok: false, error: e.message })),
    ),
  )
  return attempt
}

function directStructuredProseSystemPrompt(): string {
  return [
    "You are given a logic puzzle. Read it carefully and work out the constraint-satisfaction",
    "problem it describes. Your ONLY job is to state that problem as a COMPLETE, EXPLICIT",
    "specification, in plain English sentences — do not solve it, do not state the puzzle's",
    "final answer, just specify the problem completely and precisely.",
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
    "sentence — most importantly, ANY global uniqueness constraint the puzzle implies (e.g.",
    "\"each animal is in exactly one pen\", \"no two houses share a color\") even if the prose never",
    "states it in so many words. Do not merge two distinct constraints into one sentence. If two",
    "clues might restate the same constraint, say so explicitly rather than listing both",
    "independently as if unrelated. When a constraint chains more than one relation (e.g. \"X is",
    "somewhere before Y, which is somewhere before Z\"), state the chain as ONE sentence preserving",
    "the order it must hold in, rather than splitting it into separate sentences whose relative",
    "order has to be re-inferred later.",
    "",
    "Be exhaustive and explicit — this restatement is the ONLY input the next step will see; it",
    "will not have the original puzzle prose to fall back on, so anything you leave implicit here",
    "is lost.",
  ].join("\n")
}

function directStructuredProseUserPrompt(prose: string): string {
  return `Puzzle:\n\n${prose}`
}

export interface DirectStructuredProseResult {
  readonly structuredProse: string | undefined
  readonly costUsd: number | undefined
  readonly ok: boolean
  readonly error?: string
}

/** `direct-structured-prose` Stage 2a: puzzle prose -> structured-prose restatement, no Stage-1
 * trace to derive it from at all (unlike formalize-structured-prose.ts's formalizeToStructuredProse,
 * which transcribes an already-completed solve). Stage 2b reuses
 * translateStructuredProseToMinizinc from formalize-structured-prose.ts unchanged. */
export async function directFormalizeToStructuredProse(model: string, prose: string): Promise<DirectStructuredProseResult> {
  const attempt = await Effect.runPromise(
    requestProseCompletion({
      model,
      systemPrompt: directStructuredProseSystemPrompt(),
      userPrompt: directStructuredProseUserPrompt(prose),
    }).pipe(
      Effect.map((result): DirectStructuredProseResult => ({ structuredProse: result.value.trim(), costUsd: result.costUsd, ok: true })),
      Effect.catch((e) => Effect.succeed<DirectStructuredProseResult>({ structuredProse: undefined, costUsd: e.costUsd, ok: false, error: e.message })),
    ),
  )
  return attempt
}
