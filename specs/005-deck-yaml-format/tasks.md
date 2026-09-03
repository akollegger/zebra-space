---

description: "Task list for Deck YAML Format Library Support"
---

# Tasks: Deck YAML Format Library Support

**Input**: Design documents from `/specs/005-deck-yaml-format/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included and REQUIRED — Constitution Principle IV (Design-First, Then Test-First)
mandates writing a failing test before the code that makes it pass, for every user story below.

**Organization**: Tasks are grouped by user story (spec.md) to enable independent implementation
and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Every task names its exact file path

## Path Conventions

Single project (plan.md's Structure Decision): `src/deck/`, `src/cli/subcommands/`, `tests/deck/`
at repository root — no new top-level directory.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Bring in the one new dependency this feature needs before any code references it.

- [ ] T001 Add the `yaml` runtime dependency (research.md Finding 1) via `pnpm add yaml`,
      updating `package.json` and `pnpm-lock.yaml`

**Checkpoint**: `yaml` is importable from any new file.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared types and shared fixture every user story's tests and implementation
depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T002 Define `Deck`, `Brief`, `Csp`, `Constraint` (the 9-shape union mirroring
      `ExtractedConstraint`), `Card`, `Closure`, `CardClassification`, `SolvedDeck`, and
      `DeckError` in `src/deck/types.ts` (data-model.md), importing `ArithmeticExpression`,
      `DerivedCondition`, and `RuleTableOperand` directly from `src/extraction/types.ts` rather
      than redefining them
- [ ] T003 [P] Create `tests/deck/fixtures/valid-deck.yaml`: a small (3-entity), uniquely
      solvable deck matching ADR-006 §2.1's schema exactly — reused by US1 (accepted as
      structurally valid), US2 (solved uniquely), and US3 (classified and answered)

**Checkpoint**: Foundation ready — `src/deck/types.ts` compiles; `valid-deck.yaml` exists.
User story implementation can now begin.

---

## Phase 3: User Story 1 - Author a deck and know it's structurally sound (Priority: P1) 🎯 MVP

**Goal**: Reject a structurally unsound deck document (dangling reference, dependency cycle,
unsupported tier or constraint kind) before any attempt to solve it, naming the specific problem.

**Independent Test**: Run `loadDeck`/`loadDeckFile` against `valid-deck.yaml` and against each
malformed fixture below; confirm acceptance vs. a specific, correctly-typed `DeckError` in each
case — no solver involved.

### Tests for User Story 1 ⚠️

> Write these tests FIRST; confirm they fail (no `src/deck/load.ts` exists yet) before Implementation.

- [ ] T004 [P] [US1] Write a test in `tests/deck/load.test.ts` asserting `loadDeck` accepts
      `tests/deck/fixtures/valid-deck.yaml`'s contents and returns a `Deck`
- [ ] T005 [P] [US1] Create `tests/deck/fixtures/dangling-reference.yaml` (a card whose
      `dependsOn` names a nonexistent card id) and write a test in `tests/deck/load.test.ts`
      asserting `loadDeck` rejects it with a `DanglingReference` naming that card and reference
- [ ] T006 [P] [US1] Create `tests/deck/fixtures/dependency-cycle.yaml` (two cards whose
      `dependsOn` entries form a cycle) and write a test in `tests/deck/load.test.ts` asserting
      `loadDeck` rejects it with a `DependencyCycle` naming a card in the cycle
- [ ] T007 [P] [US1] Create `tests/deck/fixtures/unsupported-tier.yaml` (a card declaring
      `tier: ambiguous`) and write a test in `tests/deck/load.test.ts` asserting `loadDeck`
      rejects it with an `UnsupportedTier` naming that card and tier
- [ ] T008 [P] [US1] Create `tests/deck/fixtures/unsupported-constraint-kind.yaml` (a
      `csp.constraints` entry using a `kind` outside ADR-006 §2.2's nine shapes) and write a
      test in `tests/deck/load.test.ts` asserting `loadDeck` rejects it with an
      `UnsupportedConstraintKind` naming that constraint id and kind

### Implementation for User Story 1

- [ ] T009 [US1] Implement YAML-to-`Deck` decoding (parse with `yaml`, decode through an
      `effect` `Schema`) in `src/deck/load.ts`'s `loadDeck`, satisfying T004 (depends on T002)
- [ ] T010 [US1] Implement reference-resolution validation (`dependsOn`, `reveals`,
      `constraints` each resolve to something real) in `src/deck/load.ts`, satisfying T005
      (depends on T009)
- [ ] T011 [US1] Implement `dependsOn` cycle detection in `src/deck/load.ts`, satisfying T006
      (depends on T009)
- [ ] T012 [US1] Implement the tier and constraint-kind support checks in `src/deck/load.ts`,
      satisfying T007 and T008 (depends on T009)
- [ ] T013 [US1] Implement `loadDeckFile` (read a file path, delegate to `loadDeck`) in
      `src/deck/load.ts` (depends on T009)

**Checkpoint**: User Story 1 is independently complete — `pnpm test tests/deck/load.test.ts`
passes with zero implementation of solving or classification.

---

## Phase 4: User Story 2 - Solve a deck's underlying puzzle without writing a solver (Priority: P1)

**Goal**: Report whether a validated deck's underlying puzzle has no solution, exactly one, or
more than one — using only the project's existing solving capability.

**Independent Test**: Call `solveDeck` on `valid-deck.yaml` (expect `UniquelySolvable`), on a
contradictory fixture (expect `Unsatisfiable`), and on an underdetermined fixture (expect
`MultiplySatisfiable`, no fabricated answer) — no card classification or closure-answer logic
involved yet.

### Tests for User Story 2 ⚠️

> Write these tests FIRST; confirm they fail before Implementation.

- [ ] T014 [P] [US2] Write a test in `tests/deck/solve.test.ts` asserting `deckCsp(deck)`
      produces an `ExtractedCsp` whose `entities`/`domains` match `deck.csp` exactly and whose
      `constraints` array contains every value from `deck.csp.constraints`' map, in any order
- [ ] T015 [P] [US2] Write a test in `tests/deck/solve.test.ts` asserting `solveDeck` reports
      `outcome._tag === "UniquelySolvable"` for `valid-deck.yaml`
- [ ] T016 [P] [US2] Create `tests/deck/fixtures/unsatisfiable-deck.yaml` (constraints that
      contradict each other) and write a test in `tests/deck/solve.test.ts` asserting
      `solveDeck` reports `outcome._tag === "Unsatisfiable"`
- [ ] T017 [P] [US2] Create `tests/deck/fixtures/multiply-satisfiable-deck.yaml` (constraints
      that leave more than one grid valid) and write a test in `tests/deck/solve.test.ts`
      asserting `solveDeck` reports `outcome._tag === "MultiplySatisfiable"` with no `answer`
      field populated

### Implementation for User Story 2

- [ ] T018 [US2] Implement `deckCsp` (flatten `deck.csp.constraints`' map to an array; pass
      `entities`/`domains` through) in `src/deck/solve.ts`, satisfying T014 (depends on T002)
- [ ] T019 [US2] Implement `solveDeck` calling the existing `solve()` (`src/solver/solve.ts`,
      unmodified) with `deckCsp`'s output and returning a `SolvedDeck` with that `SolveResult` as
      `outcome`, satisfying T015–T017 (depends on T018)

**Checkpoint**: User Stories 1 AND 2 both work independently — `pnpm test tests/deck/` passes.

---

## Phase 5: User Story 3 - Get the closing answer and each card's standing, without hand-labeling either (Priority: P2)

**Goal**: For a uniquely solved deck, produce the closure's specific answer and every card's
derived classification (noise / domain / constraint / redundant), with no hand-authored role
field anywhere in the deck.

**Independent Test**: Run `classifyCards` against fixtures with a noise card and a
repeated-constraint/repeated-reveal pair; run `solveDeck` against `valid-deck.yaml` and confirm
the reported answer's entity id; run it against a fixture whose closure condition matches zero or
two entities and confirm an `AnswerError`, not a guess.

### Tests for User Story 3 ⚠️

> Write these tests FIRST; confirm they fail before Implementation.

- [ ] T020 [P] [US3] Write a test in `tests/deck/classify.test.ts` asserting `classifyCards`
      labels a card with empty `reveals` and empty `constraints` as `"noise"`
- [ ] T021 [P] [US3] Create `tests/deck/fixtures/redundant-cards-deck.yaml` (two cards whose
      `constraints` name the same key, and two cards whose `reveals` name the same target) and
      write a test in `tests/deck/classify.test.ts` asserting `classifyCards` labels each pair's
      first (list-order) card as its target's primary presentation and the second as redundant —
      for both the shared constraint and the shared reveal
- [ ] T022 [P] [US3] Write a test in `tests/deck/solve.test.ts` asserting `solveDeck` on
      `valid-deck.yaml` returns the correct entity id in `answer`, matching that fixture's
      `closure.answer` condition against its known solution
- [ ] T023 [P] [US3] Create `tests/deck/fixtures/ambiguous-answer-deck.yaml` (uniquely solvable,
      but `closure.answer`'s condition matches zero — or, in a second case, more than one — of
      the solved entities) and write a test in `tests/deck/solve.test.ts` asserting `solveDeck`
      returns an `AnswerError` (`"NoMatchingEntity"` or `"AmbiguousMatch"`) rather than a guessed
      answer

### Implementation for User Story 3

- [ ] T024 [US3] Implement `classifyCards` (data-model.md's derivation: empty-both → noise;
      first-appearance-wins per named target for `reveals` and `constraints` independently) in
      `src/deck/classify.ts`, satisfying T020–T021 (depends on T002)
- [ ] T025 [US3] Implement closure-answer projection in `src/deck/solve.ts`: filter
      `csp.entities` to `closure.answer.entityType`, read `outcome.assignment[closure.answer.variable]`
      at the matching index, unwrapping an enum-typed value's `{ e: string }` wrapper
      (research.md Finding 4) before comparing to `closure.answer.equals`; produce `AnswerError`
      when zero or more than one entity matches, satisfying T022–T023 (depends on T019)
- [ ] T026 [US3] Wire `classifyCards` and the closure-answer projection into `solveDeck`'s
      returned `SolvedDeck` (`classifications` and `answer`/`AnswerError` fields) in
      `src/deck/solve.ts` (depends on T024, T025)

**Checkpoint**: All three user stories are independently functional — `pnpm test tests/deck/`
passes end to end.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Expose the library as a command (Constitution Principle VI) and confirm the whole
feature holds together.

- [ ] T027 [P] Implement the `zebra deck` subcommand in `src/cli/subcommands/deck.ts` per
      `contracts/cli-contract.md` (invocation shape, human/`--json` output, exit codes) (depends
      on T013, T019, T026)
- [ ] T028 Register the `deck` route in `src/cli/main.ts`'s `buildRouteMap` alongside `solve` and
      `extract` (depends on T027)
- [ ] T029 [P] Add CLI coverage for `zebra deck` (a validation failure, each `SolveResult`
      outcome, an `AnswerError`, and `--json`) in `tests/cli/cli.test.ts` (depends on T028)
- [ ] T030 [P] Convert `design/spikes/SPIKE-006-progressive-card-prototype/puzzle-data.js` into
      `catalog/decks/DECK-0001-maple-street.yaml` conforming to this schema, and create
      `catalog/decks/README.md` (ADR-006 §2.4's `Deck | Title` index) — the follow-up work
      ADR-006 §4 names explicitly, and the first real (non-fixture) proof this format and its
      library hold up end to end
- [ ] T031 Run `quickstart.md` top to bottom (library calls, `pnpm zebra deck`, `pnpm test`) and
      fix any discrepancy between it and the actual behavior (depends on T027, T030)
- [ ] T032 Run `pnpm lint` and `pnpm typecheck`; fix any finding rather than disabling a rule
      (Constitution Principle V) (depends on T001–T030)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only. No dependency on US2/US3.
- **User Story 2 (Phase 4)**: Depends on Foundational only (`deckCsp`/`solveDeck` need
  `src/deck/types.ts`, not `src/deck/load.ts`). Independently testable in parallel with US1 — the
  test fixtures for US2 don't need to pass through `loadDeck` first, since `solveDeck` takes an
  already-typed `Deck` directly.
- **User Story 3 (Phase 5)**: `classifyCards` (T024) depends on Foundational only, in parallel
  with US1/US2. The closure-answer half (T025–T026) depends on US2's `solveDeck` (T019) existing
  to extend.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each User Story

- Tests are written and observed to fail before their corresponding implementation task
  (Constitution Principle IV).
- `loadDeck`'s core decoding (T009) before its specific validation rules (T010–T012), which each
  extend the same function.
- `deckCsp` (T018) before `solveDeck` (T019), which calls it.
- `classifyCards` (T024) and the closure-answer projection (T025) before wiring both into
  `solveDeck`'s result (T026).

### Parallel Opportunities

- All fixture-creation tasks marked [P] across US1/US2/US3 (T005–T008, T016–T017, T021, T023)
  touch only their own new fixture file plus their own test file — no conflicts.
- US1 and US2 can be implemented fully in parallel once Foundational is done (see above); US3's
  `classifyCards` half can join them, with only its closure-answer half waiting on US2.
- T027 (CLI subcommand) and T030 (converting the SPIKE-006 deck) touch disjoint files and can run
  in parallel once their own dependencies are met.

---

## Parallel Example: User Story 1

```bash
# Launch US1's fixture-and-test tasks together — each creates its own fixture file and adds
# an independent test to tests/deck/load.test.ts:
Task: "Create tests/deck/fixtures/dangling-reference.yaml + test in tests/deck/load.test.ts"
Task: "Create tests/deck/fixtures/dependency-cycle.yaml + test in tests/deck/load.test.ts"
Task: "Create tests/deck/fixtures/unsupported-tier.yaml + test in tests/deck/load.test.ts"
Task: "Create tests/deck/fixtures/unsupported-constraint-kind.yaml + test in tests/deck/load.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001).
2. Complete Phase 2: Foundational (T002–T003) — CRITICAL, blocks everything else.
3. Complete Phase 3: User Story 1 (T004–T013).
4. **STOP and VALIDATE**: `pnpm test tests/deck/load.test.ts` passes; a hand-authored bad deck
   is rejected with a specific reason. This alone is a real, demoable increment — a deck author
   gets validation feedback even before anything can be solved.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. Add User Story 1 → test independently → deck authoring is now safe (MVP).
3. Add User Story 2 → test independently → a validated deck is now solvable with zero
   deck-specific solving code.
4. Add User Story 3 → test independently → the closing answer and every card's standing are now
   derived automatically.
5. Polish → the whole pipeline is invocable as `zebra deck`, and a real (non-fixture) deck proves
   it end to end.

### Parallel Team Strategy

With more than one contributor: complete Setup + Foundational together, then split US1/US2/US3
across contributors (they share only `src/deck/types.ts`, already finished in Foundational) and
converge in Phase 6.
