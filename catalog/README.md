# Puzzle Catalog

A catalog of zebra puzzles (and other classic-CSP logic puzzles), seeded per
[ADR-001](../design/adr/ADR-001-catalog-format-seeding.md). Each entry is one Markdown file
under `puzzles/`, with YAML frontmatter for structured metadata and the puzzle itself as
natural-language prose.

## Format

- File: `puzzles/PZL-NNNN-short-name.md`, `NNNN` zero-padded to 4 digits, sequential.
- Frontmatter: `id`, `title`, `tier` (placeholder `unknown`), `variables`/`domains`/`constraints`
  (CSP-neutral size), `source` (URL, or `null` for hand-authored), `difficulty` (placeholder
  `unknown`), `created`, optional `groundTruth` (see below).
- Body: unstructured prose — the puzzle as its author chose to write it.

### `groundTruth` (optional)

The expected **vocabulary shape** for a determinate puzzle — the entity-axis size and domain
names/value-sets a correct extraction must produce — hand-verified once against a real,
known-successful extraction (not derived mechanically from `eval/answer-keys.json`, whose own
shape varies too much per puzzle to parse generically). This is a non-breaking frontmatter
extension per [ADR-001](../design/adr/ADR-001-catalog-format-seeding.md) §2.1, distinct from
that ADR's still-reserved `solution` field: `groundTruth` describes the *schema* a vocabulary-
construction stage should produce (used to score SPIKE-013's `llm-only`/`chunked-inventory`/
`embedded-group` variants), not the puzzle's actual answer/assignment.

```yaml
groundTruth:
  entityAxisSize: 5    # size of the primary entity axis clues reference by identity
  domains:
    - alternatives:                          # one or more mutually exclusive valid framings —
        - names: [color]                     # a domain matches if it fully matches ANY ONE
          values: [Yellow, Blue, Red, Ivory, Green]  # alternative's OWN (names, values) pair
```

