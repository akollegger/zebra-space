---
id: ADR-006
title: Deck YAML Format
status: proposed
rfcs: [RFC-005]
created: 2026-09-03
specs: []
---

# ADR-006: Deck YAML Format

## 1. Context

A card-loop puzzle session (a cover sheet, cards that establish grounding or assert constraints,
a dependency order, a closing question) currently exists only as `puzzle-data.js`, a hand-written
JavaScript module in `design/spikes/SPIKE-006-progressive-card-prototype/`. Three concepts are
hardcoded there in a way that resists reuse:

- Each constraint-bearing card's `constraintId` (e.g. `'cat-red'`) is a pointer into
  `solver.js`, a bespoke, hand-written predicate function specific to that one deck's grid. There
  is no data-only representation of what the card actually asserts — checking whether a set of
  kept cards still admits a solution means writing new JavaScript.
- `CSP_SOURCES`, a debug-only atom-id-to-description map, exists purely so a human reading the
  console can tell which underlying fact a card carries; it has no relationship to the constraint
  logic itself and would need to be hand-maintained in parallel with any change to `solver.js`.
- `role`, `dependsOn`, `carrier`, and `text` are plain object literals with no schema and no
  validation beyond the load-time `validateDeck()` assertions written against this one deck's
  shape.

Authoring a second deck today means copying `puzzle-data.js` and `solver.js` and rewriting both by
hand, including a new brute-force grid enumerator. That makes every new deck an engineering task,
which [RFC-005](../rfc/RFC-005-progressive-puzzle-game-mechanics.md) §5.6 explicitly wants to avoid:
a deck's task brief, cards, and closure are meant to be authorable as content. The
[SPIKE-006](../spikes/SPIKE-006-progressive-card-prototype/SPIKE.md) prototype validated the
card-loop mechanics themselves (dependency-gated relevance, redundant-card handling, hidden
scoring) against this one hardcoded deck; its Conclusion names the next step as "a deck/solver
contract that evaluates domains and retained context together" — a contract this ADR now defines
as a portable file format rather than a JavaScript module.

A format for this has to settle its own constraint vocabulary — the shapes a card can assert —
without requiring an author to go read a TypeScript module to find out what's expressible. That
vocabulary happens not to need inventing from scratch: `src/extraction/types.ts` already defines a
data-only, domain-neutral one (`ExtractedCsp` — `{ entities, domains, constraints }`, where
`constraints` is a nine-kind tagged union covering assignment, linked attributes, all-different,
adjacency, named relations, derived rules, arithmetic, and rule tables), already wired to a real
solver (`src/solver/solve.ts` compiles it to MiniZinc per [ADR-005](ADR-005-extractedcsp-mzn-compiler.md)
and reports `SolveResult` — `Unsatisfiable`, `UniquelySolvable`, or `MultiplySatisfiable`, the last
capped at two witnessed assignments rather than an exact count). Aligning this format's constraint
vocabulary with that one, rather than a different one, means a deck's `csp` block is solvable by
the existing pipeline with no translation step — but that's a reason to reuse the same shapes, not
a reason to define this format *as* a reference to that module.

## 2. Decision

A deck is a single YAML document under `catalog/decks/DECK-NNNN-shortname.yaml`, `NNNN`
zero-padded. It separates the underlying constraint satisfaction problem (`csp`) from how that
problem is revealed to a player through cards (`cards`), matching RFC-005 §5.6's task-brief/
cards/closure split.

### 2.1 Format

```yaml
id: DECK-0001
title: <string>
created: <ISO date>

brief:
  question: <string>        # the one thing the closing choice will ask about
  problem: <string>         # narrative premise
  clue: <string>            # single associative clue, not the CSP itself
  instruction: <string>     # the framing line closing the cover sheet

csp:
  entities:
    - {id: <string>, type: <string>}
  domains:
    - {variable: <string>, entityType: <string>, values: [<string>, ...]}
  constraints:
    <constraintId>: <constraint>   # one entry per distinct logical claim; shapes in §2.2

cards:
  - id: <string>
    tier: strict                            # only value supported in v1; see Consequences
    dependsOn: [<card id>, ...]
    title: <string>                         # the in-fiction source, shown before opening
    text: <string>                          # the claim itself, shown on opening
    reveals: [<domains[].variable> | entities, ...]   # zero or more; see §2.3
    constraints: [<constraintId>, ...]                # zero or more; see §2.3

closure:
  question: <string>
  answer:
    entityType: <string>                    # which entities are candidate answers
    variable: <string>                      # the variable that picks the answer out
    equals: <value>
    reveal: id                              # what to report: the matching entity's id
```

