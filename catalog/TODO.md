# Catalog TODO

Working notes for growing the catalog (TODO.md item 1 at the repo root). This is scratch
tracking for us, not part of the public catalog — `README.md`'s Index table remains the
catalog of record; nothing here duplicates it.

## Backlog

Puzzle ideas queued up but not yet written. Move an idea to `puzzles/` (per README.md's
"Adding a puzzle" steps) and delete it from here once it exists.

- _(empty — add ideas as we think of them)_

## Coverage

Rough count of existing puzzles by category (not tracked in puzzle frontmatter yet — this is
our own bookkeeping until/unless a `category` field gets formalized).

| Category | Count | Puzzles |
|---|---|---|
| Deterministic | 14 | PZL-0001–PZL-0014 |
| Non-problem | 7 | PZL-0015–PZL-0021 |
| Optimization | 6 | PZL-0022–PZL-0027 |
| Subjective/ambiguous | 0 | — |

PZL-0015–PZL-0021 are non-problems by construction, each targeting one named condition from
[RFC-004](../design/rfc/RFC-004-computational-decision-making.md) §5.1's well-posedness ladder
(condition names, not numbers, per that RFC's own convention):

| Puzzle | Condition failed |
|---|---|
| PZL-0015 | Demand (wrong level — an imperative about the modeling act) |
| PZL-0016 | Demand (no demand at all) |
| PZL-0017 | Determinate answer-space (open, unenumerable candidate set) |
| PZL-0018 | Relevance (a solvable model that answers a different question) |
| PZL-0019 | Constitutive constraints (defeasible, not categorical) |
| PZL-0020 | Determinate atoms (predicates need a valuer) |
| PZL-0021 | Sufficiency (too few constraints for the declared demand type) |

PZL-0022–PZL-0027 are constraint optimization problems (COPs, RFC-004 §5.2) adapted from named
classic operations-research problems, each with a hand-verified unique optimum recorded in
`eval/answer-keys.json`:

| Puzzle | Classic problem |
|---|---|
| PZL-0022 | Knapsack problem (extends PZL-0014's packing theme) |
| PZL-0023 | Assignment problem |
| PZL-0024 | Diet problem (Stigler's diet, discretized) |
| PZL-0025 | Bin packing problem (packing theme, other direction) |
| PZL-0026 | Weighted interval scheduling (extends PZL-0009's interview theme) |
| PZL-0027 | Traveling salesman problem |

None of these six are solvable end-to-end by the current pipeline: `ExtractedCsp` has no
objective field and `SolveResult` has no optimization outcome (RFC-004 §5.2; root `TODO.md`
item 3 owns closing this gap). They're in the catalog now so the gap is visible and the
puzzles are ready once extraction/solving catch up.

## Dev / held-out split

Per the discussion behind this workstream: the current 14 are the **dev set** — fair game to
inspect while debugging extraction/critic/compiler issues. Puzzles added from here on are
**held-out** — scored by the eval but not used to guide prompt or compiler tuning, so a gap
between dev and held-out pass rates is our overfitting signal.

| Set | Puzzles |
|---|---|
| Dev | PZL-0001–PZL-0014 |
| Held-out | PZL-0015–PZL-0027 |
