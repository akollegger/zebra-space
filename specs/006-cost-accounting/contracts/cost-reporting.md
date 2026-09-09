# Contract: Cost Reporting Across Layers

**Feature**: [spec.md](../spec.md) | **Date**: 2026-09-09

## Provider Entry Points

- `requestStructuredCompletion(req)` returns `Effect<{ value: A; costUsd: number | undefined }, ProviderError | SchemaRejected | SchemaViolation>`.
  - `costUsd` is `response.usage?.cost` iff it is a `number`; otherwise `undefined`.
  - Error paths are unchanged (no cost on failure — there is nothing to read).
- `requestProseCompletion(req)` returns the identical wrapper shape with its own error channel.

## Forwarding Layers

- `extractOnce`, `critiqueOnce`, `extractStaged`'s two calls, `directSolveHarness`'s
  solve-then-judge pair: destructure `{ value, costUsd }`, use `value` exactly as today,
  add `costUsd` (when a number) into the stage's running sum.
- `runTier` / `runTierSafely`, harness `extract` stages: expose the sum as
  `actualCostUsd: number | undefined` on their result objects.
- `compile` / `solve` stages: forward `actualCostUsd` unchanged (spread-through).
- Layers that neither make calls nor aggregate MUST NOT name `costUsd`.

## Runner

- Charge step: `actualCostUsd` when it is a number; else registry per-call estimate ×
  harness worst-case call count. Pre-run estimate check unchanged (registry only).
- Raw per-puzzle record: `{ estimatedCostUsd: number, actualCostUsd: number | null }`.
- Summaries: measured spend reported next to estimated spend (run level and matrix-cell level).

## Test Contract

- All cost behavior is provable offline: stub fixtures include/exclude/omit `usage.cost`
  (number, null, missing) and multi-call sequences; assertions cover sums, absence-vs-zero,
  lower-bound-on-retries, and unchanged pre-run gate behavior.
