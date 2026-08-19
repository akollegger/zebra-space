---

description: "Task list for Puzzle Catalog Seeding"
---

# Tasks: Puzzle Catalog Seeding

**Input**: Design documents from `/specs/001-catalog-seeding/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Included — the constitution's Design-First-Then-Test-First principle requires a
failing automated check before catalog content is added (plan.md's Constitution Check).

**Organization**: Tasks are grouped by user story (spec.md) to enable independent implementation
and testing of each story. Per the user's request when generating this list, User Story 1 also
makes room for authoring puzzles beyond the required minimum, collaboratively, using the same
steps — see T006/T007/T011.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths are relative to the repository root

---

## Phase 1: Setup

**Purpose**: Project initialization shared by all user stories

- [X] T001 Create the `catalog/puzzles/` directory at the repository root (e.g. via a placeholder
  `.gitkeep`, removed once real puzzle files land in Phase 3).
- [X] T002 [P] Create the `tests/catalog/` directory at the repository root.
- [X] T003 [P] Update `package.json`'s `"test"` script to `node --test tests/**/*.test.ts` (Node
  24's built-in test runner, per research.md's tooling decision — no new dependency; the glob
  form was needed because `node --test tests/` did not reliably auto-discover files in this Node
  version), replacing the current placeholder `echo "Error: no test specified" && exit 1`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared verification harness all three user stories are checked against

**⚠️ CRITICAL**: No user story is done until this phase's test passes for it

- [X] T004 Write `tests/catalog/catalog.test.ts` asserting, per quickstart.md and
  data-model.md: (SC-001) `catalog/puzzles/` contains at least 3 files matching
  `PZL-\d{4}-.+\.md`; (SC-002) every matched file's frontmatter has all fields listed in
  data-model.md's Puzzle Catalog Entry table (`id`, `title`, `tier`, `variables`, `domains`,
  `constraints`, `source`, `difficulty`, `created`), each non-empty; (SC-003) `catalog/README.md`
  has exactly one table row per matched file and vice versa. Run `pnpm test` and confirm it
  **fails** (no catalog content exists yet) — satisfying test-first.

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 - Select a real puzzle from a non-empty catalog (Priority: P1) 🎯 MVP

**Goal**: `catalog/puzzles/` contains at least 3 real, complete puzzle files.

**Independent Test**: List `catalog/puzzles/` and open any file — it's a real, readable puzzle
with complete metadata, independent of the index (US2) or solvability re-verification (US3).

- [X] T005 [P] [US1] Author `catalog/puzzles/PZL-0001-life-international-1962.md`: transcribe the
  verbatim clues from research.md's "Canonical puzzle source text" section as the prose body,
  with frontmatter `id: PZL-0001`, `title: Life International 1962`, `tier: unknown`,
  `variables: 25`, `domains: 5`, `constraints: 14`, `source: https://en.wikipedia.org/wiki/Zebra_Puzzle`,
  `difficulty: unknown`, `created: 2026-08-11` (FR-002, FR-004).
- [X] T006 [P] [US1] *(added mid-implementation, not part of the original plan)* Author
  `catalog/puzzles/PZL-0002-context-graphs-example.md`: transcribe the "strict, explicit clues"
  example puzzle from the user's own blog post
  (https://medium.com/neo4j/context-graphs-agentic-decisions-9a125f22f411) — 3 houses × 2
  attribute categories, `variables: 6`, `domains: 2`, `constraints: 4`,
  `source: https://medium.com/neo4j/context-graphs-agentic-decisions-9a125f22f411`. Sourced, so
  it does NOT count toward FR-005's two-hand-authored requirement — see T007/T008.
- [X] T007 [P] [US1] Collaboratively author `catalog/puzzles/PZL-0003-rock-paper-scissors.md`
  with the user: a minimal single-variable CSP (`variables: 1`, `domains: 1`, `constraints: 4`)
  — three win/lose rules plus the opponent's fixed move as the constraint fixing the unique
  answer (`paper`), `source: null` (FR-002, FR-005).
- [X] T008 [P] [US1] Collaboratively author `catalog/puzzles/PZL-0004-whodunit.md` with the user:
  a Cluedo-style elimination puzzle (`variables: 3`, `domains: 3`, `constraints: 6`) — 3
  suspects/weapons/rooms narrowed by direct "it's not X" clues to a unique answer (Professor
  Plum, Candlestick, Conservatory), `source: null` (FR-002, FR-005). Treat T007/T008 as a
  repeatable pattern: additional puzzles beyond these two can be authored the same way, together,
  whenever there's an appetite to grow the catalog further (not required for this feature's
  completion).
- [X] T009 [US1] Record the confirmed solution for PZL-0001, PZL-0002, PZL-0003, and PZL-0004 in
  `eval/answer-keys.json`, one section per puzzle id, per data-model.md's
  Verification Answer Key entity (FR-009). Depends on T005-T008.
- [X] T010 [US1] Run `pnpm test`; confirm `tests/catalog/catalog.test.ts`'s SC-001 and SC-002
  assertions now pass (SC-003 is still expected to fail — no index yet).

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Browse the catalog without opening every file (Priority: P2)

