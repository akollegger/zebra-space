---
id: ADR-005
title: ExtractedCsp to MiniZinc Compiler
status: proposed
rfcs: [RFC-002, RFC-003]
created: 2026-08-18
specs:
  - specs/004-nl-csp-extraction
---

# ADR-005: ExtractedCsp to MiniZinc Compiler

## 1. Context

`ExtractedCsp` is the solver-agnostic intermediate representation extraction produces (introduced
in [ADR-004](ADR-004-llm-extraction-critic-loop.md) §2.2). ADR-004's own critic loop (§2.4)
validates an extraction's *fidelity* to the source prose directly — a second LLM call, not a
solver round-trip — so it has no dependency on this ADR. Compiling `ExtractedCsp` to MiniZinc
remains a needed, independent capability regardless: it's what actually lets a validated
extraction be rendered as a solvable model at all — [ADR-003](ADR-003-cli-interface.md) §2.6's
`extract` CLI compiles by default before printing, and the same compiled output can be piped to
`solve`. This ADR designs that compiler, from
[ADR-004](ADR-004-llm-extraction-critic-loop.md) §2.2's `ExtractedCsp` representation to the
MiniZinc target [ADR-002](ADR-002-adopt-minizinc-solver.md) §2.5 already committed to (decision
variables as `array of var`, one per domain/attribute-category; constraints built from
`alldifferent`, comparison/arithmetic operators, and `if-then-else`) — directly completing RFC-003
Goal 3's MiniZinc half ("output that is a plausible input to... a MiniZinc model").

