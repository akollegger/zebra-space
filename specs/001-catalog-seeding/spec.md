# Feature Specification: Puzzle Catalog Seeding

**Feature Branch**: `001-catalog-seeding`

**Created**: 2026-08-11

**Status**: Draft

**Input**: User description: "Populate the puzzle catalog as described in @design/adr/ADR-001-catalog-format-seeding.md: establish the catalog/puzzles/ directory with markdown+frontmatter files per the ADR's schema, seed it with the canonical 1962 Life International puzzle plus a small number of hand-authored classic-CSP puzzles, and create catalog/README.md as a living index (Puzzle | Title | Size | Source | Status)."

**Derived From**: ADR-001 (design/adr/ADR-001-catalog-format-seeding.md)

## Clarifications

### Session 2026-08-11

- Q: How should verification that a seed puzzle has exactly one valid solution be recorded, if at all? → A: A private answer-key artifact, kept outside the catalog schema, for reviewer verification only.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Select a real puzzle from a non-empty catalog (Priority: P1)

A developer building any of the other generation strategies (catalog modification,
generate-from-solution, scenario generation) needs at least a few real puzzle entries to select
from, modify, or use as a calibration reference — right now the catalog doesn't exist at all, so
none of that downstream work is testable end-to-end.

**Why this priority**: Every other generation strategy in RFC-001 either feeds into or draws
from this catalog. Without seed content, the catalog format itself (ADR-001) is unvalidated and
nothing downstream can be built or demonstrated.

**Independent Test**: Can be fully tested by listing `catalog/puzzles/` and opening any file —
it should be a real, readable puzzle with complete metadata, independent of any other feature.

**Acceptance Scenarios**:

1. **Given** the catalog has just been seeded, **When** a developer lists `catalog/puzzles/`,
   **Then** they find at least three puzzle files, each a single Markdown file with YAML
   frontmatter and a natural-language prose body.
2. **Given** any seed puzzle file, **When** a developer reads its frontmatter, **Then** every
   field required by ADR-001's schema (`id`, `title`, `tier`, `variables`, `domains`,
   `constraints`, `source`, `difficulty`, `created`) is present and populated (placeholder values
   like `tier: unknown` count as populated).

---

### User Story 2 - Browse the catalog without opening every file (Priority: P2)

A contributor or developer wants to see what's in the catalog — titles, rough size, provenance,
status — without opening each puzzle file individually.

**Why this priority**: Directly useful once User Story 1 exists, but browsability is a
convenience on top of the catalog actually containing content, not a precondition for it.

**Independent Test**: Can be fully tested by opening `catalog/README.md` alone and confirming it
lists every file physically present in `catalog/puzzles/`.

**Acceptance Scenarios**:

1. **Given** the seeded catalog, **When** a contributor opens `catalog/README.md`, **Then** they
   see one table row per puzzle file, with columns Puzzle, Title, Size, Source, Status.
2. **Given** the index and the directory listing, **When** they're compared, **Then** every
   puzzle file has exactly one corresponding index row and vice versa (no orphaned files, no
   stale rows).

---

### User Story 3 - Trust that a seed puzzle is actually solvable (Priority: P3)

A future solver-evaluation effort (or a person reading the catalog) needs each seed puzzle to be
a genuine, logically consistent zebra puzzle — one correct solution, not an internally
contradictory or under-constrained set of clues — even though this feature stores no formal
`solution` field yet (ADR-001 defers that to a future evaluation RFC).

**Why this priority**: Valuable and expected of "real" seed content, but the catalog's format
and browsability (User Stories 1–2) don't depend on this being independently verified first; it's
a quality bar on top of them.

**Independent Test**: Can be fully tested by manually solving each seed puzzle from its prose
clues alone and confirming exactly one assignment satisfies every clue.

**Acceptance Scenarios**:

1. **Given** any seed puzzle's prose body, **When** it is solved by hand from the clues alone,
   **Then** exactly one complete assignment of entities to attributes satisfies every clue (no
   puzzle is unsolvable or has more than one valid solution).

### Edge Cases

- What happens if the canonical puzzle's redistribution rights can't be confirmed? It MUST NOT be
  added until confirmed — ADR-001 (2.4) requires verifying licensing/redistribution rights before
  copying it in.
- What happens if a hand-authored puzzle turns out, on manual solving, to have zero or multiple
  valid solutions? It MUST be revised until it has exactly one, before being counted as seed
  content (User Story 3).
