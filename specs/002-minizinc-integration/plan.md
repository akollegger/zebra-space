# Implementation Plan: MiniZinc Solver Integration

**Branch**: `002-minizinc-integration` | **Date**: 2026-08-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-minizinc-integration/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Build the solve-and-classify capability ADR-002 committed to: invoke MiniZinc (Gecode backend)
as a local subprocess via `@effect/platform`'s Command module, request at most 2 solutions,
parse JSON output into a typed result (unsatisfiable / uniquely solvable / multiply
satisfiable), and seed `catalog/mzn/` with one hand-translated example (`PZL-0004`, Whodunit) to
prove the whole path end-to-end against a real catalog puzzle's known answer.

## Technical Context

**Language/Version**: TypeScript, Node 24+ (native type-stripping, matching the rest of the
repo — no build step).

**Primary Dependencies**: None new. `@effect/platform`'s `Command` module was the original plan
(ADR-002 §2.3) but its only stable release peer-depends on `effect@^3.22.1`, incompatible with
this repo's pinned `effect@4.0.0-beta.107` (confirmed by a broken install when actually tried —
see tasks.md T001). Subprocess invocation instead wraps `node:child_process` by hand in an
`Effect`, achieving the same typed-error, no-thrown-exceptions outcome the constitution's
Effect-Idiomatic Code principle actually requires.

**Storage**: Per-invocation temp directories (`node:fs/promises` `mkdtemp` over `os.tmpdir()`),
removed after each attempt (research.md's temp-file decision). `catalog/mzn/PZL-0004-whodunit.mzn`
as the one persistent new file this feature adds.

**Testing**: Node's built-in test runner (`node --test`, already wired via `pnpm test`), extended
with a new `tests/solver/` suite covering SC-001–005.

**Target Platform**: Same as the rest of the repo (local Node 24+ dev environment), **plus** an
external MiniZinc + Gecode toolchain requirement — documented (FR-010), not installed by this
feature. research.md Finding 1: Gecode is not registered as a usable solver out of the box on at
least Homebrew-based setups and needs an explicit one-time registration step.

**Project Type**: A small internal library capability (one `solve` operation, per
`contracts/solve-contract.md`) within the existing single-package repo — not a standalone
CLI/service.

**Performance Goals**: N/A beyond "doesn't hang" — bounded by a solve timeout (Assumptions).

**Constraints**: Classification MUST be determined by parsing stdout for the
`=====UNSATISFIABLE=====` marker versus JSON solution objects — NOT by branching on exit code,
since research.md Finding 2 confirmed unsatisfiable results exit 0, the same as solvable ones.
Only a non-zero exit indicates a genuine failure.

**Scale/Scope**: One seed example (`PZL-0004`) plus three small hand-written toy fixtures
(unsatisfiable, uniquely solvable, multiply satisfiable) for automated testing.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. RFC/ADR-Gated Delivery | PASS | Spec derived from ADR-002 (design/adr/ADR-002-adopt-minizinc-solver.md), parent RFC-002; gated by `speckit-adr-gate`. |
| II. Effect-Idiomatic Code | PASS | This is the project's first real `Effect` pipeline consumer — subprocess invocation via `@effect/platform`'s Command module, typed `SolverError` failures (data-model.md), no thrown exceptions. |
| III. Graphs as the Constraint Representation | N/A | This feature neither builds nor consumes a `@relateby/pattern` graph — it only runs an already-written MiniZinc model. The graph-to-`.mzn` compiler that *would* touch graphs is explicitly deferred (ADR-002 Context, RFC-002 Non-Goal 2). |
| IV. Design-First, Then Test-First | PASS | Design (RFC-002 → ADR-002 → this spec) precedes implementation. `tests/solver/*.test.ts` (Phase 1 output, tasks.md to follow) must be written first and fail against the current repo (no `solve` capability exists yet) before implementation makes them pass — covers SC-001–005. |

No violations — Complexity Tracking is not needed.

## Project Structure

### Documentation (this feature)

```text
specs/002-minizinc-integration/
├── plan.md                    # This file (/speckit-plan command output)
├── research.md                # Phase 0 output (/speckit-plan command)
├── data-model.md               # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── solve-contract.md      # Phase 1 output (/speckit-plan command)
├── quickstart.md               # Phase 1 output (/speckit-plan command)
└── tasks.md                    # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
└── solver/
    ├── types.ts          # SolveRequest / SolveResult / SolverError (data-model.md)
    ├── parse.ts          # stdout classification: unsat marker vs. JSON solutions (research.md Finding 2)
    └── solve.ts          # the solve() Effect pipeline (contracts/solve-contract.md)

catalog/
└── mzn/
    └── PZL-0004-whodunit.mzn   # seed example (FR-008/FR-009)

tests/
└── solver/
    └── solve.test.ts     # SC-001–005

scripts/
└── setup-minizinc-solver.sh    # registers Gecode per research.md Finding 1 (idempotent; documented in quickstart.md)
```

**Structure Decision**: Single-project structure (matches the existing repo and
`001-catalog-seeding`'s precedent). This feature adds `src/solver/` as the project's first real
source module, one new `catalog/mzn/` entry, a matching `tests/solver/` suite, and a small setup
script — introducing `@effect/platform`/`@effect/platform-node` as new dependencies (Technical
Context) but no other structural changes.

## Complexity Tracking

*No Constitution Check violations — this section is not needed.*
