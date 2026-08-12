# Data Model: Puzzle Catalog Seeding

## Puzzle Catalog Entry

One file per puzzle, at `catalog/puzzles/PZL-NNNN-short-name.md` (ADR-001 §2.1, §2.2).

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | `PZL-NNNN`, matches the filename's id portion |
| `title` | string | yes | short descriptive title |
| `tier` | string | yes | placeholder value `unknown` — taxonomy not settled (RFC-001 Open Question 7.3) |
| `variables` | integer | yes | entities × attribute-categories (CSP-neutral count) |
| `domains` | integer | yes | count of distinct attribute categories |
| `constraints` | integer | yes | count of clues |
| `source` | string \| null | yes (may be `null`) | URL puzzle was transcribed/adapted from, or `null` for hand-authored |
| `difficulty` | string | yes | placeholder value `unknown` — no calibration exists yet |
| `created` | date (`YYYY-MM-DD`) | yes | authoring date |

Body: unstructured natural-language prose (the clues + framing), no prescribed layout (ADR-001
§2.1). Not modeled further here — it's prose, not data.

**Validation rules** (from FR-002, SC-002):
- Every field above MUST be present with a non-empty value (placeholders like `unknown` count as
  present).
- `id` MUST be unique across all entries and MUST match the `PZL-NNNN` portion of the filename.

## Catalog Index

`catalog/README.md` (ADR-001 §2.3) — one table, one row per Puzzle Catalog Entry.

| Column | Derived from |
|---|---|
| Puzzle | Entry's `id` (linked to its file) |
| Title | Entry's `title` |
| Size | Entry's `variables`/`domains`/`constraints`, formatted `V/D/C` (FR-007) |
| Source | Entry's `source` (or "hand-authored" when `null`) |
| Status | Fixed value `seeded` for entries produced by this feature |

**Validation rule** (FR-006, SC-003): row count MUST exactly equal the number of files in
`catalog/puzzles/`; every row's Puzzle id MUST resolve to an existing file and vice versa.

## Verification Answer Key

One private artifact per Puzzle Catalog Entry (FR-009), kept under
`specs/001-catalog-seeding/answer-keys.md` — **not** part of the public catalog schema, not
linked from `catalog/README.md`, and not referenced by any puzzle's frontmatter.

| Field | Notes |
|---|---|
| Puzzle id | which `PZL-NNNN` entry this verifies |
| Solution assignment | the correct entity↔attribute mapping used to confirm FR-008/SC-004 |

No formal schema beyond "one section per puzzle id containing its solution assignment" — this is
a reviewer-facing verification record, not a machine-read artifact (no solver consumes it; ADR-001
defers a real solution representation to a future evaluation RFC).

## Relationships

- Every Puzzle Catalog Entry has exactly one corresponding Catalog Index row (1:1).
- Every Puzzle Catalog Entry has exactly one corresponding Verification Answer Key entry (1:1),
  produced during authoring, never generated or read by any code path in this feature.
- No relationships exist between Puzzle Catalog Entries themselves — each is independent seed
  content (catalog modification/derivation relationships are out of scope; ADR-002+).
