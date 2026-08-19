---
id: ADR-005
title: ExtractedCsp to MiniZinc Compiler
status: proposed
rfcs: [RFC-002, RFC-003]
created: 2026-08-18
specs: []
---

# ADR-005: ExtractedCsp to MiniZinc Compiler

## 1. Context

[ADR-004](ADR-004-llm-extraction-critic-loop.md) §2.2 introduced `ExtractedCsp`, a solver-agnostic
intermediate representation extraction produces. ADR-004's own critic loop (§2.4) validates an
extraction's *fidelity* to the source prose directly — a second LLM call, not a solver round-trip
— so it has no dependency on this ADR. Compiling `ExtractedCsp` to MiniZinc remains a genuinely
needed, independent capability regardless: it's what actually lets a validated extraction be
rendered as a solvable model at all — [ADR-003](ADR-003-cli-interface.md) §2.6's `extract` CLI
compiles by default before printing, and the same compiled output can be piped to `solve`. This
ADR designs that compiler, from
[ADR-004](ADR-004-llm-extraction-critic-loop.md) §2.2's `ExtractedCsp` representation to the
MiniZinc target [ADR-002](ADR-002-adopt-minizinc-solver.md) §2.5 already committed to (decision
variables as `array of var`, one per domain/attribute-category; constraints built from
`alldifferent`, comparison/arithmetic operators, and `if-then-else`) — directly completing RFC-003
Goal 3's MiniZinc half ("output that is a plausible input to... a MiniZinc model").

This is genuinely shared infrastructure, not scoped to one RFC: it produces the actual input
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
  to grow.
- **`relation`** → does **not** by itself produce a `constraint` statement. It becomes MiniZinc
  data (e.g. `array[Entities, Entities] of bool`) that a paired `derivedRule` (2.4) consumes —
  a fact table, not a constraint.

### 2.4 `derivedRule`: two distinct compilation modes

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
```

An unrecognized/ambiguous condition shape is a compile-time error (2.3's same fail-loud
principle), not a best-effort guess.

### 2.5 `arithmetic`: a structured expression, not an interpolated string

`ExtractedConstraint`'s `arithmetic` kind (ADR-004 §2.2) is illustrative there; this compiler
needs `expression` to be a small structured sub-shape — a minimal tagged union of variable
references, numeric literals, and binary operators (`+`, `-`, `min`, `max`, absolute value) —
**not** a raw string interpolated directly into generated MiniZinc source, illustrated below
(exact field names are implementation's call, same as ADR-004 §2.2's own code blocks — the
tagged-union taxonomy is the decision):

```ts
type ArithmeticExpression =
  | { readonly kind: "variableRef"; readonly variable: string }
  | { readonly kind: "literal"; readonly value: number }
  | { readonly kind: "binaryOp"; readonly op: "+" | "-" | "min" | "max" | "abs"; readonly left: ArithmeticExpression; readonly right?: ArithmeticExpression }
```

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
  reference for the same puzzle is a cheap correctness check, though building that comparison
  harness is not itself decided here.
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
