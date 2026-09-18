---

description: "Task list for Shared String-Equivalence Matching"
---

# Tasks: Shared String-Equivalence Matching

**Input**: Design documents from `/specs/007-string-equivalence-matching/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md — all present.

**Tests**: Included and test-first, per Constitution Principle IV (Design-First, Then Test-First)
— every implementation task below has a corresponding test task that must be written and
observed failing first.

**Organization**: Tasks are grouped by user story (spec.md's US1/US2/US3) to enable independent
verification of each. Per the resolved specification clarification (option A), SPIKE-013 and
SPIKE-015's own call sites are explicitly out of scope — no task touches them.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1, US2, or US3 — omitted for Setup, Foundational, and Polish tasks

## Path Conventions

Single project — `src/`, `scripts/`, `design/spikes/`, `tests/` at repository root, per
plan.md's Project Structure.

---

## Phase 1: Setup

**Purpose**: Establish a regression baseline before touching shared, already-tested code.

- [X] T001 Run `pnpm test -- tests/eval/grader.test.ts` and record the current passing test
  count as the pre-change baseline (referenced by T009's regression check). — 24/24 passing.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared mechanism itself — every user story depends on it.

**⚠️ CRITICAL**: No user story task may start until this phase is complete.

- [X] T002 [P] Add a failing test to `tests/eval/grader.test.ts`: the pluralization fold inside
  `comparisonKey` (exercised through the exported `normalizeToken`, since `comparisonKey` itself
  is private) — `normalizeToken("moves", {}).normalized === normalizeToken("move", {}).normalized`.
  — confirmed failing (`'moves' !== 'move'`) before implementing T003.
- [X] T003 Implement the pluralization fold (a single trailing `s` strip, guarded against `ss`
  and a stem shorter than 3 characters) inside `comparisonKey` in `src/eval/grader.ts`, making
  T002 pass. (depends on T002) — 25/25 passing.
- [X] T004 [P] Add failing tests to new file `tests/eval/aliases.test.ts`: `loadAnswerValueAliases()`
  reads `eval/aliases.json` and returns its existing `"hardcover book set"` entry;
  `stringsMatch("Hardcover Book Set", "book_set", {"hardcover book set": ["book_set"]})` is
  `true`; `stringsMatch("Red", "Bed")` is `false`. — confirmed failing (module not found).
- [X] T005 Implement `src/eval/aliases.ts`, exporting `loadAnswerValueAliases(): Promise<AliasTable>`
  (the one loader for `eval/aliases.json`) and `stringsMatch(a, b, aliases = {})` (built on
  `grader.ts`'s existing `normalizeToken`, per research.md Decision 1 — no new comparison logic),
  making T004 pass. (depends on T004, T003)
- [X] T006 Run `pnpm test -- tests/eval/grader.test.ts tests/eval/aliases.test.ts` and confirm
  every test passes, including T001's baseline cases, unchanged. (depends on T003, T005) —
  28/28 passing (25 + 3).

**Checkpoint**: The shared mechanism (fold + loader + `stringsMatch`) exists and is tested — all
three user stories can now proceed.

---

## Phase 3: User Story 1 - Trust a MATCH/MISMATCH verdict without a false rejection (Priority: P1) 🎯 MVP

**Goal**: A known correct answer spelled two different ways matches — whether checked through
the production grader or through a domain-name-style comparison — using the same underlying
logic, per spec.md's Acceptance Scenarios 1-3.

**Independent Test**: Feed a known correct answer, spelled two ways, through both `stringsMatch`
directly and `grader.ts`'s existing grading functions; both report a match via the same
comparison logic.

### Tests for User Story 1 ⚠️

- [X] T007 [P] [US1] Add a test to `tests/eval/aliases.test.ts`: `stringsMatch` confirms a known
  correct answer spelled two ways matches (mirrors `quickstart.md`), and a genuinely different
  value does not.
- [X] T008 [US1] Add a test to `tests/eval/aliases.test.ts`: given a domain-name-shaped
  `AliasTable` (e.g. `{"move": ["game move", "moves"]}`), `stringsMatch` matches `"game move"`
  and `"moves"` against `"move"` — proving the SAME function serves both the answer-value case
  (T007) and a domain-name-matching-shaped case, the exact gap SPIKE-015 §5.2 found. (depends on
  T005) — also confirms "action" (genuine synonym) correctly does NOT match, per spec.md's edge
  case.

### Verification for User Story 1

- [X] T009 [US1] Run `pnpm test -- tests/eval/grader.test.ts` and confirm every existing
  determinate-answer grading test (`gradeDeterminate`, `gradeSubset`, `gradeFlatRecord`,
  `gradeRowKeyedMapping`, `gradeParallelArrays`) still passes unchanged — FR-009's regression
  guarantee. (depends on T003) — confirmed, all pass unchanged.

**Checkpoint**: User Story 1 is independently verified — the shared mechanism produces correct,
consistent verdicts.

---

## Phase 4: User Story 2 - Reuse the same matching logic when building a new scoring script (Priority: P2)

**Goal**: The two duplicated `loadAliases()` implementations collapse to one, proving a real
second consumer needs zero new comparison code (spec.md SC-001, SC-002).

**Independent Test**: Confirm exactly one loader implementation exists, and both prior call
sites now import it.

### Implementation for User Story 2

- [X] T010 [P] [US2] In `scripts/eval-extraction.ts`, remove the local `loadAliases()` function;
  import and call `loadAnswerValueAliases` from `src/eval/aliases.ts` instead. (`ALIASES_PATH`
  kept — still used separately to read the alias file's `version` field for run metadata.)
  (depends on T005)
- [X] T011 [P] [US2] In `design/spikes/SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts`,
  remove the local `loadAliases()` function and `ALIASES_PATH` constant; re-export
  `loadAnswerValueAliases` from `src/eval/aliases.ts` under the same `loadAliases` name (unused
  by any current call site, per a repo-wide grep, but kept for import compatibility). (depends
  on T005)

### Verification for User Story 2

- [X] T012 [US2] Run `grep -rn "async function loadAliases" scripts/ design/spikes/` and confirm
  zero matches (SC-002). (depends on T010, T011) — confirmed, zero matches.
- [X] T013 [US2] Run `pnpm test` (full suite) and confirm no regression from either migration.
  (depends on T010, T011) — 205/206 passing (1 skipped, unchanged), `pnpm typecheck` clean.

**Checkpoint**: User Story 2 is independently verified — loader duplication is eliminated.

---

## Phase 5: User Story 3 - Grow the list of acceptable variants without losing the audit trail (Priority: P3)

**Goal**: Confirm the shared mechanism never lets a similarity signal silently decide a match
(spec.md FR-006, SC-003).

**Independent Test**: A similarity-plausible but unlisted pair still reports no match; only an
explicit alias-table entry changes the outcome.

### Tests for User Story 3

- [X] T014 [P] [US3] Add a test to `tests/eval/aliases.test.ts`: two strings with no fold-equal
  key and no alias-table entry (however superficially similar) return `false` from
  `stringsMatch` — confirming no embedding/edit-distance/model-judgment step is consulted.
  (depends on T005)

### Verification for User Story 3

- [X] T015 [US3] Run `grep -rn "embeddingSemanticMatch\|nameResembles" src/eval/` and confirm
  zero matches — no fuzzy heuristic from either prior spike was pulled into the shared,
  production-facing module (FR-006). (depends on T005) — confirmed, zero matches.

**Checkpoint**: User Story 3 is independently verified — the audit-trail guarantee holds.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final quality gates across the whole feature.

- [X] T016 [P] Run `pnpm lint` and fix any findings in `src/eval/aliases.ts` and
  `src/eval/grader.ts` (Constitution Principle V). — Zero findings across all 6 files this
  feature touched (pre-existing findings elsewhere in the repo are unrelated to this feature).
- [X] T017 [P] Update `comparisonKey`'s docstring comment in `src/eval/grader.ts` to name the new
  pluralization fold, matching this project's convention of documenting non-obvious fold
  behavior (the existing SPIKE-014 §5.7 citation already there). — done as part of T003.
- [X] T018 Run every command in `quickstart.md` end-to-end and confirm each expected result
  matches. — all 5 checks matched their documented expected results exactly.
- [X] T019 Run the full `pnpm test` suite one final time and confirm the same pass/skip count as
  before this feature (200+/201 passing, 1 skipped without `OPENROUTER_API_KEY`). — 206/207
  (206 passing, 1 skipped) — the +6 over the original 200 are this feature's own new tests.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup (T001 baseline) — BLOCKS all user stories.
- **User Stories (Phase 3-5)**: All depend on Foundational (T003, T005) completion. US1, US2,
  and US3 do not depend on each other and may proceed in any order or in parallel.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each Phase

- Tests are written and observed failing before the implementation task that makes them pass
  (T002→T003, T004→T005, T007/T008 before US1 is considered done, T014 before US3 is).
- Verification tasks (grep/full-suite checks) run only after their phase's implementation tasks.

### Parallel Opportunities

- T002 and T004 (Foundational tests) can be written in parallel — different files.
- T010 and T011 (US2's two call-site migrations) can proceed in parallel — different files,
  both depending only on T005.
- Once Foundational (Phase 2) is complete, US1, US2, and US3 can all proceed in parallel.

---

## Parallel Example: Foundational Phase

```bash
# Write both Foundational test files together (different files, no dependency between them):
Task: "Add failing pluralization-fold test to tests/eval/grader.test.ts"
Task: "Add failing loader/stringsMatch tests to tests/eval/aliases.test.ts"
```

## Parallel Example: User Story 2

```bash
# Migrate both duplicated loaders together (different files, same dependency on T005):
Task: "Migrate scripts/eval-extraction.ts to import loadAnswerValueAliases"
Task: "Migrate SPIKE-008's puzzles.ts to import loadAnswerValueAliases"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational) — the shared mechanism.
2. Complete Phase 3 (User Story 1) — verify correctness and consistency.
3. **STOP and VALIDATE**: `pnpm test -- tests/eval/grader.test.ts tests/eval/aliases.test.ts`
   all green, no regression.

### Incremental Delivery

1. Setup + Foundational → the shared mechanism exists and is tested.
2. Add User Story 1 → verify correctness → this alone already satisfies SC-004/SC-005.
3. Add User Story 2 → verify → duplication eliminated (SC-002).
4. Add User Story 3 → verify → audit-trail guarantee confirmed (SC-003).
5. Polish → lint, docs, full quickstart, final full-suite run.

## Notes

- No task touches `design/spikes/SPIKE-013-vocabulary-construction-isolation/` or
  `design/spikes/SPIKE-015-domain-substitution/` — explicitly deferred, per spec.md's resolved
  clarification (option A).
- Every task names an exact file path per this project's own convention.
