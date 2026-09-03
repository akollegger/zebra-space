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

A card-loop puzzle session (cover sheet, cards with a role and a carrier, a dependency order, a
closing question) currently exists only as `puzzle-data.js`, a hand-written JavaScript module in
`design/spikes/SPIKE-006-progressive-card-prototype/`. Three concepts are hardcoded there in a way
that resists reuse:

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

The project already has a data-only, domain-neutral constraint representation:
`ExtractedCsp` (`src/extraction/types.ts`) — `{ entities, domains, constraints }`, where
`constraints` is a tagged union (`ExtractedConstraint`) covering assignment, linked attributes,
all-different, adjacency, binary relations, derived rules, arithmetic, and rule tables. It already
feeds a real solver: `src/solver/solve.ts` compiles it to MiniZinc (`src/compiler/compile.ts`, per
[ADR-005](ADR-005-extractedcsp-mzn-compiler.md)) and reports `SolveResult` — `Unsatisfiable`,
`UniquelySolvable`, or `MultiplySatisfiable` (capped at two witnessed assignments, not an exact
count). No deck-specific format needs to reinvent constraint representation; it needs to give
cards a stable way to point at entries in this existing shape.

## 2. Decision

A deck is a single YAML document under `catalog/decks/DECK-NNNN-shortname.yaml`, `NNNN`
zero-padded, parallel to `catalog/puzzles/PZL-NNNN-*.md` (per
[ADR-001](ADR-001-catalog-format-seeding.md) §2.2). It separates the underlying constraint
satisfaction problem (`csp`) from how that problem is revealed to a player through cards
(`cards`), matching RFC-005 §5.6's task-brief/cards/closure split.

### 2.1 Format

```yaml
id: DECK-0001
title: <string>
puzzle: PZL-0002            # source catalog puzzle this deck was authored from, or null
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
    <constraintId>: <ExtractedConstraint>   # one entry per distinct logical claim

cards:
  - id: <string>
    role: domain | constraint | redundant | noise
    tier: strict                            # only value supported in v1; see Consequences
    dependsOn: [<card id>, ...]
    carrier: <string>                       # the in-fiction source, shown before opening
    text: <string>                          # the claim itself, shown on opening
    reveals: <domains[].variable> | entities   # role: domain only
    constraint: <constraintId>              # role: constraint | redundant only
    duplicateOf: <card id>                  # role: redundant only

order: [<card id>, ...]                     # authored deal order; every id exactly once

closure:
  question: <string>
  answer:
    entityType: <string>                    # which entities are candidate answers
    variable: <string>                      # the variable that picks the answer out
    equals: <value>
    reveal: id                              # what to report: the matching entity's id
```

`role: domain` cards reveal an entry in `csp.entities` or `csp.domains` (via `reveals`) without
asserting a constraint; `role: constraint` and `role: redundant` cards point at one entry in
`csp.constraints` (via `constraint`). A `redundant` card additionally names the card it echoes
(`duplicateOf`) — this is how a deck expresses SPIKE-006 Finding 4's "conditionally useful
duplicate" rather than a permanently-fixed noise card: the same `constraintId` reached through two
different carriers.

A card is one presentation of a constraint — a constraint is what a card logically asserts, once
its carrier voice is stripped away. Two cards are equivalent exactly when they resolve to the same
`constraint` key, regardless of how differently they're worded. This settles RFC-005 Open Question
7.10 (duplicate-carrier equivalence) at the schema level: equivalence is structural (same
`constraint` reference), not a similarity judgment made over prose. It also gives Open Question
7.1 (systematic substitute carriers) a concrete mechanism — a deck can carry more than one card per
constraint — without settling that question's scoring half. One consequence worth naming: nothing
in this schema requires presentation to follow `order`'s fixed sequence. A loader is free to iterate
`csp.constraints` instead and select among the cards that reference each one, which is a different
implementation than SPIKE-006's static deal but not a different deck format.

### 2.2 Constraint representation

`csp.constraints` is a map keyed by a deck-local constraint id, not the bare array
`ExtractedCsp.constraints` uses — cards need a stable name to reference (`red-middle`,
`cat-red-house`), and array position is not stable under reordering or editing. Loading a deck for
solving flattens this map's values into an `ExtractedCsp.constraints` array (order does not affect
solving); its `entities` and `domains` pass through unchanged. Each map value is exactly an
`ExtractedConstraint`, so a deck author has every constraint kind extraction already produces
available, not a subset invented for this format.

