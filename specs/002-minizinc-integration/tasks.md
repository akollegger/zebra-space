---

description: "Task list for MiniZinc Solver Integration"
---

# Tasks: MiniZinc Solver Integration

**Input**: Design documents from `/specs/002-minizinc-integration/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/solve-contract.md,
quickstart.md

**Tests**: Included — the constitution's Design-First-Then-Test-First principle requires a
failing test before the `solve` capability exists (plan.md's Constitution Check).

**Organization**: Tasks are grouped by user story (spec.md) to enable independent implementation
and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths are relative to the repository root

---

## Phase 1: Setup

**Purpose**: Project initialization shared by all user stories

- [X] T001 ~~Add `@effect/platform` and `@effect/platform-node`~~ — **deviation from plan.md**:
  `@effect/platform@0.97.1` (the only stable release) peer-depends on `effect@^3.22.1`, which is
  incompatible with this repo's pinned `effect@4.0.0-beta.107` (confirmed by a broken nested
  install — `FiberRef.js` missing — when actually run). The only compatible build is an unstable
  per-commit snapshot requiring the whole repo's `effect` to also move to a matching snapshot —
  out of scope for this feature. Removed both packages; T008 instead wraps `node:child_process`
  by hand in an `Effect`, preserving the constitution's actual Effect-Idiomatic Code intent
  (Effect pipelines, typed errors, no thrown exceptions) without the specific module ADR-002
  §2.3 named. Flagged as a documented deviation on that ADR, not silently substituted.
- [X] T002 [P] Create the `src/solver/` directory at the repository root.
- [X] T003 [P] Create the `tests/solver/` directory at the repository root.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types and the failing test all three user stories are checked against

**⚠️ CRITICAL**: No user story is done until this phase's test passes for it

- [X] T004 Define `src/solver/types.ts`: `SolveRequest`, the `SolveResult` discriminated union
  (`Unsatisfiable`, `UniquelySolvable`, `MultiplySatisfiable`), and the `SolverError` union
  (`ToolchainUnavailable`, `ModelSyntaxError`, `SolverConfigError`, `Timeout`, `UnexpectedExit`)
  — per data-model.md. Types only, no logic yet.
- [X] T005 Write `scripts/setup-minizinc-solver.sh`: check `minizinc --version`, check
  `minizinc --solvers` for a `cp`-tagged solver, and if Gecode is installed but unregistered,
  write a `.msc` file to `minizinc --config-dirs`'s `userSolverConfigDir` (research.md Finding
  1; mirrors the `.agents/skills/minizinc-setup` skill's logic as a non-interactive script).
  Verified idempotent: running it against this already-registered machine correctly detects the
  existing Gecode solver and exits early without rewriting anything.
- [ ] T006 Write `tests/solver/solve.test.ts` covering SC-001 (an inline unsatisfiable toy model
  → `Unsatisfiable`), SC-002 (an inline uniquely-solvable toy model → `UniquelySolvable` with the
  correct assignment), SC-003 (an inline multiply-satisfiable toy model → `MultiplySatisfiable`,
  asserting no more than 2 solutions are ever requested), and SC-005 (no files left in the OS
  temp directory after each attempt, success or failure) — importing a not-yet-existing
  `solve` from `src/solver/solve.ts`. Run `pnpm test` and confirm it **fails** (module doesn't
  exist) — satisfying test-first.

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 - Check whether a puzzle is solvable, and how (Priority: P1) 🎯 MVP

**Goal**: Submitting a MiniZinc model returns a correctly classified result: unsatisfiable,
uniquely solvable, or multiply satisfiable.

**Independent Test**: Submit three small hand-written models (one of each outcome) and confirm
each is classified correctly (spec.md's own Acceptance Scenarios).

- [X] T007 [US1] Implement `src/solver/parse.ts`: classify solver stdout per research.md Finding
  2 — the literal `=====UNSATISFIABLE=====` marker means `Unsatisfiable`; otherwise, count the
  `----------`-separated JSON solution objects (0, 1, or 2) to determine
  `UniquelySolvable`/`MultiplySatisfiable`, parsing each JSON object into the assignment shape
  (FR-002, FR-004). Also filters out the `==========` search-complete marker (research.md
  Finding 5, discovered by this task's own tests) before parsing.
- [X] T008 [US1] Implement `src/solver/solve.ts`: the `solve` Effect per
  `contracts/solve-contract.md` — write `model`/`data` to a temp directory
  (`node:fs/promises` `mkdtemp` over `os.tmpdir()`, research.md's temp-file decision), invoke
  `minizinc -n 2 --output-mode json --solver <solverId>` via `node:child_process`'s `execFile`
  wrapped in an `Effect` (deviation from plan — see T001), capture stdout and pass it to
  `parse.ts` (T007), map non-zero exits to the appropriate `SolverError` variant (FR-006), and
  remove the temp directory in all cases — success or failure (FR-005).
- [X] T009 [US1] Run `pnpm test`; confirm `tests/solver/solve.test.ts`'s SC-001, SC-002, SC-003,
  and SC-005 assertions now pass.

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Get a usable answer back, not an opaque one (Priority: P2)

**Goal**: A uniquely-solvable result's assignment is keyed by the model's own variable names.

**Independent Test**: Submit a solvable model and confirm the returned solution's variable
names match the model's own names, with correct values.

- [X] T010 [US2] Add an assertion to `tests/solver/solve.test.ts` confirming the `UniquelySolvable`
  result from T006's toy model has `assignment` keys exactly matching that model's declared
  variable names — not anonymous positions or indices (FR-004). Used a two-variable model
  (`favoriteColor`/`luckyNumber`) rather than the single-`x` toy models, so the assertion can't
  pass by coincidence.
- [X] T011 [US2] Run `pnpm test`; confirm the new assertion passes. It already passed without
  changes to `solve.ts`/`parse.ts` — confirming T007/T008 already satisfy this guarantee; the
  point of this phase was making it an explicit, tested contract rather than an incidental fact.

**Checkpoint**: User Stories 1 and 2 both work independently.

---

## Phase 5: User Story 3 - See it actually work on a real catalog puzzle (Priority: P3)

**Goal**: A hand-translated real catalog puzzle solves correctly through this capability.

**Independent Test**: Run the seeded example through this capability and compare its result
against that puzzle's existing recorded answer.

- [X] T012 [US3] Hand-translate `catalog/puzzles/PZL-0004-whodunit.md` into
  `catalog/mzn/PZL-0004-whodunit.mzn`: three MiniZinc `enum`-typed variables (`culprit`,
  `weapon`, `room`), narrowed by the puzzle's 6 direct exclusion clues (`!=` comparisons only —
  no `all_different` needed, per research.md Finding 4) (FR-007, FR-008).
- [X] T013 [US3] Write `tests/solver/catalog-examples.test.ts`: run
  `catalog/mzn/PZL-0004-whodunit.mzn` through `solve()` and assert the result is
  `UniquelySolvable` with an assignment matching `specs/001-catalog-seeding/answer-keys.md`'s
  `PZL-0004` entry (Professor Plum, Candlestick, Conservatory) exactly — accounting for
  research.md Finding 6's `{ e: "Name" }` enum-wrapping in the JSON output (FR-009, SC-004).
- [X] T014 [US3] Run `pnpm test`; confirm this new test passes.

**Checkpoint**: All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T015 [P] Update `CLAUDE.md`'s Commands section: document the MiniZinc + Gecode
  prerequisite and point to `scripts/setup-minizinc-solver.sh` (FR-010). Also updated Project
  state and Key dependencies to reflect `src/solver/`, `catalog/mzn/`, and the
  `@effect/platform` deviation.
- [X] T016 [P] Add `catalog/mzn/README.md` documenting the example-catalog convention (one
  `.mzn` per corresponding `catalog/puzzles/` entry, hand-translated, no `all_different`
  mis-citation this time) per ADR-002 §2.6.
- [X] T017 Run through `specs/002-minizinc-integration/quickstart.md` end-to-end (`pnpm test`
  plus the manual smoke-test command) and confirm every step matches actual repo behavior.
  Updated the Prerequisites section to point at `scripts/setup-minizinc-solver.sh` (T005) rather
  than describing the manual `.msc` steps inline.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories (types must exist and
  the test must exist and fail before implementation begins).
- **User Story 1 (Phase 3)**: Depends on Foundational. No dependency on US2/US3.
- **User Story 2 (Phase 4)**: Depends on US1's `solve`/`parse` implementation existing — not
  independent of US1's *content*, but independently testable and could reveal a real gap in
  T007/T008 rather than just confirming one.
- **User Story 3 (Phase 5)**: Depends on US1's `solve` implementation existing to run the seeded
  example through.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Parallel Opportunities

- T002, T003 (Phase 1) can run in parallel.
- T015, T016 (Phase 6) can run in parallel with each other and with T017.
- T007 and T012 touch different files (`src/solver/parse.ts` vs. `catalog/mzn/*.mzn`) and have
  no dependency on each other, so US1's parsing work and US3's hand-translation could proceed
  side by side — T013/T014 (running the example through `solve()`) still need T008 finished first.

---

## Parallel Example: Setup

```bash
Task: "Create src/solver/ directory (T002)"
Task: "Create tests/solver/ directory (T003)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational — types + the failing test).
2. Complete Phase 3 (User Story 1) — classification works for all three outcomes.
3. **STOP and VALIDATE**: `pnpm test` shows SC-001/002/003/005 passing.

### Incremental Delivery

1. Setup + Foundational → failing test in place, proving test-first.
2. User Story 1 → classification capability (MVP).
3. User Story 2 → the classification's usability guarantee made explicit and tested.
4. User Story 3 → proof against a real catalog puzzle, closing the loop back to
   `specs/001-catalog-seeding/answer-keys.md`.
5. Polish → docs and a full quickstart run.

## Notes

- [P] tasks touch different files with no dependency on each other.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a story independently.
- research.md Finding 4 (ADR-002 §2.5's `all_different` mis-citation) is a documentation
  correction to raise separately against ADR-002 — not a task in this list, since it doesn't
  block this feature.
