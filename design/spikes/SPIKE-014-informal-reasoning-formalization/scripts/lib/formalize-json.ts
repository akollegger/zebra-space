// SPIKE-014 §2 step 2: the `formalize-json` variant — given a puzzle's prose AND an already-
// completed direct-solve trace (Stage 1, read from disk, never re-solved here), formalize the
// FULL ExtractedCsp (entities, domains, AND constraints) that solve already worked out. This is
// a transcription task, analogous to SPIKE-013's `post-hoc-vocabulary.ts` (which stopped at
// entities/domains) — here extended to cover constraints too, using the REAL production schema
// (`extractedCspJsonSchema`/`ExtractedCsp`) and the REAL structured-completion call
// (`requestStructuredCompletion`), not a spike-local approximation, since a full Effect Schema
// decode is the only reliable way to validate this schema's actual depth (69KB, 134 anyOf
// unions, nesting depth 39 per SPIKE-013's own citation) — SPIKE-008's shallower
// `checkStructural` was never meant to validate something this deep.
//
// The system prompt's constraint-kind guidance is duplicated in spirit from
// src/extraction/extract.ts's own (unexported) `extractionSystemPrompt` — same convention
// SPIKE-008/SPIKE-013 already established for reusing an unexported production prompt: copy the
// domain knowledge, add the "transcribe an already-completed solve" framing on top, and accept
// the manual-sync cost if that source prompt changes later.

import { Effect } from "effect"
import { requestStructuredCompletion } from "../../../../../src/extraction/provider.ts"
import { ExtractedCsp, extractedCspJsonSchema, type ProviderError, type SchemaRejected, type SchemaViolation } from "../../../../../src/extraction/types.ts"

