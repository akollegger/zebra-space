# Quickstart: Actual LLM Cost Accounting

**Feature**: [spec.md](spec.md) | **Date**: 2026-09-09

## Prerequisites

- Dependencies installed (`pnpm install`); Node 24.
- No API key or network needed for validation (all offline).

## Validate (offline)

1. `pnpm typecheck` — return-type widening compiles at every layer.
2. `pnpm lint` — zero errors or warnings.
3. `pnpm test` — full suite green, including new cost tests:
   - stubbed `usage.cost` number reads through to `{ value, costUsd }`;
   - `null`/missing cost normalizes to `undefined`;
   - multi-call stages sum (critic revisions, staged pair, solve+judge);
   - local/free-tier stages report absent actual with estimate fallback;
   - raw records carry both figures; pre-run gate behavior unchanged.

## Validate (live pilot, billed — explicit approval required)

1. Run the harness on one cheap puzzle (e.g. PZL-0004 via the default path).
2. Confirm the raw record's `actualCostUsd` is a positive number ≤ the estimate and
   matches the provider's billed order of magnitude.
3. Confirm `results.md` shows measured next to estimated spend.

## Expected Outcomes

- Offline suite proves the read → sum → record → report chain end to end.
- The live pilot proves the SDK field carries real dollars on this project's own call path
  (the spike proved it on a probe; this proves it in situ).
- See [contracts/cost-reporting.md](contracts/cost-reporting.md) for layer responsibilities
  and [data-model.md](data-model.md) for figure semantics.