This is shared infrastructure, not scoped to one RFC: it produces the actual input
`src/solver/solve.ts` consumes (RFC-002's concern) and it's the missing link that makes RFC-003's
extraction pipeline solvable end-to-end (RFC-003's concern) — hence both as parent RFCs, per this
project's many-to-many convention (already used by [ADR-003](ADR-003-cli-interface.md)).

**Relationship to RFC-002's Non-Goal 2 and [ADR-002](ADR-002-adopt-minizinc-solver.md)'s deferred
compiler**: RFC-002 Non-Goal 2 and ADR-002 §2.6 both anticipated a *graph*-to-`.mzn` compiler
(translating a future `@relateby/pattern` graph representation) as the eventual follow-up — not
this one. That graph representation remains undesigned (RFC-003 Non-Goal, ADR-004 §1/§4). This
ADR instead compiles `ExtractedCsp` — the JSON structure ADR-004 introduced as an intermediate
representation, deliberately designed to also be graph-compatible later (ADR-004 §2.2:
"entities/constraints as candidate nodes/edges"). The graph-to-`.mzn` compiler RFC-002/ADR-002
originally anticipated is still a separate, still-undesigned decision — this ADR does not resolve
it, though a future graph representation built *from* `ExtractedCsp` could plausibly reuse much
of this compiler's constraint-translation logic rather than duplicating it.

`catalog/mzn/` ([ADR-002](ADR-002-adopt-minizinc-solver.md) §2.6) — hand-written MiniZinc
examples originally seeded "for whoever eventually builds the graph-to-`.mzn` compiler" — serves
this compiler equally well as a reference/validation corpus, despite predating this specific
decision.

## 2. Decision

### 2.1 Output shape: one self-contained `.mzn` string per puzzle

The compiler takes one `ExtractedCsp` value and produces one complete `.mzn` model string —
variable declarations and constraints together, no separate `.dzn` data file. `ExtractedCsp` is
inherently puzzle-specific (each puzzle has its own entities/domains/constraints), so there's no
shared model template with varying data the way a classic `.mzn`/`.dzn` split usually serves —
this also matches `catalog/mzn/`'s existing convention of one self-contained `.mzn` file per
puzzle. The resulting string is passed to the existing `src/solver/solve.ts` Effect via
`SolveRequest.model` — no changes to the solver integration itself.

### 2.2 Variable declarations from `domains`

Each `ExtractedCsp.domains` entry becomes one MiniZinc `array of var` declaration, indexed by
that domain's `entityType` and constrained to an `enum` built from its `values` — directly
satisfying [ADR-002](ADR-002-adopt-minizinc-solver.md) §2.5's "one array per domain/attribute-
category, sized to the puzzle's entity count." `entities` supplies the enum members per type.

### 2.3 Constraint translation, per `ExtractedConstraint` kind

- **`assignment`** → an equality constraint on the relevant domain array: the entity's index
  equals the stated value.
- **`allDifferent`** → MiniZinc's `alldifferent` global constraint over the named variable's
  array — a direct match, no translation logic beyond the name.
- **`adjacency`** → requires the target domain to be ordered/numeric (position, time slot). Each
  named relation (`"immediately right of"`, `"next to"`, `"immediately before"`, etc.) maps to an
  arithmetic template (`position[b] = position[a] + 1`, `abs(position[a] - position[b]) = 1`, and
  so on) via a small, explicit registry — not string-matched or inferred. An unrecognized
  relation name is a compile-time error naming the unknown relation, per RFC-003 Goal 4 (fail
  loudly, not silently) — never silently dropped or guessed at. The registry is expected to grow
  as new relation names are encountered, the same way ADR-004 §2.2 expects its constraint kinds
  to grow. `Domain` carries no "this one is ordered" flag, so a non-numeric domain can only be
  used as the positional one when `adjacency.variable` names it explicitly — otherwise
  declaration order for a genuinely unordered categorical domain (e.g. color) could
  coincidentally match spatial order and silently produce a wrong solution. `variable` may be
  left unset only when the two entities share exactly one, already-numeric domain.
- **`relation`** → does **not** by itself produce a `constraint` statement. It becomes MiniZinc
  data (e.g. `array[Entities, Entities] of bool`) that a paired `derivedRule` (2.4) consumes —
  a fact table, not a constraint.
- **`ruleTable`** → same non-constraint role as `relation`, but the fact table is over *values*,
  not entity ids (ADR-004 §2.2's addition for static, entity-independent rules like
  rock-paper-scissors' "beats" relation). A paired **`ruleTableConstraint`** compiles to a
  disjunction over the named table's declared tuples: `constraint (a = tupleA_1 /\ b = tupleB_1)
  \/ (a = tupleA_2 /\ b = tupleB_2) \/ ...;`, where `a`/`b` are each rendered once (a declared
  variable's value, or a known constant) and only each tuple's literal values vary per disjunct —
  exactly the tuples true for the current assignment select it, the others are vacuously false.
  Values a `ruleTable` fact uses that aren't part of any declared `Domain` (e.g. a `"Yes"`/`"No"`
  fact attached to otherwise-unrelated domain values) still need a MiniZinc enum to belong to, or
  `minizinc` rejects them as an undefined identifier — the compiler declares one synthetic enum
  covering every such orphan value across the whole `ExtractedCsp`, not per table, since MiniZinc's
  enum-member namespace is global and the same value reused across multiple `ruleTable`s must
  resolve to one identifier, not be redeclared.

### 2.4 `derivedRule`: compilation modes, entity placeholders, and computed-quantity conditions

This is the compiler's least mechanical piece, and refines (does not contradict — ADR-004 §2.2
left `derivedRule`'s exact field shape as "implementation's call") how `derivedRule.condition`
must be structured for this compiler to work: it needs to say *what kind* of thing it conditions
on, not just be a free-text string. Two modes:

1. **Fact-driven expansion** — the condition references a `relation` fact (e.g. "two entities
   that share a border"). The compiler expands this at compile time: for every entity pair where
   the paired `relation` data holds true, emit one concrete instance of the `then` constraints
   (e.g. `constraint color[a] != color[b];` per bordering pair) — resolving the shape-E pattern
   (RFC-003 Appendix §9.1) of "a literal fact, then a generative rule applied over facts."
2. **Variable-conditioned rule** — the condition references extracted domain variables directly
   (e.g. PZL-0011's "if that score is below 600"), not a `relation` fact. The compiler emits a
   MiniZinc reified implication (`constraint (condition) -> (then-constraints);`) rather than
   expanding anything at compile time — the condition is evaluated by the solver, not by the
   compiler. This is how Open Question 7.6's derived-variable/non-binary-outcome pattern
   (multi-way branching to Denied/Approved/Counter-Offer) actually becomes solvable MiniZinc:
   chained implications over a small enum outcome variable, not a single equality constraint.

Which mode applies is determined structurally (does the condition reference a `relation`-typed
fact or a `domains`-typed variable), not by string-inspecting `condition`'s prose — concretely,
`condition` needs a discriminated shape rather than a free-text string, illustrated below (exact
field names are implementation's call, same as ADR-004 §2.2's own code blocks — the discriminated
taxonomy is the decision):

```ts
type DerivedCondition =
  | { readonly kind: "relation"; readonly name: string }
  | { readonly kind: "comparison"; readonly variable: string; readonly operator: string; readonly value: string | number }
  | { readonly kind: "expressionComparison"; readonly expression: ArithmeticExpression; readonly operator: string; readonly value: string | number }
  | { readonly kind: "and"; readonly conditions: readonly (
      | { readonly kind: "comparison"; readonly variable: string; readonly operator: string; readonly value: string | number }
      | { readonly kind: "expressionComparison"; readonly expression: ArithmeticExpression; readonly operator: string; readonly value: string | number }
    )[] }
```

An unrecognized/ambiguous condition shape is a compile-time error (2.3's same fail-loud
principle), not a best-effort guess.

**A third condition variant, `expressionComparison`, was added after the live pipeline found
`comparison` insufficient.** PZL-0011's "if their debt-to-income ratio exceeds 43%" conditions on
a *computed* quantity (a ratio of two declared variables), not a single declared variable
directly — `comparison.variable` can only name one. `expressionComparison` carries a full
`ArithmeticExpression` (2.5) instead, needing no per-entity reification of its own: any entity the
expression cares about is already explicit in its own `variableRef.entity` fields, so it always
compiles to exactly one global reified implication, the same shape as mode 2's scalar case.
Verified directly against a real `minizinc` install, not just the compiled string: MiniZinc's `/`
operator already promotes integer operands to float division correctly (a debt/income ratio of
3200/9000 ≈ 0.356 compares correctly against a 0.43 literal threshold) — no special casting
needed, only the missing schema representation.

**Mode 2's `then`-list entities are named via placeholder tokens, resolved by substitution before
compiling each `then` constraint** — not left implicit. Two token families, each scoped to its own
condition kind, always used as a `variableRef`'s (or `assignment`'s) `entity` field, never as a
bare freestanding string:

- Fact-driven mode's `then` constraints reference the matched fact's two entities via
  `variableRef.entity: "$a"` / `"$b"`. (An earlier version of this compiler special-cased a bare
  `target: "$a"`/`"$b"` string instead, and silently ignored `expression`'s own `entity` field
  entirely — found broken live when a model reasonably produced the structured form instead,
  since nothing resolved it: the literal string `"$a"` sanitized into an invalid MiniZinc
  identifier. Both token families are now resolved the same way, by the same substitution
  mechanism, precisely to avoid this asymmetry recurring.)
- Variable-conditioned mode's `then` constraints reference "the entity currently satisfying this
  rule's condition" via `variableRef.entity: "$this"` — needed for the self-referential zebra-clue
  shape ("if a house is green, its position is one more than the ivory house's"), which requires
  reifying once per entity of the condition variable's domain, not once globally.
- **Relational chaining** (ADR-004 §2.2/§4) — a clue relating TWO entities that are both unnamed,
  each identified only by its own attribute ("whoever smokes X lives next to whoever owns Y") —
  nests a second `derivedRule` inside the first one's `then` list: the outer condition picks out
  the first entity, the inner nested condition the second. The inner rule compiles to a `forall`
  boolean expression (`forall(e in EntityEnum)((innerCondition) -> (innerBody))`), not top-level
  `constraint` statements — nested `derivedRule`s can't emit those, since they need to compose
  *inside* the outer implication's parens, not sit beside it. Inside the inner rule's own `then`
  list, `"$this"` refers to the inner (forall-bound) entity and `"$outer"` refers to the entity the
  enclosing rule is currently reifying over — resolved by substitution the same way as `$a`/`$b`,
  just with an extra token for the one additional nesting level `MAX_NESTING_DEPTH` (ADR-004 §2.7)
  admits. Live-verified against a real `minizinc` install and the eval harness, not assumed from
  the schema shape alone.

A leaked, never-substituted placeholder (any of the four tokens used outside the specific rule
shape that binds it — e.g. `"$outer"` in a fact-driven rule) is a loud compile-time error rather
than a silently-sanitized invalid identifier, per 2.3's same fail-loud principle: no real entity id
is ever `$`-prefixed, so this is unconditionally safe to detect generically at the point a
placeholder would otherwise be rendered as an array index.

**A fourth `DerivedCondition` variant, `"and"`, was added after the live pipeline found no way to
express a `derivedRule` conditioned on more than one independent check.** PZL-0011's "if not
denied by rules 1-2, **and** the requested amount is within policy limits, Approved" needs a
conjunction, and nesting `derivedRule`s (used for relational chaining, above) doesn't substitute:
nesting narrows which entity a rule applies to, it doesn't combine two boolean conditions into one
gate. `{kind: "and", conditions: [...]}` carries two-or-more `"comparison"`/`"expressionComparison"`
sub-conditions — deliberately not `"relation"` or a nested `"and"`, scoped to the evidenced need
rather than maximal generality — each rendered independently and joined with MiniZinc `/\`. Each
sub-condition's variable must be scalar (non-entity-indexed); combining per-entity conditions this
way is a compile-time error, not silently mishandled, since no evidenced puzzle has needed it and
correctly generalizing per-entity conjunction is a separate, undesigned question. Live-verified
against a real `minizinc` install with PZL-0011's full three-rule cascade (two independent
denial thresholds, then a conjunctive Approved/CounterOffer gate) solving to its true answer.

### 2.5 `arithmetic`: a structured expression, not an interpolated string

`ExtractedConstraint`'s `arithmetic` kind (ADR-004 §2.2) is illustrative there; this compiler
needs `expression` to be a small structured sub-shape — a minimal tagged union of variable
references, numeric literals, and binary operators (`+`, `-`, `min`, `max`, absolute value) —
**not** a raw string interpolated directly into generated MiniZinc source, illustrated below
(exact field names are implementation's call, same as ADR-004 §2.2's own code blocks — the
tagged-union taxonomy is the decision):

```ts
type ArithmeticExpression =
  | { readonly kind: "variableRef"; readonly variable: string; readonly entity: string | null }
  | { readonly kind: "literal"; readonly value: number }
  | { readonly kind: "binaryOp"; readonly op: "+" | "-" | "*" | "/" | "min" | "max" | "abs"; readonly operands: readonly ArithmeticExpression[] }
```

This has already moved twice since first decided here, on the same evidence-driven basis as
everything else in this ADR — worth stating plainly rather than leaving the original illustration
to silently rot: `left`/`right?` (a nullable second operand) was replaced with an operand *array*
(length 1 for the unary `abs`, 2 for `-`/`/`, 2-or-more for the associative `+`/`*`/`min`/`max` —
both a more honest arity model and, per ADR-004 §2.7, the encoding that survives provider
transmission where a nullable nested object doesn't); `*`/`/` were added once a puzzle's clue
needed a weighted/percentage/ratio quantity; and `variableRef` gained its own `entity` field (null
for a scalar domain, or a specific entity id) once a clue needed to reference one particular
entity's value from within an expression, rather than only the ambient domain variable.

Treating `expression` as opaque text would mean the compiler can't validate an expression before
emitting it (a malformed or malicious string becomes a MiniZinc syntax error discovered only by
running `minizinc`, or worse, silently-wrong generated source) and defeats the point of
extraction producing a *structured* representation in the first place. This is a refinement of
ADR-004 §2.2's `arithmetic` kind for the same reason as 2.4 above — its exact shape was
explicitly left open there.

## 3. Alternatives Considered

- **Have the LLM emit MiniZinc text directly, skip `ExtractedCsp` and this compiler entirely.**
  Already rejected by [ADR-004](ADR-004-llm-extraction-critic-loop.md) §2.2 (a solver-agnostic
  representation is needed for the future graph representation too, not just MiniZinc) — not
  re-litigated here, only reaffirmed as this ADR's own starting premise.
- **Naive string-template interpolation for `arithmetic.expression`** instead of a structured
  sub-shape (2.5). Rejected: unvalidatable before emission, an injection/correctness risk once
  expression content originates from an LLM extraction rather than a hand-authored template, and
  defeats the point of a structured intermediate representation.
- **Split output into `.mzn` (declarations) + `.dzn` (puzzle data)**, mirroring a classic
  CP-modeling separation of concerns. Rejected (2.1): `ExtractedCsp` has no shared structure
  across puzzles to factor into a template — every puzzle's entities/domains/constraints differ —
  so the split adds a file and a coordination point for no benefit, and diverges from
  `catalog/mzn/`'s existing single-file convention.
- **String-match `derivedRule.condition`'s prose to decide fact-driven vs. variable-conditioned
  mode** (2.4), instead of a structural discriminator. Rejected: prose-matching is exactly the
  brittleness [SPIKE-002](../spikes/SPIKE-002-js-native-nlp-wink/SPIKE.md) already documented for
  pattern-based approaches — a structural check (what kind of `ExtractedCsp` element the
  condition actually references) is deterministic and doesn't depend on phrasing.
- **Silently skip or best-effort-guess unrecognized relations/conditions** (2.3, 2.4), instead of
  a compile-time error. Rejected: directly contradicts RFC-003 Goal 4 (make wrong or partial
  extractions detectable, not silently wrong) — this compiler is squarely in the path that goal
  is about.
- **Have the compiler itself call an LLM to interpret an unrecognized relation or condition
  shape**, rather than failing at compile time. Rejected: this compiler is meant to be a fast,
  free, deterministic translation stage — introducing a second, independent LLM dependency into
  it would add cost and non-determinism to a step that should have neither, for no benefit this
  compiler's own scope needs; extraction ([ADR-004](ADR-004-llm-extraction-critic-loop.md)) is
  where LLM interpretation belongs.

## 4. Consequences

- This compiler is a genuinely independent capability, not a dependency of
  [ADR-004](ADR-004-llm-extraction-critic-loop.md)'s critic loop (which validates fidelity
  directly against the source prose, not via a solver round-trip) — it's a dependency of
  [ADR-003](ADR-003-cli-interface.md) §2.6's `extract` CLI instead, which compiles by default
  before printing. Rendering and trust are decided by two different ADRs on purpose.
- The adjacency-relation registry (2.3) and the fact-driven/variable-conditioned distinction
  (2.4) both start covering only the relation names and condition shapes already evidenced by
  [SPIKE-001](../spikes/SPIKE-001-catalog-clue-audit/SPIKE.md)'s 12 catalog shapes — expected to
  grow as new phrasing/shapes are encountered, the same way ADR-004 §2.2 named its own taxonomy
  as expected to grow. A new relation or condition shape is a compile-time error until the
  registry is extended, not a silent gap.
- This ADR refines `ExtractedCsp`'s `derivedRule.condition` and `arithmetic.expression` fields
  (2.4, 2.5) beyond what ADR-004 §2.2 illustrated — expected and licensed by ADR-004's own
  statement that exact field shapes there are "implementation's call," but worth noting as the
  first concrete refinement of that representation, which future work should treat as current.
- `catalog/mzn/`'s existing hand-written examples become a natural validation corpus for this
  compiler (Context) — comparing compiled output's solve behavior against the hand-written
  reference for the same puzzle is a cheap correctness check. That comparison harness is now
  built (`scripts/eval-extraction.ts`, `eval/README.md`) — running it against the full catalog
  surfaced several real gaps in `ExtractedCsp`/this compiler's 2.5 arithmetic handling, since
  fixed: `variableRef` had no way to name one specific entity's value within an expression
  (needed for e.g. comparing two entities' values directly), `arithmetic.target` could only be a
  plain scalar (blocking clues comparing two computed quantities, like a digit-substitution
  puzzle's equation), only `+`/`-`/`min`/`max`/`abs` were supported with `+` forced to exactly 2
  operands (blocking multi-term sums and any weighted/percentage clue needing `*`/`/`), the
  adjacency-relation registry (2.3) matched relation-name strings exactly (an LLM's
  underscore/hyphen formatting variant of an already-registered name failed to match), and
  MiniZinc enum member identifiers collided when two different domains happened to share a value
  vocabulary (e.g. two independent "Yes"/"No" criteria). All fixed in `src/compiler/compile.ts`/
  `src/extraction/types.ts`; residual failures after these fixes are either the still-open gaps
  named elsewhere in this ADR/ADR-004, or ordinary LLM non-determinism (ADR-004 §2.6).
- **A second pass of the same comparison harness surfaced a further, distinct round of gaps** —
  distinct in kind from the first pass above: that pass was almost entirely missing arithmetic
  capability (an expression shape with no representation at all); this pass was almost entirely
  the compiler's own generated MiniZinc being subtly invalid, or an entity-placeholder convention
  applied inconsistently, in cases the schema already had a representation for. All confirmed
  against a real `minizinc` install before being called fixed, not just by string-matching
  compiled output:
  - `sanitizeIdentifier`'s digit-leading fallback (a value like `"9am"`) prefixed with `_`,
    producing `_9am` — a genuine MiniZinc syntax error (a bare leading underscore parses fine, but
    only when a letter immediately follows it). Falls back to a letter prefix instead.
  - An entity id matching its own `entityType`'s name (e.g. an entity `"player"` of type
    `"player"`) produced `enum player = {player, ...};` — an enum type and one of its own members
    sharing an identifier, also rejected by `minizinc`. The same collision shape applies to a
    variable named identically to its own `entityType`. Both are now detected once per distinct
    `entityType` (not per domain — two domains can share an `entityType` and must resolve to the
    same, consistently-disambiguated enum name) and given a `_Type`-suffixed name only when a real
    collision is detected.
  - `adjacency` (2.3) required the shared positional domain to be integer-valued, rejecting a
    genuinely ordered-but-non-integer domain (e.g. time slots "9am"/"10am"/"11am") outright even
    when it was the only domain shared and therefore unambiguous. Now accepted in that case,
    cast through `enum2int` (MiniZinc's ordinal-position coercion) so the adjacency templates'
    arithmetic operates on the value's declared order rather than failing to type-check.
  - Arithmetic on a non-numeric domain more generally silently used MiniZinc's own implicit
    enum-to-int coercion, which gives only **ordinal position**, not a value's real meaning — for a
    clock-time domain ("9am"/"11am"/"4pm"), "Drug B is at least 4 hours after Drug A" became an
    ordinal-position difference (at most 2 for a 3-value domain), never satisfiable, even though
    the real 7-hour gap (9am to 4pm) satisfies it. The domain still renders as an enum (so a solved
    assignment reads back "9am", matching how the puzzle poses the question), but a whole-hour
    clock-time domain now also gets an explicit `array[ValuesEnum] of int: ..._Hours = [9, 11,
    16];` mapping, and arithmetic on it is rendered through that mapping instead of relying on
    implicit coercion.
  - The nesting-depth budget (ADR-004 §2.7) is sometimes exceeded unnecessarily: "at least N units
    away from EACH of several fixed references" (e.g. two meal times) most naturally combines into
    one `min(abs(...), abs(...))` expression, one level deeper than the budget allows. Resolved in
    the extraction prompt, not the schema: emit one separate `arithmetic` constraint per reference
    instead, logically identical since every top-level constraint is implicitly ANDed, and shallow
    enough to fit — avoiding the real cost (ADR-004 §2.7) of raising the depth budget itself.
  - `ruleTable`/`ruleTableConstraint` (2.3, ADR-004 §2.2) and `expressionComparison` (2.4) are new
    capability, not bug fixes, but found and validated the same way: live pipeline runs against
    PZL-0003, PZL-0013, and PZL-0011/PZL-0012 respectively.

  All fixed in `src/compiler/compile.ts`/`src/extraction/types.ts`/the extraction prompt. PZL-0011's
  compound-condition gap, open when this pass started, is resolved by the `"and"` `DerivedCondition`
  variant added in §2.4 above; residual PZL-0011 failures are prose-comprehension/critic issues
  (the model failing to recognize or correctly extract the conjunction, not a missing
  representation for it) or ordinary LLM non-determinism (ADR-004 §2.6) — not further
  compiler/schema representation gaps, as far as this
  pass's evidence shows.
- The graph-to-`.mzn` compiler RFC-002/[ADR-002](ADR-002-adopt-minizinc-solver.md) originally
  anticipated remains undesigned — this ADR doesn't resolve it, though a future graph
  representation built from `ExtractedCsp` could plausibly reuse this compiler's per-kind
  translation logic (2.3-2.5) rather than duplicating it, since both would ultimately target the
  same MiniZinc constraint vocabulary.
- No change to `src/solver/solve.ts` or its `SolveRequest` shape — this compiler only produces
  the `model: string` value already expected there.

## 5. Related

- RFCs: RFC-002, RFC-003
- Specs: _(populated automatically by the speckit ADR-link hook once `/speckit-specify`
  references this ADR)_
