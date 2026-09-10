# Data Model: Actual LLM Cost Accounting

**Feature**: [spec.md](spec.md) | **Date**: 2026-09-09

## Entities

- **Per-call cost** (`costUsd: number | undefined`): dollar amount billed for one LLM
  call, read as `response.usage?.cost` when it is a `number`. Absent (`undefined`) when
  the route doesn't bill in dollars (local via base-URL override, free-tier entries)
  and on every failed attempt (error responses never carry `usage`). Never `null`
  downstream — normalized at the read site.
- **Stage actual** (`actualCostUsd: number | undefined`): sum of per-call costs within
  one harness stage (`extract` produces it; `compile`/`solve` forward unchanged).
  `undefined` when the stage made calls but none reported a cost. Distinct from a
  measured `0` (a stage whose calls all billed exactly zero still reports `0`).
- **Puzzle record figures** (`estimatedCostUsd: number`, `actualCostUsd: number | null`):
  side-by-side pair on every per-puzzle raw record. Estimate is the pre-run registry
  number (always present — the budget gate needs it before any call exists). Actual is
  the measured sum, `null` in JSON when absent (JSON has no `undefined`).

## Relationships

- Per-call costs sum into exactly one stage actual (the stage that made the call).
- Stage actuals flow into the puzzle record's `actualCostUsd` via the runner's charge
  step, which substitutes the registry estimate only when the actual is absent.
- The pre-run budget check reads `estimatedCostUsd` only; it never sees actuals.

## Validation Rules

- A retry-heavy puzzle's actual is a lower bound (failed attempts contribute nothing) —
  recorded as-is, never padded with estimates.
- Within a stage, reported costs sum and unreported calls contribute nothing (no
  per-call estimate substitution inside a stage).
- `actualCostUsd: 0` MUST NOT be rewritten to absent; absence and zero are
  semantically distinct (free measurement vs free route).
