# Feature Specification: Actual LLM Cost Accounting

**Feature Branch**: `006-cost-accounting`

**Created**: 2026-09-09

**Status**: Draft

**Input**: User description: "cost-accounting as described in design/adr/ADR-010-actual-llm-cost-accounting.md"

**Derived From**: ADR-010 (design/adr/ADR-010-actual-llm-cost-accounting.md)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what an eval run actually spent (Priority: P1)

A maintainer runs the extraction eval across puzzles and wants to know, afterwards, how
much money the run really cost — not the pre-run worst-case guess, but the sum of what
the provider billed per call. Today every committed spend figure is the registry estimate
carried through as if it were a measurement.

**Why this priority**: Every dollar figure in `eval/results.md` and `eval/matrix.md` is
currently a guess wearing a measurement's clothes. Without actuals, budget calibration
(are registry estimates anywhere near reality?) and per-model cost comparison are
impossible.

**Independent Test**: Run the eval on two puzzles with a billed model, then read the raw
JSON and confirm each puzzle record carries both the pre-run estimate and a measured
actual, and that the actual equals the sum of per-call billed costs.

**Acceptance Scenarios**:

1. **Given** a completed eval run on a billed model, **When** the maintainer opens the
   run's raw JSON, **Then** every puzzle record shows both `estimatedCostUsd` (the
   pre-run number) and `actualCostUsd` (the measured sum).
2. **Given** a completed eval run, **When** the maintainer reads the `results.md`
   summary, **Then** it reports measured spend alongside (not instead of) the estimate.

---

### User Story 2 - Trust the budget gate on real numbers (Priority: P2)

A maintainer sets a dollar budget for a matrix run and wants the gate to reason about
realistic spend. The pre-run estimate check stays estimate-based (nothing measured exists
yet), but afterwards the maintainer can compare estimate vs actual per cell and tighten
future budgets and registry estimates accordingly.

**Why this priority**: Turns the budget from a one-way guard into a calibration loop:
estimate → run → measure → better estimates.

**Independent Test**: Run a matrix cell, compare the cell's estimated vs actual spend in
`matrix.md`, and adjust a registry estimate; the next plan reflects the new number.

**Acceptance Scenarios**:

1. **Given** a finished matrix run, **When** the maintainer opens `matrix.md`, **Then**
   each cell shows an actual-spend line next to its pass-rate line.
2. **Given** a puzzle whose successful calls never reported a cost (local or free-tier
   run), **When** the maintainer reads its record, **Then** the actual is absent
   (not zero) and the estimate stands in, so free runs are never confused with free
   measurements.

---

### User Story 3 - Spot models whose real cost diverges from estimates (Priority: P3)

A maintainer comparing models notices one whose measured cost consistently runs far
above or below its registry estimate, and updates the registry so future pre-run plans
are honest.

**Why this priority**: This is the payoff of recording both figures side by side —
the eval surfaces pricing drift instead of hiding it.

**Independent Test**: After several runs, list per-model estimate-vs-actual pairs and
confirm a systematic over- or under-estimate is visible.

**Acceptance Scenarios**:

1. **Given** multiple runs against the same model, **When** the maintainer compares
   `estimatedCostUsd` vs `actualCostUsd` across them, **Then** a consistent divergence
   is evident from the recorded figures alone.

---

### Edge Cases

- What happens when a call fails (timeout, rejected schema, repaired violation)? Failed
  attempts carry no usage data, so they contribute nothing to the measured total; the
  measured figure for a retry-heavy puzzle is a real lower bound, not a corrected total.
- How does the system handle local or free-tier calls that report no cost? The actual is
  recorded as absent (distinct from zero); the registry estimate is used as the fallback
  for that stage.
- What happens when only some calls in a stage report costs? The reported ones sum;
  unreported ones contribute nothing (no per-call estimate substitution within a stage).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each LLM call that reaches a successful response MUST expose the provider-billed dollar cost for that call alongside its decoded result.
- **FR-002**: Callers that make multiple LLM calls per puzzle (critic-loop tiers and revision rounds, staged extraction's two stages, direct-solve's solve-then-judge pair) MUST sum per-call costs across every call in the stage.
- **FR-003**: Each harness stage result MUST carry the stage's measured total, or an explicit absent marker when the stage made calls but none reported a cost.
- **FR-004**: The per-puzzle budget charge MUST use the measured total when present, and the registry per-call estimate times the harness's worst-case call count only when the measured total is absent.
- **FR-005**: Every per-puzzle raw record MUST carry both the pre-run estimate and the measured actual side by side.
- **FR-006**: The committed human-readable summaries MUST report measured spend next to estimated spend per run (results) and per cell (matrix).
- **FR-007**: The pre-run budget-estimate check MUST continue to use registry estimates (no actual exists before any call is made).
- **FR-008**: Existing callers that do not need cost data MUST receive exactly what they receive today (no behavior change for cost-unaware layers).

### Key Entities

- **Per-call cost**: The dollar amount the provider billed for one LLM call, as reported on that call's own response; absent on routes that don't bill in dollars (local, free-tier) and on failed attempts.
- **Stage actual**: The sum of per-call costs within one harness stage; absent when no call in the stage reported a cost (distinct from a measured zero).
- **Puzzle record figures**: The side-by-side pair — pre-run estimate (registry-based, exists before the run) and measured actual (summed during the run) — stored on every per-puzzle raw record.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a billed eval run, every puzzle record shows a measured actual that equals the sum of its calls' billed costs (verifiable from the raw records alone).
- **SC-002**: After a local or free-tier run, puzzle records show an absent actual with the estimate standing in — never a fabricated zero.
- **SC-003**: A maintainer can read estimate-vs-actual per cell from the matrix summary without opening raw JSON.
- **SC-004**: The pre-run budget gate behaves exactly as before (same refusals on the same inputs), since it still uses registry estimates.

## Assumptions

- The provider SDK reports per-call billed cost on successful responses by default with no request flag (confirmed by spike measurement on the pinned SDK).
- Failed attempts (timeouts, rejections, violations) never carry usage data, so measured totals are lower bounds for retry-heavy puzzles — accepted, not corrected.
- Harness stages execute sequentially within a puzzle, so summation needs no concurrency control.
- Only the top-line billed cost is recorded; any provider-side cost breakdown is out of scope.