- How does a future contribution from another generation strategy (catalog modification,
  generate-from-solution, scenario generation) affect this feature? Out of scope here — this
  feature only establishes the initial seed set and the index format those future contributions
  will also use.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The catalog MUST exist as one Markdown file per puzzle under `catalog/puzzles/`,
  each named `PZL-NNNN-short-name.md` with `NNNN` zero-padded to 4 digits (max 9999) and
  sequential.
- **FR-002**: Each puzzle file MUST have YAML frontmatter containing `id`, `title`, `tier`,
  `variables`, `domains`, `constraints`, `source`, `difficulty`, and `created`, per ADR-001 §2.1.
  `tier` and `difficulty` MUST use their documented placeholder value (`unknown`) since neither
  taxonomy is settled yet.
- **FR-003**: Each puzzle file's body MUST be the puzzle as natural-language prose, in whatever
  form the author chose (no prescribed structure, per ADR-001 §2.1).
- **FR-004**: The catalog MUST include the canonical 1962 *Life International* zebra puzzle,
  transcribed into this format, with its `source` field citing the reference it was transcribed
  from, and with its public-domain/redistribution status confirmed before inclusion.
- **FR-005**: The catalog MUST include at least two additional hand-authored puzzles, each
  expressible as a classic CSP (per RFC-001's scope), with `source: null`.
- **FR-006**: The catalog MUST include a `catalog/README.md` index listing every puzzle file
  present, as a table with columns Puzzle, Title, Size, Source, Status.
- **FR-007**: The "Size" column in `catalog/README.md` MUST summarize a puzzle's `variables` /
  `domains` / `constraints` frontmatter values (e.g. `20/5/14`) rather than a subjective label.
- **FR-008**: Every seed puzzle MUST be manually confirmed to have exactly one valid solution
  before being counted as complete (no formal `solution` field is stored in the puzzle's public
  frontmatter; this is a manual authoring quality bar per User Story 3); verification is recorded
  per FR-009.
- **FR-009**: For each seed puzzle, a private answer-key artifact recording the correct
  assignment used to satisfy FR-008 MUST be produced and kept outside `catalog/` and outside any
  puzzle's public frontmatter (e.g. under `specs/001-catalog-seeding/`) — for reviewer
  verification only, not part of the public catalog schema (see Clarifications).

### Key Entities

- **Puzzle Catalog Entry**: One file under `catalog/puzzles/`. Represents a single puzzle:
  structured metadata (frontmatter) plus an unstructured natural-language prose body. Identified
  by a sequential `PZL-NNNN` id.
- **Catalog Index**: `catalog/README.md`. Represents the current, complete list of catalog
  entries as a single browsable table; one row per Puzzle Catalog Entry.
- **Verification Answer Key**: A private record of the correct assignment for one seed puzzle,
  used to confirm FR-008/SC-004. Not exposed via any puzzle's frontmatter or the public catalog.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `catalog/puzzles/` contains at least three puzzle files immediately after this
  feature is delivered.
- **SC-002**: 100% of seed puzzle entries have every frontmatter field required by ADR-001 §2.1
  present and non-empty (placeholders count as populated).
- **SC-003**: `catalog/README.md`'s row count exactly matches the number of files in
  `catalog/puzzles/`, with no orphaned files or stale rows.
- **SC-004**: 100% of seed puzzles have a private answer-key artifact (FR-009) confirming, by
  manual solving, exactly one valid solution.

## Assumptions

- "A small number of hand-authored puzzles" (ADR-001 §2.4) is interpreted as **two**, giving a
  seed catalog of three entries total (one canonical + two hand-authored) — enough to validate
  the format/index end-to-end without requiring a large authoring effort in this first pass.
  Growing the catalog further is expected via ADR-002/003/004 (RFC-001 Goals), not this feature.
- Hand-authored puzzles target a size comparable to the canonical puzzle (roughly 5 entities × 4
  attribute categories, classic-CSP tier), matching RFC-001's stated starting scope.
- The canonical puzzle's public-domain status is satisfied by its long-standing reproduction on
  Wikipedia and multiple independent puzzle sites without attribution restriction; no separate
  legal review is performed beyond citing that reproduction as `source`.
- No puzzle-selection *mechanism* (random pick, filtering, an API/CLI) is delivered by this
  feature — ADR-001 explicitly defers that to a follow-up ADR (its Consequences section); this
  feature only produces the substrate such a mechanism would read from.
- No public `solution` field is added to any puzzle's frontmatter, and no automated solver check
  is delivered by this feature — ADR-001 defers a public solution representation to a future
  evaluation-focused RFC. FR-008/SC-004 are instead satisfied by a private answer-key artifact
  (FR-009) produced during authoring, not by tooling.
