---

description: "Task list for feature implementation"
---

# Tasks: CLI Interface

**Input**: Design documents from `/specs/003-cli-interface/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/cli-contract.md, quickstart.md

**Tests**: `tests/cli/cli.test.ts` is included — it's this feature's own contract per plan.md's
Constitution Check (Principle IV), spawning the built `bin` as a real subprocess rather than
importing internals, per `contracts/cli-contract.md`.

**Organization**: Tasks are grouped by user story (spec.md P1/P2/P3) to enable independent
implementation and testing of each.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Path Conventions

Single project (per plan.md's Project Structure): `src/cli/`, `tests/cli/` at repository root.

---

## Phase 1: Setup

**Purpose**: Get `@stricli/core` wired into a runnable entrypoint before any subcommand logic exists.

- [ ] T001 Add `"bin": { "zebra": "./src/cli/main.ts" }` to `package.json` (plan.md's Project Structure; `@stricli/core` dependency already added in ADR-003's revision)
- [ ] T002 Create `src/cli/main.ts` with `#!/usr/bin/env node` shebang, executable bit set (`chmod +x`), building an empty `buildRouteMap({ routes: {} })` passed to `buildApplication` and `run` (research.md Finding 1 & 2) — no subcommands yet, just confirms the entrypoint runs and `--help`/`--version` work
- [ ] T003 Verify `./src/cli/main.ts --help` and `./src/cli/main.ts --version` run directly with no build step (research.md Finding 1)

**Checkpoint**: A runnable `zebra` entrypoint exists with working top-level `--help`/`--version` and zero subcommands.

---

## Phase 2: Foundational

**Purpose**: Shared plumbing every user story's tests depend on — none of the user stories can be tested without a way to invoke the built CLI as a subprocess.

**⚠️ CRITICAL**: Must complete before any User Story phase below.

- [ ] T004 Create `tests/cli/cli.test.ts` with a shared helper that spawns `src/cli/main.ts` via `node:child_process.execFile` (or `node:child_process.spawn` if streaming is needed), capturing stdout/stderr/exit code, matching this repo's existing `node --test` + `Effect.runPromise` conventions from `tests/solver/solve.test.ts`

**Checkpoint**: Foundation ready — user story test/implementation work can begin.

---

## Phase 3: User Story 1 - Solve a puzzle from the command line (Priority: P1) 🎯 MVP

**Goal**: `zebra solve <model.mzn>` wraps the existing solve capability (`src/solver/solve.ts`), printing a human-readable outcome and exiting `0` for any resolved result, `1` only when solving itself fails.

**Independent Test**: Run the built CLI against `catalog/mzn/PZL-0004-whodunit.mzn` and against toy unsatisfiable/multiply-satisfiable/nonexistent-file inputs, confirming printed output and exit code per `contracts/cli-contract.md`.

### Tests for User Story 1

- [ ] T005 [P] [US1] SC-001 test in `tests/cli/cli.test.ts`: `zebra solve catalog/mzn/PZL-0004-whodunit.mzn` prints the unique solution (Professor Plum/Candlestick/Conservatory) and exits `0`
- [ ] T006 [P] [US1] SC-002 test in `tests/cli/cli.test.ts`: `zebra solve` against a toy unsatisfiable model (inline `.mzn` fixture, e.g. `var 1..2: x; constraint x > 5; solve satisfy;`) reports unsatisfiable and exits `0`
- [ ] T007 [P] [US1] SC-003 test in `tests/cli/cli.test.ts`: `zebra solve` against a toy multiply-satisfiable model reports multiple solutions and exits `0`
- [ ] T008 [P] [US1] SC-005 test in `tests/cli/cli.test.ts`: `zebra solve` against a nonexistent model file path prints an error on stderr and exits `1` (Edge Cases: treated as a solver failure)

### Implementation for User Story 1