**Goal**: `catalog/README.md` exists and accurately indexes every puzzle.

**Independent Test**: Open `catalog/README.md` alone and confirm it lists every file physically
present in `catalog/puzzles/`.

- [X] T011 [US2] Create `catalog/README.md` with a table (columns: Puzzle, Title, Size, Source,
  Status) containing one row per puzzle authored in T005-T008, per data-model.md's Catalog Index
  mapping — `Size` formatted `variables/domains/constraints`, `Source` as the URL or
  "hand-authored" when `null`, `Status` as `seeded` (FR-006, FR-007).
- [X] T012 [US2] Add an "Adding a puzzle" section to `catalog/README.md` documenting the
  repeatable steps used in T005-T009 (frontmatter schema, sizing convention, the private
  answer-key requirement, updating this index) so further puzzles can keep being authored
  collaboratively with the user beyond this feature's seed entries, without needing a new spec
  each time.
- [X] T013 [US2] Run `pnpm test`; confirm SC-001, SC-002, and SC-003 all pass.

**Checkpoint**: User Stories 1 and 2 both work independently.

---

## Phase 5: User Story 3 - Trust that a seed puzzle is actually solvable (Priority: P3)

**Goal**: Independent confirmation that every seed puzzle has exactly one valid solution.

**Independent Test**: Solve each puzzle by hand from its prose clues alone; confirm exactly one
assignment satisfies every clue.

- [X] T014 [US3] Independently re-solve each of PZL-0001, PZL-0002, PZL-0003, and PZL-0004 from
  their prose bodies alone (without consulting T009's answer key first), then compare your
  result against `eval/answer-keys.json`. If any puzzle yields zero or more
  than one solution, revise that puzzle file (and its answer-key entry) until exactly one holds
  (FR-008, SC-004, spec.md Edge Cases).

**Checkpoint**: All three user stories are independently functional; catalog is trustworthy.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T015 [P] Update `CLAUDE.md`'s "Project state" section: replace "a fresh scaffold with no
  application source code yet" with a note that `catalog/` (seeded puzzle content) and `tests/`
  (automated catalog checks) now exist.
- [X] T016 Run through `specs/001-catalog-seeding/quickstart.md` end-to-end (`pnpm test` plus the
  manual SC-004 steps) and confirm every step matches actual repo behavior.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories (the test must exist,
  and fail, before content is added).
- **User Story 1 (Phase 3)**: Depends on Foundational. No dependency on US2/US3.
- **User Story 2 (Phase 4)**: Depends on Foundational and on US1's puzzle files existing
  (T005-T008) to index them — not independent of US1's *content*, but independently testable
  once that content exists.
- **User Story 3 (Phase 5)**: Depends on Foundational and on US1's puzzle files and T009's answer
  keys existing to check against.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Parallel Opportunities

- T002, T003 (Phase 1) can run in parallel.
- T005, T006, T007, T008 (Phase 3) touch different puzzle files and can run in parallel —
  T007/T008's "collaborative with the user" nature makes them naturally sequential in a live
  session, but they have no file-level dependency on each other.
- T009 is NOT parallel with T005-T008 (depends on all four) and touches a single shared file
  (`answer-keys.json`), so its sections should be added sequentially even though they cover
  independent puzzles.
- T015 (Phase 6) can run in parallel with T016.

---

## Parallel Example: User Story 1

```bash
# After Phase 2 (Foundational) completes, author all four puzzle files together:
Task: "Author catalog/puzzles/PZL-0001-life-international-1962.md (T005)"
Task: "Transcribe catalog/puzzles/PZL-0002-context-graphs-example.md from the blog post (T006)"
Task: "Collaboratively author catalog/puzzles/PZL-0003-<short-name>.md with the user (T007)"
Task: "Collaboratively author catalog/puzzles/PZL-0004-<short-name>.md with the user (T008)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational — write the failing test).
2. Complete Phase 3 (User Story 1) — three real puzzle files plus their answer keys.
3. **STOP and VALIDATE**: `pnpm test` shows SC-001/SC-002 passing; catalog has usable content.

### Incremental Delivery

1. Setup + Foundational → failing test in place, proving test-first.
2. User Story 1 → non-empty, complete catalog (MVP).
3. User Story 2 → browsable index, plus the "Adding a puzzle" doc enabling ongoing collaborative
   authoring beyond the seed minimum.
4. User Story 3 → independent solvability confirmation closes out correctness.
5. Polish → repo-level docs and a full quickstart run.

## Notes

- [P] tasks touch different files with no dependency on each other.
- T007/T008 establish a repeatable, collaborative authoring pattern (documented for reuse in
  T012) — this feature's completion only requires the two puzzles named here, but nothing stops
  continuing to add more the same way afterward.
- T006 (PZL-0002, sourced from the user's blog) was added mid-implementation, beyond the four
  tasks originally planned — an example of exactly the "more than the required minimum,
  collaboratively" extensibility T007/T008/T012 were designed for.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a story independently.