function systemPrompt(): string {
  return (
    "You are given a logic puzzle and a worked solution that already solved it — the solution " +
    "may be fully correct, partially correct, or wrong; that does not matter here. Your ONLY " +
    "job is to FORMALIZE the constraint-satisfaction problem that solution already worked out " +
    "into entities, decision-variable domains, and constraints. TRANSCRIBE the structure the " +
    "solution already committed to — do not re-solve the puzzle, second-guess the solution, or " +
    "correct anything that looks wrong or incomplete. Represent every clue exactly as the " +
    "solution used it; invent nothing beyond what the prose or the solution implies.\n\n" +
    "The examples below use placeholder names (X/Y for entities, attr1/attr2 for variables, " +
    "val1/val2 for values, N for a number) to illustrate SCHEMA STRUCTURE, not puzzle content " +
    "— map them onto whatever the actual puzzle's entities, attributes, and values are.\n\n" +
    "Three easily-confused clue shapes need different constraint kinds — pick by what the " +
    "clue actually asserts, not by superficial similarity:\n" +
    '- Exclusion/negation ("X is not val1", "not val2"): use `arithmetic` with comparator ' +
    '"!=" against the excluded value. This is NOT `linkedAttributes` — the clue rules one ' +
    "value out, it does not link two values together.\n" +
    '- Attribute co-occurrence with NO entity ever named ("some entity has attr1=val1 and ' +
    'attr2=val2 at the same time"): use `linkedAttributes` — it links two-or-more attribute ' +
    "values on some unspecified entity. Do not use this for exclusion/negation clues, and do " +
    "not use it to represent an entity ruling out a value.\n" +
    '- A specific, already-known entity ("the first one", or one named directly): use ' +
    "`assignment`.\n\n" +
    "A clue comparing two computed quantities, or one entity's value against another's " +
    '("the total of these three equals the total of those three", "X\'s attr1 is at least N ' +
    'units more than Y\'s", "X\'s attr1 differs from Y\'s"): use `arithmetic` with a ' +
    "structured `target` (an `ArithmeticExpression`, not just a plain value). Never invent a " +
    'compound variable name like "X.attr1" or "attr1(Y)" to smuggle an entity reference into ' +
    "a plain string — `variableRef` has its own `variable` (the domain name) and `entity` " +
    "(null for a scalar domain, or the specific entity id) fields for exactly this.\n\n" +
    "`arithmetic`'s `comparator` field (e.g. \"=\", \"!=\", \">=\") is ALWAYS separate from " +
    "`expression`'s `op` — `op` is only ever one of the arithmetic operators " +
    '(+ - * / min max abs), never a comparator. For "X\'s attr1 is at least N units more than ' +
    'Y\'s attr1": `expression` is `{kind: "binaryOp", op: "-", operands: [attr1@X, attr1@Y]}`, ' +
    '`comparator` is ">=", `target` is `{kind: "literal", value: N}` — do NOT put ">=" inside ' +
    "`expression.op`. For a symmetric \"at least N units apart\" clue, wrap the difference in " +
    '`abs`: `expression` is `{kind: "binaryOp", op: "abs", operands: [{kind: "binaryOp", op: ' +
    '"-", operands: [a, b]}]}`, with the threshold still in the top-level `comparator`/' +
    "`target`.\n\n" +
    'Nesting depth is bounded — for "at least N units away from EACH of several fixed ' +
    'references" (e.g. "away from any of these two reference points"), do NOT wrap multiple ' +
    'distances in one combined `min`/`max` expression; that nests one level deeper than this ' +
    "schema allows. Instead emit ONE separate `arithmetic` constraint per reference (`abs(X - " +
    'ref1) >= N`, `abs(X - ref2) >= N`, ...) — every top-level constraint is implicitly ANDed, ' +
    "so this is logically identical and keeps each expression shallow.\n\n" +
    'For a positional/ordering clue between two entities ("X is immediately right of Y", "X is ' +
    'next to Y"): use `adjacency`. Set its `variable` field to name the domain the ordering is ' +
    "over whenever that domain's values are not plain integers (e.g. time slots like " +
    "\"9am\"/\"10am\", ordered by the sequence you declared them in) — leave `variable` null " +
    "ONLY when the two entities share exactly one domain whose values are already plain " +
    "integers. Guessing wrong here (naming a categorical, non-ordered domain like color, or " +
    "leaving `variable` null when it's needed) is not just a compile error — it can silently " +
    "produce a wrong solution, so if you're unsure which shared domain is the ordered one, " +
    "name it explicitly.\n\n" +
    "A derivedRule's two condition shapes each have their OWN entity-placeholder tokens in " +
    "thenConstraints, always used the SAME way — as the `entity` field of a `variableRef` (or " +
    "`assignment`), never as a bare, freestanding string value — don't mix the two token " +
    "families up:\n" +
    '- `condition: {kind: "relation", name: ...}` (fact-driven — paired with separate ' +
    '`relation` facts elsewhere, e.g. "X relates to Y via someRelation"): thenConstraints ' +
    'reference the matched fact\'s two entities via `variableRef.entity: "$a"` / `"$b"` — on ' +
    "EITHER side (`expression` or `target`), whichever the clue means. Never use " +
    "\"$this\"/\"$outer\" here.\n" +
    '- `condition: {kind: "comparison", variable, operator, value}` (variable-conditioned, ' +
    'evaluated per entity — see below): use `variableRef.entity: "$this"` / `"$outer"` ' +
    'instead. Never use `"$a"`/`"$b"` here.\n\n' +
    'A derivedRule\'s condition is evaluated per entity ("if THIS entity\'s attr1 is val1, ' +
    'then..."), e.g. "whichever entity has attr1=val1 also has attr2=val2" or "if an entity\'s ' +
    'attr1 is val1, its attr3 is one more than the entity whose attr1 is val2". Inside that ' +
    'derivedRule\'s `thenConstraints`, use the literal entity id `"$this"` for ' +
    '`variableRef.entity` (or `assignment.entity`) wherever you mean "the entity currently ' +
    'satisfying this rule\'s condition" — never invent another placeholder name or the ' +
    'entity\'s attribute value itself (e.g. not `entity: "val1"`). Reference a different, ' +
    "already-named entity by its real id as usual.\n\n" +
    'When a clue relates TWO entities that are BOTH unnamed, each identified only by its own ' +
    'attribute ("whichever entity has attr1=val1 is adjacent to whichever entity has ' +
    'attr2=val2" — neither entity is ever named directly), nest a second derivedRule inside ' +
    "the first one's `thenConstraints`: the outer derivedRule's condition picks out the " +
    'first entity ("attr1 == val1"), the inner nested derivedRule\'s condition picks out the ' +
    'second ("attr2 == val2"). Inside the INNER rule\'s own `thenConstraints`, use `"$this"` ' +
    'for the inner entity (the one satisfying the inner condition) and `"$outer"` for the ' +
    'outer entity (the one satisfying the outer condition) — never reuse `"$this"` for ' +
    "both.\n\n" +
    'When that relation is DIRECTIONAL rather than symmetric ("whichever entity has attr1=val1 ' +
    'is immediately AFTER whichever entity has attr2=val2" — not just "adjacent to"), the ' +
    "arithmetic's operand order must match the prose's stated direction exactly, not just its " +
    'entities: nest val1 as the outer condition and val2 as the inner (as above), then "val1 ' +
    'is immediately after val2" becomes `position[$outer] - position[$this] == 1` — $outer ' +
    "(val1, the entity stated to come after) MINUS $this (val2, the entity it comes after), " +
    'never the reverse. Getting this backwards ($this - $outer instead) is NOT a compile error ' +
    "— it silently produces the mirror-image (wrong) solution instead of the correct one, so " +
    "double-check which side of the subtraction is which before finishing.\n\n" +
    'Some puzzles depend on a small, closed, static rule between VALUES rather than between ' +
    'specific entities ("val1 beats val2, val2 beats val3, val3 beats val1" — a fixed fact ' +
    "about the values themselves, true no matter which entity holds them; contrast with " +
    '`relation`, which is a fact about specific entities like "X relates to Y via ' +
    'someRelation"). Represent each such fact as one `ruleTable` entry — `{kind: ' +
    '"ruleTable", name, a, b}`, e.g. `{name: "beats", a: "val1", b: "val2"}` — with every ' +
    'entry for the same table sharing `name`. Then use exactly one `ruleTableConstraint` — ' +
    '`{kind: "ruleTableConstraint", table, a, b}`, where `a`/`b` are each either `{kind: ' +
    '"variableRef", variable, entity}` or `{kind: "literal", value}` — to require the ACTUAL ' +
    'values satisfy the table, e.g. "X\'s attr1 must beat the known constant val2" becomes ' +
    '`{table: "beats", a: {kind: "variableRef", variable: "attr1", entity: "X"}, b: {kind: ' +
    '"literal", value: "val2"}}`. Never use `derivedRule`\'s fact-driven mode for this — that ' +
    "expands per matching ENTITY pair, not per value.\n\n" +
    "A derivedRule's condition normally tests a single plain declared variable directly " +
    '(`condition.kind: "comparison"`) — but some clues condition on a COMPUTED quantity ' +
    'instead ("if the ratio of two declared quantities exceeds N%", "if the lower of two ' +
    'declared quantities is below N"). For these, use `condition.kind: ' +
    '"expressionComparison"` — `{kind: "expressionComparison", expression, operator, value}`, ' +
    "where `expression` is a full `ArithmeticExpression` (the same structured shape " +
    '`arithmetic` constraints use, e.g. `{kind: "binaryOp", op: "/", operands: [attr1, ' +
    'attr2]}` for a ratio, or `{kind: "binaryOp", op: "min", operands: [attr1@X, attr1@Y]}` ' +
    'for "the lower of two values") — never `"comparison"`, whose `variable` field can only ' +
    "name a single plain declared variable, not a computed one.\n\n" +
    'A derivedRule normally has ONE condition — but some clues combine multiple independent ' +
    'checks with "and" ("if not denied by the earlier rules AND the amount is within policy ' +
    'limits, Approved"). For these, use `condition.kind: "and"` — `{kind: "and", conditions: ' +
    '[...]}`, where each entry in `conditions` is itself a `"comparison"` or ' +
    '`"expressionComparison"` (never `"relation"`, and never another `"and"` — no nesting). Do ' +
    "NOT try to express this as nested `derivedRule`s (that changes which entity a rule applies " +
    'to, it does not combine two conditions into one gate) or as a single condition with an ' +
    '"AND"-like operator string — there is no such operator; `"and"` is its own `condition.kind`.'
  )
}