- [ ] T009 [P] [US1] Refactor `src/solver/solve.ts` (plan.md's revision note, research.md Finding 4): extract the shared "write args, invoke `minizinc`, classify via `classifySolutions`, translate errors via `toSolverError`" logic into a private helper, then add a path-based sibling entrypoint `solveFile(request: SolveFileRequest): Effect.Effect<SolveResult, SolverError>` (new `SolveFileRequest` type in `src/solver/types.ts`: `{ modelPath: string; dataPath?: string; solverId?: string; maxSolutions?: number; timeoutMs?: number }`) that passes the given paths straight to the helper — no temp directory, no content buffering, no cleanup of files it doesn't own. The existing `solve()` keeps its own signature and behavior unchanged, delegating to the same helper after writing its content to a temp dir as it does today; `tests/solver/solve.test.ts` must keep passing unmodified
- [ ] T010 [US1] Create `src/cli/subcommands/solve.ts`: `buildCommand` with a required `model` positional (file path) and optional `--data <file>`/`--solver <id>` flags (per `contracts/cli-contract.md`'s Invocation shape and FR-002), whose `func` calls `solveFile({ modelPath, dataPath, solverId })` from `../../solver/solve.ts` (T009) directly with the given paths — no file reads in this subcommand itself
- [ ] T011 [US1] In `src/cli/subcommands/solve.ts`, render the human-readable form of `SolveResult` (FR-004): unsatisfiable, uniquely solvable (with the solution shown), or multiply satisfiable — wording is this task's own choice per spec.md's Assumptions
- [ ] T012 [US1] In `src/cli/subcommands/solve.ts`, run `solveFile()`'s `Effect` to completion via `Effect.runPromise`, letting a rejected/failed `Effect` (a `SolverError`) propagate as a thrown error from the command's `func` so Stricli maps it to `CommandRunError` → exit `1` (FR-006/FR-007, research.md Finding 3) — every resolved `SolveResult` variant instead completes normally and exits `0`
- [ ] T013 [US1] Register the `solve` command in `src/cli/main.ts`'s route map (replacing the empty one from T002), per `buildRouteMap`/`buildApplication` (ADR-003 §2.3)

**Checkpoint**: User Story 1 fully functional and testable independently — `zebra solve` works end-to-end for all four acceptance scenarios.

---

## Phase 4: User Story 2 - Get machine-readable output for scripting (Priority: P2)

**Goal**: `--json` on `solve` prints the same `SolveResult` as structured JSON instead of the human-readable form.

**Independent Test**: Run the CLI with `--json` against each of User Story 1's model cases and confirm the output parses as JSON matching `SolveResult`'s shape.

### Tests for User Story 2

- [ ] T014 [P] [US2] SC-004 test in `tests/cli/cli.test.ts`: `zebra solve <model> --json` for the unique/unsatisfiable/multiply-satisfiable cases each produce valid, parseable JSON matching the underlying `SolveResult` (`JSON.parse` the stdout, assert on `_tag`/`assignment`/`assignments`)

### Implementation for User Story 2

- [ ] T015 [US2] Add a `--json` boolean flag to `src/cli/subcommands/solve.ts`'s `buildCommand` parameter definitions (FR-005)
- [ ] T016 [US2] In `src/cli/subcommands/solve.ts`, when `--json` is set, print `JSON.stringify(result)` instead of the human-readable render from T011 — same `SolveResult`, no separate schema (`contracts/cli-contract.md`)

**Checkpoint**: User Stories 1 and 2 both work independently — `--json` is a pure alternate rendering of the same result.

---

## Phase 5: User Story 3 - Discover how to use the tool without external docs (Priority: P3)

**Goal**: Top-level `--help`, per-subcommand `--help`, `--version`, and unknown-subcommand handling all work without needing MiniZinc installed or `solveFile()` ever invoked.

**Independent Test**: Run help/version/unknown-subcommand invocations alone and confirm useful, non-empty output and correct exit codes, with no solver process spawned.

### Tests for User Story 3

- [ ] T017 [P] [US3] SC-006 test in `tests/cli/cli.test.ts`: `zebra --help` lists `solve` among available subcommands
- [ ] T018 [P] [US3] SC-006 test in `tests/cli/cli.test.ts`: `zebra solve --help` shows `solve`'s own model/`--data`/`--solver`/`--json` arguments, independent of top-level help
- [ ] T019 [P] [US3] SC-006 test in `tests/cli/cli.test.ts`: `zebra --version` prints a non-empty version string
- [ ] T020 [P] [US3] SC-007 test in `tests/cli/cli.test.ts`: `zebra bogus-subcommand` lists available subcommands and exits `251` (`UnknownCommand`, per `contracts/cli-contract.md` — not `1`)

### Implementation for User Story 3

- [ ] T021 [US3] Set `buildApplication`'s `name`/`version` config in `src/cli/main.ts` from `package.json`'s own `version` field (FR-010) — Stricli's built-in `--help`/`-h`/`--version`/`-v` and unknown-command handling (research.md Finding 2 & 3) require no further hand-written logic once this and the route map (T013) exist

**Checkpoint**: All three user stories independently functional — the full spec.md acceptance-scenario set passes.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation against the feature's own quickstart and success criteria.

- [ ] T022 [P] Run `pnpm test` and confirm all `tests/cli/cli.test.ts` cases pass alongside the existing `tests/solver/`/`tests/catalog/` suites
- [ ] T023 Run `quickstart.md`'s manual checks end-to-end against `catalog/mzn/PZL-0004-whodunit.mzn`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup (needs a built entrypoint to spawn) — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational. No dependency on US2/US3.
- **User Story 2 (Phase 4)**: Depends on Foundational and on US1's `src/cli/subcommands/solve.ts` existing (adds a flag to it) — not independently implementable before US1, but independently *testable* once both exist.
- **User Story 3 (Phase 5)**: Depends on Foundational and on US1's route-map registration (T013) existing so `--help` has a subcommand to list — otherwise independent of US1/US2's solve-specific logic.
- **Polish (Phase 6)**: Depends on all desired user stories being complete.

### Within Each User Story

- Tests before implementation (write first, confirm they fail against the pre-implementation CLI).
- `solve.ts`'s `solveFile()` refactor (T009) before the subcommand's own definition (T010), before its rendering/exit-code logic (T011/T012), before route-map registration (T013).

### Parallel Opportunities

- All Phase 3/4/5 test tasks marked [P] target the same file (`tests/cli/cli.test.ts`) but independent `test()` blocks — safe to write in parallel, sequence only matters if the harness helper (T004) isn't done yet.
- T005–T008 (US1 tests) can be written in parallel with each other once T004 lands, and in parallel with T009 (US1's `solveFile()` refactor — a different file, `src/solver/solve.ts`).
- T016–T019 (US3 tests) can be written in parallel with each other and don't depend on US2 at all.

---

## Parallel Example: User Story 1

```bash
# After T004 (test harness) is done, launch these together — different files, no dependencies:
Task: "SC-001 test: zebra solve catalog/mzn/PZL-0004-whodunit.mzn"
Task: "SC-002 test: zebra solve against toy unsatisfiable model"
Task: "SC-003 test: zebra solve against toy multiply-satisfiable model"
Task: "SC-005 test: zebra solve against nonexistent file"
Task: "Refactor src/solver/solve.ts to add solveFile()"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: `zebra solve` works end-to-end against real and toy models.
5. This alone satisfies spec.md's stated reason the CLI exists.

### Incremental Delivery

1. Setup + Foundational → runnable entrypoint, test harness ready.
2. Add User Story 1 → validate independently → usable CLI (MVP!).
3. Add User Story 2 → validate independently → scriptable via `--json`.
4. Add User Story 3 → validate independently → self-discoverable via `--help`/`--version`.
5. Polish → full `pnpm test` + quickstart pass.

## Notes

- [P] tasks touch different files, or independent test blocks within the same test file.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a story independently.
- `solve()`'s existing signature and behavior (`src/solver/solve.ts`) are unchanged by this
  feature's additive `solveFile()` refactor (T009) — no solving logic is duplicated between the
  two entrypoints, per FR-003.