Deal order is the order cards appear under `cards:` — there is no separate ordering field. A
loader that wants a different presentation sequence (a dependency-respecting shuffle, or iterating
`csp.constraints` instead of the card list) computes one; it doesn't read a second authored field
that could disagree with the first.

### 2.2 Constraint shapes

Each entry in `csp.constraints` is one of the following, discriminated by `kind`. This is the
format's complete constraint vocabulary — an author needs nothing beyond this list to write one:

- `{kind: assignment, entity, variable, value}` — fixes one named entity's variable to a value.
- `{kind: linkedAttributes, entityType, attributes: [{variable, value}, ...]}` — some entity of
  `entityType` has every listed `variable=value` simultaneously; no entity is named (positive
  co-occurrence, e.g. "the cat lives in the red house").
- `{kind: allDifferent, variable}` — every entity's value for this variable must be distinct.
- `{kind: adjacency, relation, a, b, variable}` — an ordering/positional relation between two
  entities (e.g. "immediately right of"). `variable` names the ordered domain when its values
  aren't plain integers, `null` when `a`/`b` share exactly one numeric domain.
- `{kind: relation, name, a, b}` — a named fact between two entities, consumed by a paired
  `derivedRule` rather than producing a constraint on its own.
- `{kind: arithmetic, expression, comparator, target}` — a numeric or enum-valued comparison
  between a structured `expression` and a `target` (a plain value, or itself a structured
  expression).
- `{kind: ruleTable, name, a, b}` — one fact in a static, entity-independent rule table over
  domain *values* (e.g. "Paper beats Rock"), consumed by a paired `ruleTableConstraint`.
- `{kind: ruleTableConstraint, table, a, b}` — requires two operands (each a `variableRef` or a
  `literal`) to be related by the named `ruleTable`.
- `{kind: derivedRule, appliesTo, condition, thenConstraints: [...]}` — applies its
  `thenConstraints` when `condition` holds.

This is deliberately the same vocabulary `ExtractedConstraint` defines in
`src/extraction/types.ts` — not because writing a deck requires opening that module, but because a
`csp` block written against this list serializes losslessly to `ExtractedCsp`, which is how a
deck's constraints reach the existing solver (§1) with no translation step.

### 2.3 Card semantics

A card carries zero or more claims against `csp`: `reveals` names entity/domain facts it
establishes; `constraints` names constraints (by `csp.constraints` key) it asserts. Both are
optional and independent — a card may carry either, both, or neither:

- Empty `reveals` and empty `constraints`: the card is noise — consistent with the solution,
  constraining nothing (RFC-005 §5.1 step 3).
- Non-empty `reveals`: the card establishes domain grounding.
- Non-empty `constraints`: the card asserts one or more constraints.

**Redundancy is derived from position, not authored.** When more than one card names the same
`reveals` target or the same `constraints` entry, the first such card under `cards:` is that
target's primary presentation; every later card naming it is a redundant echo of the same
underlying fact in a different carrier voice (SPIKE-006 Finding 4). This settles RFC-005 Open
Question 7.10 structurally: two cards are equivalent exactly when they name the same target, never
by a judgment over their prose. It also answers Open Question 7.1's authoring half — a deck can
carry more than one card per fact — without settling that question's scoring half.

There is no `role` field, and no `duplicateOf` field. A loader classifies each card
(domain-establishing, constraint-asserting, redundant, or noise) from its `reveals`/`constraints`
content and its position among cards naming the same targets, rather than trusting hand-authored
labels that can drift out of sync with what a card actually claims.

### 2.4 Location and index

Decks live in `catalog/decks/`, alongside a `README.md` (created when the first deck is added)
mirroring `catalog/puzzles/README.md`'s Format-and-Index structure: a table of `Deck | Title`.

### 2.5 Validation

Loading a deck checks, independent of any solver call:

- Every `dependsOn`, `reveals`, and `constraints` reference resolves to an existing id.
- The `dependsOn` graph is acyclic.

This generalizes `puzzle-data.js`'s `validateDeck()` (which checked the same properties against
one hardcoded deck) into a schema-level check any deck must pass.

## 3. Alternatives Considered

- **A constraint vocabulary invented from scratch for this format**, rather than the one in §2.2.
  Rejected: `ExtractedConstraint` already covers these nine shapes, compiled and solved end to end
  (ADR-002, ADR-005). A different vocabulary would need its own compiler and would drift from the
  one extraction produces.
- **Continue writing a bespoke solver module per deck**, as `solver.js` does today. Rejected:
  this is the exact cost this format exists to remove — every new deck would still require
  hand-written enumeration code, not just content.