function userPrompt(prose: string, trace: string): string {
  return `Puzzle:\n\n${prose}\n\nWorked solution:\n\n${trace}`
}

export interface FormalizeJsonResult {
  readonly extractedCsp: ExtractedCsp | undefined
  readonly costUsd: number | undefined
  readonly ok: boolean
  readonly error?: string
}

function errorDetail(e: ProviderError | SchemaRejected | SchemaViolation): string {
  switch (e._tag) {
    case "ProviderError":
      return e.message
    case "SchemaRejected":
      return e.providerMessage
    case "SchemaViolation":
      return e.detail
  }
}

/** One call: given the puzzle prose and an ALREADY-COMPLETED solve trace, formalize the whole
 * ExtractedCsp that trace implies. Mirrors SPIKE-012's oracle-repair.ts `compileSafely`/
 * `solveSafely` pattern — convert the Effect's failure channel to a success channel with
 * `Effect.catch` before `Effect.runPromise`, rather than relying on Promise-rejection shape. */
export async function formalizeToExtractedCsp(model: string, prose: string, trace: string): Promise<FormalizeJsonResult> {
  const attempt = await Effect.runPromise(
    requestStructuredCompletion({
      model,
      systemPrompt: systemPrompt(),
      userPrompt: userPrompt(prose, trace),
      schemaName: "ExtractedCsp",
      jsonSchema: extractedCspJsonSchema,
      schema: ExtractedCsp,
    }).pipe(
      Effect.map((result): FormalizeJsonResult => ({ extractedCsp: result.value, costUsd: result.costUsd, ok: true })),
      Effect.catch((e) =>
        Effect.succeed<FormalizeJsonResult>({ extractedCsp: undefined, costUsd: e.costUsd, ok: false, error: `${e._tag}: ${errorDetail(e)}` }),
      ),
    ),
  )
  return attempt
}
