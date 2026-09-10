# Implementation Plan: Actual LLM Cost Accounting

**Branch**: `006-cost-accounting` | **Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-cost-accounting/spec.md`

## Summary

Every spend figure the eval harness reports is a pre-run registry estimate carried through
as if measured. This feature reads the provider-billed cost already present on every SDK
response (`ChatResult.usage.cost`), sums it per harness stage, and reports measured vs
estimated spend side by side in raw records and human-readable summaries. Approach per
ADR-010 (amended): widen the two provider entry points to return `{ value, costUsd }`,
forward additively through existing layers, sum in the runner with registry-estimate
fallback.

## Technical Context

**Language/Version**: TypeScript (tsgo preview, `typescript@^7.0.2`), Node 24, run directly (no build step)

**Primary Dependencies**: `effect` (4.0.0-rc line — hand-wrapped `Effect`s, no `@effect/*` packages), `@openrouter/sdk` (pinned; `ChatResult.usage?: ChatUsage`, `ChatUsage.cost?: number | null | undefined` — verified in `node_modules` during planning)

**Storage**: N/A (JSON files under `eval/results/`, `eval/matrix.md` — existing report writers extended, not replaced)

**Testing**: Node's built-in test runner (`node --test` via `pnpm test`); HTTP stub server (`tests/extraction/support/stub-server.ts`) for offline provider tests — cost values come from stubbed `usage` payloads, never the network

**Target Platform**: macOS/Linux dev machines, Node 24

**Project Type**: CLI tool (`scripts/eval-extraction.ts`, `scripts/eval-matrix.ts`) + library (`src/extraction/`, `src/eval/`)

**Performance Goals**: Zero measurable overhead — one property access per successful call; no extra requests

**Constraints**: `pnpm test` stays offline and free (Constitution: offline-test constraint from specs/004); strict `tsconfig` (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`) MUST NOT be weakened; Biome lint clean

**Scale/Scope**: Touches 2 provider entry points, ~6 forwarding layers, 2 report writers, 1 matrix renderer; no new files beyond tests

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. RFC/ADR-Gated Delivery** — Seeded from ADR-010 (parents RFC-004, RFC-003); gate passed; link hook executed (`specs:` backlinked).
- [x] **II. Effect-Idiomatic Code** — Cost forwarding stays inside `Effect` pipelines (destructure in `flatMap`/`gen`); no bare async, no thrown errors.
- [x] **III. Graphs as Constraint Representation** — Untouched; no constraint representation changes.
- [x] **IV. Design-First, Then Test-First** — ADR-010 settled design; implementation MUST write failing tests first (stubbed `usage.cost` fixtures) before provider changes.
- [x] **V. Lint-Clean, Type-Safe** — No strictness weakening; return-type widening is explicit (`{ value: A; costUsd: number | undefined }`).
- [x] **VI. Callable Tool** — No new interactive surface; new record fields are data, not dialogue.

No violations. No Complexity Tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/006-cost-accounting/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── extraction/
│   ├── provider.ts      # requestStructuredCompletion returns { value, costUsd }
│   └── extract.ts       # extractOnce/critiqueOnce forward; runTier/runTierSafely sum
└── eval/
    ├── harness.ts       # stage results gain actualCostUsd
    └── direct-solve.ts  # requestProseCompletion returns { value, costUsd }; pair summed

scripts/
├── eval-extraction.ts   # chargePuzzle uses actual w/ estimate fallback; records gain both figures
└── eval-matrix.ts       # verdict grid gains per-cell actual-spend line

tests/
├── extraction/          # stubbed usage.cost fixtures; accumulation tests
└── eval/                # stage-sum, fallback, record-shape tests
```

**Structure Decision**: Single-project layout preserved; changes are in-place extensions of existing modules, no new packages or directories.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

None — no violations.