### 2.3 Location and index

Decks live in `catalog/decks/`, alongside a `README.md` (created when the first deck is added)
mirroring `catalog/puzzles/README.md`'s Format-and-Index structure: a table of `Deck | Title |
Source Puzzle`.

### 2.4 Validation

Loading a deck checks, independent of any solver call:

- Every `dependsOn`, `reveals`, `constraint`, and `duplicateOf` reference resolves to an existing
  id.
- The `dependsOn` graph is acyclic.
- No two cards with `role: constraint` or `role: domain` claim the same `constraint`/`reveals`
  target — a `redundant` card is exactly how a second card is allowed to point at an
  already-claimed constraint.
- A `role: redundant` card's `constraint` equals its `duplicateOf` target's `constraint` — the two
  must resolve to the same underlying claim, or the card isn't actually a duplicate of what it
  names.
- `order` is a permutation of every card id, each appearing once.

This generalizes `puzzle-data.js`'s `validateDeck()` (which checked the same properties against
one hardcoded deck) into a schema-level check any deck must pass.

## 3. Alternatives Considered

- **A deck-native constraint DSL, invented for this format.** Rejected: `ExtractedConstraint`
  already covers assignment, linked-attribute, all-different, adjacency, relation, derived-rule,
  arithmetic, and rule-table shapes, compiled and solved end to end (ADR-002, ADR-005). A second
  grammar for the same nine shapes would need its own compiler and would drift from the one
  extraction already produces.
- **Continue writing a bespoke solver module per deck**, as `solver.js` does today. Rejected:
  this is the exact cost this format exists to remove — every new deck would still require
  hand-written enumeration code, not just content.
- **Store `csp.constraints` as a flat array**, matching `ExtractedCsp` exactly with no adapter.
  Rejected: cards reference specific constraints by name; array indices shift under any edit to
  the deck, silently repointing a card at the wrong constraint.
- **Attach `role`/`tier` to the constraint instead of the card.** Rejected: role and tier describe
  how a fact is revealed to a player, not the fact's logical shape — the same constraint can be
  echoed by more than one card (`redundant`), so the pedagogical metadata belongs on the card, not
  the constraint it points at.
- **Extend `catalog/puzzles/PZL-NNNN.md` in place, rather than a separate `catalog/decks/`
  format.** Rejected: a card's carrier voice is prose, one narrative per file (ADR-001 §2.1); a
  deck's `csp` is explicit structure that supports more than one narrative over the same
  constraints (multiple cards per `constraint` key, §2.1). Folding cards into the puzzle file
  would force every carrier variation to fork the puzzle itself, instead of letting one puzzle
  support several decks.

## 4. Consequences

- Deck loading gains a real solver path (`ExtractedCsp` → `solve()`) in place of a brute-force
  permutation enumerator written per deck. That enumerator implicitly treated every
  `role: domain` fact, including all-different constraints, as free — it never affected a solution
  count because permutation generation already excluded repeats. Under the real solver, an
  all-different constraint is a genuine, counted constraint like any other: RFC-005 §5.3's
  assumption that domain-role judgments don't move the remaining-solution count needs to be
  re-checked once a deck is actually solved this way, not assumed to carry over from SPIKE-006.
- A fast, per-swipe "how many solutions remain now" call and a candidate-card
  constraint-vs-noise assessment are still designed but unbuilt (RFC-005 §5.7); this format makes
  a deck's CSP solvable in full, but does not itself deliver an incremental interface. A deck
  authored against this schema can be solved once (`SolveResult`), not queried interactively yet.
- `tier` supports only `strict` in v1 (per §2.1's schema comment). `ambiguous` and `subjective`
  have no defined `readings`/weighting shape — RFC-005 Open Question 7.1 stays open, and both
  remain unsupported values rather than partially-specified ones until a later ADR gives them a
  shape.
- Deal order is fully author-declared (`order`); RFC-005 Open Question 7.8 (an authored order vs.
  a dependency-respecting shuffle) stays open — this format supports either being layered on top
  later without a schema change, since `order` can be validated against the `dependsOn` graph
  either way.
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
