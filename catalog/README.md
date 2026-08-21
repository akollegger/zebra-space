# Puzzle Catalog

A catalog of zebra puzzles (and other classic-CSP logic puzzles), seeded per
[ADR-001](../design/adr/ADR-001-catalog-format-seeding.md). Each entry is one Markdown file
under `puzzles/`, with YAML frontmatter for structured metadata and the puzzle itself as
natural-language prose.

## Format

- File: `puzzles/PZL-NNNN-short-name.md`, `NNNN` zero-padded to 4 digits, sequential.
- Frontmatter: `id`, `title`, `tier` (placeholder `unknown`), `variables`/`domains`/`constraints`
  (CSP-neutral size), `source` (URL, or `null` for hand-authored), `difficulty` (placeholder
  `unknown`), `created`.
- Body: unstructured prose — the puzzle as its author chose to write it.

## Index

| Puzzle | Title | Size | Source | Status |
|---|---|---|---|---|
| [PZL-0001](puzzles/PZL-0001-life-international-1962.md) | Life International 1962 | 25/5/14 | [Wikipedia](https://en.wikipedia.org/wiki/Zebra_Puzzle) | seeded |
| [PZL-0002](puzzles/PZL-0002-context-graphs-example.md) | Three Houses (Context Graphs Example) | 6/2/4 | [Medium](https://medium.com/neo4j/context-graphs-agentic-decisions-9a125f22f411) | seeded |
| [PZL-0003](puzzles/PZL-0003-rock-paper-scissors.md) | Rock Paper Scissors | 1/1/4 | hand-authored | seeded |
| [PZL-0004](puzzles/PZL-0004-whodunit.md) | Whodunit | 3/3/6 | hand-authored | seeded |
| [PZL-0005](puzzles/PZL-0005-four-countries.md) | Four Countries | 4/1/8 | hand-authored | seeded |
| [PZL-0006](puzzles/PZL-0006-four-queens.md) | Four Queens | 4/1/3 | hand-authored | seeded |
| [PZL-0007](puzzles/PZL-0007-send-more-money.md) | SEND + MORE = MONEY | 8/1/4 | [Wikipedia](https://en.wikipedia.org/wiki/Verbal_arithmetic) | seeded |
| [PZL-0008](puzzles/PZL-0008-lo-shu-square.md) | Lo Shu Square | 9/1/5 | [Wikipedia](https://en.wikipedia.org/wiki/Lo_Shu_Square) | seeded |
| [PZL-0009](puzzles/PZL-0009-interview-slots.md) | Interview Slots | 3/1/3 | hand-authored | seeded |
| [PZL-0010](puzzles/PZL-0010-four-way-stop.md) | Four-Way Stop | 5/1/7 | hand-authored | seeded |
| [PZL-0011](puzzles/PZL-0011-loan-review.md) | Loan Review | 1/1/7 | hand-authored | seeded |
| [PZL-0012](puzzles/PZL-0012-medication-schedule.md) | Medication Schedule | 3/1/3 | hand-authored | seeded |
| [PZL-0013](puzzles/PZL-0013-picking-a-restaurant.md) | Picking a Restaurant | 1/1/7 | hand-authored | seeded |
| [PZL-0014](puzzles/PZL-0014-packing-the-box.md) | Packing the Box | 5/1/2 | hand-authored | seeded |
| [PZL-0015](puzzles/PZL-0015-extract-a-solvable-csp.md) | Extract a Solvable CSP | 0/0/0 | hand-authored | seeded |

`Size` is `variables/domains/constraints` (ADR-001 §2.1) — a CSP-neutral profile, not a
difficulty rating.

## Adding a puzzle

The catalog is meant to keep growing — collaboratively, incrementally, without needing a new
spec for each addition. To add one:

1. Pick the next `PZL-NNNN` id (check the table above for the current max).
2. Write the frontmatter per the Format section above. `tier` and `difficulty` stay `unknown`
   until their taxonomies are settled (RFC-001 Open Questions). Set `source` to a URL if the
   puzzle is copied/adapted from somewhere, or `null` if it's original.
3. Write the puzzle body as natural-language prose — any style, any length, no prescribed
   structure.
4. Solve it yourself first and confirm it has **exactly one** valid solution — no puzzle should
   be added without this check.
5. Record that solution in `eval/answer-keys.json` (a private file, not part
   of this public index — see that feature's spec for why).
6. Add a row to the Index table above.