- **Store `csp.constraints` as a flat array**, matching `ExtractedCsp` exactly with no adapter.
  Rejected: cards reference specific constraints by name; array indices shift under any edit to
  the deck, silently repointing a card at the wrong constraint.
- **Hand-author `role` and `duplicateOf` as explicit card fields**, rather than deriving both from
  `reveals`/`constraints` (§2.3). Rejected: an explicit `duplicateOf` pointer needs its own
  consistency rule (it must name a card sharing the same constraint) that can drift out of sync
  with what the cards actually claim — exactly the gap review caught in an earlier draft of this
  ADR that used explicit fields. Deriving both makes that drift structurally impossible instead of
  needing to be validated against.
- **A `puzzle` field recording the catalog puzzle a deck was adapted from.** Rejected: it presumes
  every deck originates from a cataloged puzzle. A deck should be directly authorable without one.
- **A separate authored `order` field, distinct from cards' position under `cards:`.** Rejected:
  redundant with YAML's own list ordering. A loader wanting a different presentation sequence
  computes one (§2.1); it doesn't need a second authored field to disagree with the first.
- **Extend `catalog/puzzles/PZL-NNNN.md` in place, rather than a separate `catalog/decks/`
  format.** Rejected: a card's title and text are prose, one narrative per file (ADR-001 §2.1); a
  deck's `csp` is explicit structure that supports more than one narrative over the same
  constraints (multiple cards per `constraints` entry, §2.3). Folding cards into the puzzle file
  would force every carrier variation to fork the puzzle itself, instead of letting one puzzle
  support several decks.

## 4. Consequences

- Deck loading gains a real solver path (`ExtractedCsp` → `solve()`) in place of a brute-force
  permutation enumerator written per deck. That enumerator implicitly treated every
  domain-establishing fact, including all-different constraints, as free — it never affected a
  solution count because permutation generation already excluded repeats. Under the real solver,
  an all-different constraint is a genuine, counted constraint like any other: RFC-005 §5.3's
  assumption that domain grounding doesn't move the remaining-solution count needs to be
  re-checked once a deck is actually solved this way, not assumed to carry over from SPIKE-006.
- A fast, per-swipe "how many solutions remain now" call and a candidate-card
  constraint-vs-noise assessment are still designed but unbuilt (RFC-005 §5.7); this format makes
  a deck's CSP solvable in full, but does not itself deliver an incremental interface. A deck
  authored against this schema can be solved once (`SolveResult`), not queried interactively yet.
- `tier` supports only `strict` in v1 (per §2.1's schema comment). `ambiguous` and `subjective`
  have no defined `readings`/weighting shape — RFC-005 Open Question 7.1 stays open, and both
  remain unsupported values rather than partially-specified ones until a later ADR gives them a
  shape.
- Deriving role and redundancy (§2.3) pushes real classification logic into the loader that a
  hand-authored `role` field previously gave for free: checking which of `reveals`/`constraints`
  is non-empty, and finding the first card among those naming a shared target. A card that is
  both domain-establishing and constraint-asserting at once — which this schema now permits — has
  no defined ledger value under RFC-005 §5.3's per-role scoring table; that table needs to be
  redefined over derived classifications, including the composite case, as follow-up work rather
  than something this ADR resolves.
- Redundancy detection now applies to `reveals` as well as `constraints` — two cards establishing
  the same domain fact are echoes of each other by the same rule that governs duplicate
  constraints. SPIKE-006 never exercised this (its domain cards were each authored once); it is
  untested territory this format makes reachable.
- Converting `puzzle-data.js`/`solver.js` into a `catalog/decks/DECK-0001-*.yaml` file conforming
  to this schema, and building the loader that flattens `csp.constraints` and calls `solve()`, is
  follow-up implementation work, not part of this decision.
- Every card is text-only; RFC-005 §5.6's `modality` (image cards, and their bounded readings) has
  no representation here. Open Questions 7.11 and 7.12 (image verification, audit modality
  asymmetry) stay fully open — adding `modality` is a schema extension for a later ADR, not
  something this format leaves room for implicitly.
- `closure` only models a grid-assignment answer. RFC-005 §5.6's third closure kind — the ill-posed
  deck's named defect (§5.5) — has no representation here, consistent with §5.7 sequencing the
  ill-posed stage last as design work that has not started.

## 5. Related

- RFCs: RFC-005
- ADRs: ADR-001 (catalog format precedent), ADR-002 (MiniZinc solver ecosystem), ADR-005
  (`ExtractedCsp` → MiniZinc compiler)
- Specs: _(populated automatically by the speckit ADR-link hook once `/speckit-specify` references
  this ADR)_
