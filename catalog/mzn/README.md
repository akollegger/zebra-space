# MiniZinc Example Catalog

Hand-written MiniZinc models, one per corresponding [`catalog/puzzles/`](../README.md) entry —
per [ADR-002](../../design/adr/ADR-002-adopt-minizinc-solver.md) §2.6, a growing reference corpus
for whoever eventually builds the graph-to-`.mzn` compiler (still undesigned).

## Convention

- File: `PZL-NNNN-short-name.mzn`, matching the corresponding `catalog/puzzles/PZL-NNNN-*.md`
  entry's id and short name.
- Content: plain MiniZinc — variable declarations (prefer `enum` types over bare integers where
  the puzzle's domain has meaningful names, e.g. suspects or rooms) plus `constraint` statements
  translating that puzzle's clues.
- Hand-translated, not generated — there's no automatic prose-to-MiniZinc compiler yet
  ([RFC-002](../../design/rfc/RFC-002-constraint-solver-selection.md) Non-Goal 2).
- Not every constraint shape needs a global constraint (e.g. `all_different`) — check what the
  puzzle's clues actually require before reaching for one. See
  `specs/002-minizinc-integration/research.md` Finding 4 for a case where an ADR mis-attributed
  one.

## Index

| Puzzle | File | Notes |
|---|---|---|
| [PZL-0004](../puzzles/PZL-0004-whodunit.md) | [PZL-0004-whodunit.mzn](PZL-0004-whodunit.mzn) | Direct elimination via `!=` only — no global constraints needed. |
