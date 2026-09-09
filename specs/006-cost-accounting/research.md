# Research: Actual LLM Cost Accounting

**Feature**: [spec.md](spec.md) | **Date**: 2026-09-09

No NEEDS CLARIFICATION markers existed in Technical Context — ADR-010 plus the spike
finding fully determine the approach. The single load-bearing fact was verified live
during planning rather than assumed.

## Findings

### Decision: Read `response.usage?.cost` at the existing response sites

- **Rationale**: `node_modules/@openrouter/sdk/esm/models/ChatResult.d.ts` declares
  `usage?: ChatUsage | undefined`; `chatusage.d.ts` declares
  `cost?: number | null | undefined`. SPIKE-007 independently confirmed the same field
  carries live dollar values (`cost: 0.00006615`) with no request flag. The two provider
  entry points (`requestStructuredCompletion`'s `flatMap` next to `choices[0]`,
  `requestProseCompletion`'s prose `flatMap`) already hold the response object — one
  property access each, no new plumbing.
- **Alternatives considered**: `onCost` callback side channel (ADR-010's original §2.1;
  superseded — inverts control for a value one access away); `Ref`-based accumulator
  (no concurrent access exists within a puzzle's sequential stages); top-level-only
  wrapping (silently drops multi-call stages' costs).

### Decision: `{ value, costUsd }` wrapper return types, additive forwarding

- **Rationale**: Keeps data flow total — cost is produced where the response is held and
  forwarded explicitly only by code that sums it. Layers that don't aggregate keep using
  `value` unchanged. Matches ADR-010 §2.1 (amended) and §4 exactly.
- **Alternatives considered**: None viable beyond those already rejected in ADR-010 §3.

### Decision: Offline tests via stubbed `usage` payloads

- **Rationale**: The stub server (`tests/extraction/support/stub-server.ts`) returns
  canned JSON; adding a `usage: { cost }` object to fixtures exercises the full read →
  sum → record path with zero network, preserving the offline-test constraint.
- **Alternatives considered**: Live verification (billed; reserved for a post-implement
  pilot on one cheap puzzle, not the test suite).

## Resolved Unknowns

None outstanding — all Technical Context entries were known. The SDK shape (the one
fact that could have invalidated the design) was read from the pinned package, not
assumed from the ADR text.
