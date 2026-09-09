---

description: "Task list for actual LLM cost accounting"
---

# Tasks: Actual LLM Cost Accounting

**Input**: Design documents from `/specs/006-cost-accounting/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/cost-reporting.md](contracts/cost-reporting.md), [quickstart.md](quickstart.md)

**Tests**: Required by Constitution IV. Write and observe each offline test fail before the task that makes it pass. `pnpm test` MUST remain network- and key-free; use `tests/extraction/support/stub-server.ts` fixtures.

**Organization**: Tasks are grouped by user story so each story can be independently implemented and validated.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the contract and offline test fixtures before changing provider return shapes.

- [ ] T001 Update `tests/extraction/support/stub-server.ts` to let a handler return an OpenRouter-shaped `usage` object (including number, null, or omitted `cost`) with its canned non-streaming response.
- [ ] T002 [P] Add failing provider contract tests in `tests/extraction/provider.test.ts` for `requestStructuredCompletion()` returning `{ value, costUsd }`: number forwards as a number; null/missing normalizes to `undefined`; decoded value/error behavior stays unchanged.
- [ ] T003 [P] Add failing prose-provider contract tests in `tests/eval/direct-solve.test.ts` for `requestProseCompletion()` returning `{ value, costUsd }` under billed, null, and local-route response fixtures.

**Checkpoint**: Offline tests describe both provider wrappers and fail solely because cost is not yet exposed.

---

## Phase 2: Foundational (Provider Cost Contract)

**Purpose**: Make per-call billed cost available to every existing caller without extra requests.

**⚠️ CRITICAL**: Complete this phase before user-story work. Every later task depends on the `{ value, costUsd }` contract.

- [ ] T004 Change `src/extraction/provider.ts` so `requestStructuredCompletion()` reads `response.usage?.cost` at its existing non-streaming response site and returns `{ value, costUsd }`, normalizing null/missing to `undefined`; preserve all existing error and retry behavior.
- [ ] T005 Change `src/eval/direct-solve.ts` so `requestProseCompletion()` reads the same SDK field and returns `{ value, costUsd }`, preserving local-route behavior and all error handling.
- [ ] T006 Update direct callers in `src/extraction/extract.ts` and `src/eval/direct-solve.ts` to destructure `.value` from the widened provider results while preserving existing extraction, critique, staged, and judge behavior before aggregation is added.
- [ ] T007 Run `node --test tests/extraction/provider.test.ts tests/eval/direct-solve.test.ts` and `pnpm typecheck` to confirm the provider contract is green and every old caller is deliberately adapted.

**Checkpoint**: Every successful provider call exposes cost when the provider supplies it; all cost-unaware behavior is unchanged.

---

## Phase 3: User Story 1 - See What an Eval Run Actually Spent (Priority: P1) 🎯 MVP

**Goal**: Surface measured per-puzzle spend alongside the existing pre-run estimate after a billed eval run.

**Independent Test**: Use stubbed successful calls with known costs across extraction/critique or staged/direct-solve sequences; assert the harness exposes their sum and an eval raw record contains both estimate and actual.

### Tests for User Story 1

- [ ] T008 [P] [US1] Add failing accumulation tests in `tests/extraction/extract.test.ts` for a successful first-pass extract, critic revision, tier escalation, and staged two-call extraction; assert each sums every successful call's known `costUsd` and ignores failed attempts.
- [ ] T009 [P] [US1] Add failing direct-solve accumulation tests in `tests/eval/direct-solve.test.ts` for solver-plus-judge cost summation and absence when neither reports a cost.
- [ ] T010 [P] [US1] Add failing harness record tests in `tests/eval/harness-registry.test.ts` or `tests/eval/harness.test.ts` for `actualCostUsd` forwarding unchanged through compile/solve stages and preserving measured zero vs absent.

### Implementation for User Story 1

- [ ] T011 [US1] Add `actualCostUsd: number | undefined` to stage result contracts in `src/eval/harness.ts`; update built-in full-critic, single-shot, compile-repair, local-single-shot, staged-single-shot, and direct-solve harnesses to expose or forward the correct sum.
- [ ] T012 [US1] Thread cost accumulation through `src/extraction/extract.ts` (`extractOnce`, `critiqueOnce`, `critiqueWithRepair`, `runTier`, `runTierSafely`, `extract`, `extractSingleShot`, and `extractStaged`) so all successful calls made for one extraction contribute exactly once.
- [ ] T013 [US1] Sum direct solver and forced-tool judge costs in `src/eval/direct-solve.ts`, retaining `undefined` when neither response reports a numeric cost.
- [ ] T014 [US1] Update `scripts/eval-extraction.ts` run-stage and per-puzzle record assembly to carry `actualCostUsd` from the selected harness through successful and failed-stage records without changing verdict selection.
- [ ] T015 [US1] Run the focused US1 tests and `pnpm test`; confirm raw fixture records distinguish numeric actuals, measured zero, and null JSON actuals.

**Checkpoint**: A completed eval has a measured per-puzzle actual whenever the provider reports one, plus the unchanged estimate.

---

## Phase 4: User Story 2 - Trust the Budget Gate on Real Numbers (Priority: P2)

**Goal**: Keep pre-run budget protection estimate-based while using measured totals after calls complete and making the difference visible in reports.

**Independent Test**: Run the eval runner against a stubbed cost-bearing harness; assert its pre-run refusal is unchanged, the charge uses actual when present, fallback uses the registry figure only when absent, and report output displays both.

### Tests for User Story 2

- [ ] T016 [P] [US2] Add failing budget tests in `tests/eval/harness.test.ts` covering actual-cost charge, absent-actual registry fallback, measured zero (no fallback), and unchanged pre-run estimate refusal.
- [ ] T017 [P] [US2] Add failing raw-report tests in `tests/eval/harness.test.ts` for side-by-side `estimatedCostUsd` and `actualCostUsd` fields, including JSON null for absent actual.
- [ ] T018 [P] [US2] Add failing matrix rendering tests in `tests/eval/harness.test.ts` for an actual-spend line next to a cell's pass-rate line and a clear absent-actual representation.

### Implementation for User Story 2

- [ ] T019 [US2] Update budget creation and `chargePuzzle` in `scripts/eval-extraction.ts` to use the measured per-puzzle total when numeric and the current registry estimate only when actual is absent; leave `checkBudgetEstimate` registry-only.
- [ ] T020 [US2] Add `estimatedCostUsd` and `actualCostUsd` to `PuzzleRunRecord` and raw JSON in `scripts/eval-extraction.ts`; use `null` for absent actual in serialized output while retaining `undefined` semantics in Effects.
- [ ] T021 [US2] Update the run-level summary and append-only markdown rendering in `scripts/eval-extraction.ts` to show estimated and measured spend side by side without presenting an estimate as measured.
- [ ] T022 [US2] Update `scripts/eval-matrix.ts` raw-cell reader and `renderVerdictGrid`/matrix markdown rendering to show a per-cell measured-spend line next to the existing pass-rate and estimated figures.
- [ ] T023 [US2] Run all `tests/eval/*.test.ts` explicitly and `pnpm test`; verify local/free fixtures visibly preserve absent actuals rather than fabricating zero.

**Checkpoint**: Budget behavior before a run is unchanged; records and reports distinguish estimate, measured actual, and absence after it.

---

## Phase 5: User Story 3 - Spot Models Whose Real Cost Diverges from Estimates (Priority: P3)

**Goal**: Make per-model estimate-vs-actual comparisons visible enough to tune registry figures from completed runs.

**Independent Test**: Feed two raw cell results with known actual/estimated divergence to the matrix renderer and confirm the output exposes both without opening the raw JSON.

### Tests for User Story 3

- [ ] T024 [P] [US3] Extend `tests/eval/harness.test.ts` with multi-cell matrix fixtures whose actual costs diverge above and below estimates; assert each cell remains independently visible.

### Implementation for User Story 3

- [ ] T025 [US3] Refine `scripts/eval-matrix.ts` labels and `eval/README.md` cost-accounting documentation so maintainers can compare per-cell estimate vs actual and recognize actual as a lower bound for retry-heavy runs.
- [ ] T026 [US3] Update `.env.example` or `eval/models.json` comments only if needed to clarify that registry rates remain pre-run planning estimates, not observed costs.
- [ ] T027 [US3] Run the quickstart scenarios in `specs/006-cost-accounting/quickstart.md` offline and verify the documented interpretation matches rendered output.

**Checkpoint**: A maintainer can see systematic pricing divergence from committed summaries alone.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Confirm contract consistency, full validation, and live readiness without spending automatically.

- [ ] T028 [P] Verify `specs/006-cost-accounting/contracts/cost-reporting.md`, `data-model.md`, and `quickstart.md` remain accurate after implementation; update only factual drift.
- [ ] T029 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`; fix all failures without weakening TypeScript or Biome rules.
- [ ] T030 Perform one explicitly approved cheap live pilot using `scripts/eval-extraction.ts` on PZL-0004; verify a positive `actualCostUsd` appears beside its estimate and the report displays both. Do not run this task without explicit approval because it is billed.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; T001 must finish before provider tests T002–T003 can use usage fixtures.
- **Foundational (Phase 2)**: Depends on T001–T003; blocks every user story because the provider wrapper is the common cost source.
- **US1 (Phase 3)**: Depends on Phase 2; establishes stage sums and raw record carriage.
- **US2 (Phase 4)**: Depends on US1 because charging/reporting reads `actualCostUsd` from stage results.
- **US3 (Phase 5)**: Depends on US2 because it renders the recorded actual-vs-estimate pair.
- **Polish (Phase 6)**: Depends on all requested story phases.

### User Story Dependencies

- **US1 (P1)**: Starts after Phase 2; independently proves accurate per-puzzle measurement.
- **US2 (P2)**: Requires US1's stage actual field; independently proves budgeting/reporting semantics.
- **US3 (P3)**: Requires US2's persisted figures; independently proves cross-cell comparison visibility.

### Parallel Opportunities

- T002 and T003 can run in parallel after T001 (different test files).
- T008–T010 can run in parallel (different test files) once Phase 2 is complete.
- T016–T018 can run in parallel (different test concerns/files) once US1 is complete.
- T024 can start alongside US3 documentation preparation after US2 output shape is stable.
- T028 can run in parallel with T029; T030 is always last and requires explicit billed-run approval.

---

## Parallel Example: User Story 1

```text
Task: "Add critic, escalation, and staged accumulation tests in tests/extraction/extract.test.ts"
Task: "Add solver-plus-judge accumulation tests in tests/eval/direct-solve.test.ts"
Task: "Add stage forwarding tests in tests/eval/harness-registry.test.ts or tests/eval/harness.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2.
2. Implement US1 (T008–T015).
3. Stop and validate the provider → stage → raw-record chain offline.
4. At this checkpoint, measured per-puzzle cost is already useful even before summary rendering changes.

### Incremental Delivery

1. Provider wrapper contract → cost data exists without any extra request.
2. US1 → stage sums and raw records expose measured actuals.
3. US2 → budget fallback and summaries distinguish estimate from measurement.
4. US3 → matrix makes cross-model pricing drift visible.
5. Final live pilot confirms the SDK field in this project path only after explicit approval.

## Notes

- All tasks follow `- [ ] TNNN [P?] [US?] Description with path` checklist format.
- Test tasks are included because the Constitution requires test-first implementation.
- `actualCostUsd` is a lower bound for retry-heavy runs; do not add estimate padding for failed calls.
- Do not implement ADR-010 by adopting `effect/unstable/ai` or `@effect/ai-openrouter`; SPIKE-007 rejected that structured-output route for this schema.
