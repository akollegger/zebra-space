# MiniZinc Example Catalog

MiniZinc models, one per corresponding [`catalog/puzzles/`](../README.md) entry — per
[ADR-002](../../design/adr/ADR-002-adopt-minizinc-solver.md) §2.6, a growing reference corpus
for whoever eventually builds the graph-to-`.mzn` compiler (still undesigned).

## Convention

- File: `PZL-NNNN-short-name.mzn`, matching the corresponding `catalog/puzzles/PZL-NNNN-*.md`
  entry's id and short name.
- Content: plain MiniZinc — variable declarations (prefer `enum` types over bare integers where
  the puzzle's domain has meaningful names, e.g. suspects or rooms) plus `constraint` statements
  translating that puzzle's clues.
- Two provenances, both allowed, distinguished in the Index's **Provenance** column:
  - **Hand-translated** — authored directly against the puzzle prose; there's no automatic
    prose-to-MiniZinc compiler yet ([RFC-002](../../design/rfc/RFC-002-constraint-solver-selection.md)
    Non-Goal 2).
  - **LLM-generated, verified** — lifted from an LLM formalization run (e.g.
    [SPIKE-014](../../design/spikes/SPIKE-014-informal-reasoning-formalization/SPIKE.md)'s
    `formalize-mzn`) that this project's own `compile()`/`solve()` pipeline confirmed solves
    uniquely and matches the puzzle's answer key — not merely "looks plausible." An entry lifted
    this way may still be hand-edited afterward for legibility (e.g. dropping a logically-vacuous
    constraint the source run happened to include) without changing its provenance, as long as
    the edit doesn't change what the model accepts/rejects.
- Not every constraint shape needs a global constraint (e.g. `all_different`) — check what the
  puzzle's clues actually require before reaching for one. See
  `specs/002-minizinc-integration/research.md` Finding 4 for a case where an ADR mis-attributed
  one.

## Index

| Puzzle | File | Provenance | Notes |
|---|---|---|---|
| [PZL-0001](../puzzles/PZL-0001-life-international-1962.md) | [PZL-0001-life-international-1962.mzn](PZL-0001-life-international-1962.mzn) | Hand-translated | The classic Life International 1962 zebra puzzle — 5 `enum` domains, `alldifferent` per domain, same-house clues as bidirectional `forall`, adjacency clues via a `next_to` predicate. Solves uniquely, matches `eval/answer-keys.json` exactly. |
| [PZL-0002](../puzzles/PZL-0002-context-graphs-example.md) | [PZL-0002-context-graphs-example.mzn](PZL-0002-context-graphs-example.mzn) | LLM-generated, verified | Lifted from SPIKE-014 `formalize-mzn` (frontier tier, `claude-sonnet-4.5`) — 6/6 MATCH across both tiers tested. |
| [PZL-0003](../puzzles/PZL-0003-rock-paper-scissors.md) | [PZL-0003-rock-paper-scissors.mzn](PZL-0003-rock-paper-scissors.mzn) | LLM-generated, verified | Lifted from SPIKE-014 `formalize-mzn` (frontier tier); three logically-vacuous `-> true` constraints from the source run removed for legibility. |
| [PZL-0004](../puzzles/PZL-0004-whodunit.md) | [PZL-0004-whodunit.mzn](PZL-0004-whodunit.mzn) | Hand-translated | Direct elimination via `!=` only — no global constraints needed. |
| [PZL-0007](../puzzles/PZL-0007-send-more-money.md) | [PZL-0007-send-more-money.mzn](PZL-0007-send-more-money.mzn) | LLM-generated, verified | Lifted from SPIKE-014 `formalize-mzn` (frontier tier) — classic carry-chain SEND+MORE=MONEY encoding, 6/6 MATCH across both tiers tested. |
| [PZL-0011](../puzzles/PZL-0011-loan-review.md) | [PZL-0011-loan-review.mzn](PZL-0011-loan-review.mzn) | Hand-translated | Not an attribute grid — a single decision variable determined by reified if/then policy rules over given (compile-time) facts. Solves uniquely, matches `eval/answer-keys.json`'s `CounterOffer`. |
| [PZL-0038](../puzzles/PZL-0038-the-concrete-wall.md) | [PZL-0038-the-concrete-wall.mzn](PZL-0038-the-concrete-wall.mzn) | Hand-translated | Clue 5 ("the wolf preys on the rabbit") is intentionally NOT encoded as a non-adjacency constraint — the puzzle's own answer key notes it as a defeated premise (concrete walls block everything). Solves uniquely, matches the answer key. |