Scoring is coverage-only: every listed domain must be found, matching one whole `alternatives`
entry — a produced vocabulary with *extra* domains beyond what's listed is never penalized
(mirrors ADR-007 §2.2's "subset, not exact match" lesson).

**Each `alternatives` entry is one atomic (names, values) pair — never matched independently.**
`names` may list more than one acceptable spelling *for that same entry's values* (PZL-0001's
`cigarette`/`smoke`, PZL-0011's `outcome`/`decision`), since every spelling maps to the identical
value set there. A domain that can legitimately be modeled two structurally different ways
(PZL-0038: entities-as-animals with a `pen` domain ranging 1-5, or entities-as-pens with an
`animal` domain) needs two separate `alternatives` entries, each pairing its own name with its
own values — pairing `pen` with the animal-name values, or `animal` with `1-5`, would be a
scrambled, invalid vocabulary. A flat cross-product of all names against all value-sets (the
original shape here) can't tell that scrambled combination apart from a valid one — confirmed
live (2026-09-16): a domain literally named `pen` holding the five animal names scored
`structurallyCorrect: true` under the old shape, purely because "pen" and the animal-name list
each appeared *somewhere* in truth, independently. Puzzles with more valid alternative vocabulary
shapes, or ones with plausible-but-wrong combinations worth guarding against, should add more
`alternatives` entries rather than widening any one entry's `names`/`values` — that's exactly
where real-world constraint problems (many valid encodings, most cross-combinations of which are
nonsense) get harder than this catalog's classic puzzles.

Currently populated for the 9 determinate puzzles SPIKE-013 hand-verified (PZL-0001, 0002, 0003,
0004, 0007, 0010, 0011, 0012, 0038); add it for others only after the same hand-verification the
format requires (step 4 below), not by guessing from the prose.

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
| [PZL-0016](puzzles/PZL-0016-five-houses-no-question.md) | Five Houses, No Question | 10/2/5 | hand-authored | seeded |
| [PZL-0017](puzzles/PZL-0017-the-bridge-collapse.md) | The Bridge Collapse | 0/0/0 | hand-authored | seeded |
| [PZL-0018](puzzles/PZL-0018-the-loudest-laugh.md) | The Loudest Laugh | 3/1/2 | hand-authored | seeded |
| [PZL-0019](puzzles/PZL-0019-office-tendencies.md) | Office Tendencies | 5/1/4 | hand-authored | seeded |
| [PZL-0020](puzzles/PZL-0020-featured-apartment.md) | Featured Apartment | 1/1/3 | hand-authored | seeded |
| [PZL-0021](puzzles/PZL-0021-which-house-is-yellow.md) | Which House Is Yellow | 5/1/1 | hand-authored | seeded |
| [PZL-0022](puzzles/PZL-0022-packing-the-box-wisely.md) | Packing the Box, Wisely | 5/1/2 | hand-authored | seeded |
| [PZL-0023](puzzles/PZL-0023-who-does-which-task.md) | Who Does Which Task | 4/1/1 | hand-authored | seeded |
| [PZL-0024](puzzles/PZL-0024-cheapest-adequate-meal.md) | Cheapest Adequate Meal | 3/1/2 | hand-authored | seeded |
| [PZL-0025](puzzles/PZL-0025-how-many-crates.md) | How Many Crates | 6/1/1 | hand-authored | seeded |
| [PZL-0026](puzzles/PZL-0026-which-candidates-to-interview.md) | Which Candidates to Interview | 5/1/1 | hand-authored | seeded |
| [PZL-0027](puzzles/PZL-0027-the-shortest-delivery-route.md) | The Shortest Delivery Route | 4/1/1 | hand-authored | seeded |
| [PZL-0028](puzzles/PZL-0028-the-green-house.md) | The Green House | 5/1/3 | hand-authored | seeded |
| [PZL-0029](puzzles/PZL-0029-between-ten-and-twelve.md) | Between Ten and Twelve | 5/1/4 | hand-authored | seeded |
| [PZL-0030](puzzles/PZL-0030-the-commute.md) | The Commute | 3/1/5 | hand-authored | seeded |
| [PZL-0031](puzzles/PZL-0031-the-cheapest-bike.md) | The Cheapest Bike | 4/1/3 | hand-authored | seeded |
| [PZL-0032](puzzles/PZL-0032-the-chemist-and-the-painter.md) | The Chemist and the Painter | 6/2/3 | hand-authored | seeded |
| [PZL-0033](puzzles/PZL-0033-groceries-in-the-trunk.md) | Groceries in the Trunk | 4/1/1 | hand-authored | seeded |
| [PZL-0034](puzzles/PZL-0034-the-evening-doses.md) | The Evening Doses | 3/1/2 | hand-authored | seeded |
| [PZL-0035](puzzles/PZL-0035-the-head-of-the-table.md) | The Head of the Table | 5/1/3 | hand-authored | seeded |
| [PZL-0036](puzzles/PZL-0036-the-cat-and-the-dog.md) | The Cat and the Dog | 4/1/4 | hand-authored | seeded |
| [PZL-0037](puzzles/PZL-0037-holding-pens.md) | Holding Pens | 5/1/5 | hand-authored | seeded |
| [PZL-0038](puzzles/PZL-0038-the-concrete-wall.md) | The Concrete Wall | 5/1/5 | hand-authored | seeded |
| [PZL-0039](puzzles/PZL-0039-the-supply-closet.md) | The Supply Closet | 5/1/5 | hand-authored | seeded |

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
4. Work out the expected outcome yourself first, and be explicit about which kind of outcome it
   is — no puzzle should be added without this check. The catalog deliberately spans more than
   determinate puzzles now, so "exactly one valid solution" is the right bar for only some of it:
   - **Determinate** — confirm it has **exactly one** valid solution.
   - **Non-problem** — confirm which condition of
     [RFC-004](../design/rfc/RFC-004-computational-decision-making.md) §5.1 it fails, and that
     no *lower* condition fails first (a failure attributed to the wrong condition is still a
     failure, per §5.7).
   - **Optimization** — confirm the optimum, and whether it is unique. Say so explicitly if the
     optimal *value* is unique but the arrangement achieving it isn't.
   - **Ambiguous** — confirm the competing readings give genuinely *different* results. An
     ambiguity that lands on the same answer either way tests nothing.
   - **Subjective** — confirm the outcome both with and without the premise the prose never
     states, so "correctly declined to invent it" stays distinguishable from "failed to solve."
5. Record that expected outcome in `eval/answer-keys.json` (a private file, not part of this
   public index — see that feature's spec for why). For anything other than a determinate
   puzzle that means a diagnosis, an optimum, a set of readings, or a with/without-premise pair
   rather than a single assignment; that file's own `$comment` explains why its shape is still
   provisional.
6. Add a row to the Index table above, and update `TODO.md`'s coverage table alongside it.
