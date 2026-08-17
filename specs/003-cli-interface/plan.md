# Implementation Plan: CLI Interface

**Branch**: `003-cli-interface` | **Date**: 2026-08-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-cli-interface/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Build the `zebra` CLI ADR-003 decided: a subcommand-oriented executable (`zebra <subcommand>
[args] [flags]`) with top-level/per-subcommand `--help` and `--version`, and one subcommand,
`solve`, wrapping the existing solve capability with human-readable (default) or `--json`
output — exit code reserved strictly for actual tool failure, never for a puzzle's own
unsatisfiable/non-unique outcome.

**Revision note**: initial task drafting (`tasks.md`) surfaced that `solve()`'s
`SolveRequest.model`/`data` fields are file *contents*, not paths (`src/solver/solve.ts`) — so a
CLI subcommand handed a file path would have to read it into memory just to satisfy that
signature, only for `solve()` to immediately write that same content back out to a *new* temp
file before invoking MiniZinc. That round trip (disk → memory → a different temp file on disk)
buys nothing: MiniZinc only reads the model/data files, it never mutates them, so the CLI's
already-stable input file could be passed straight through. Resolved by extracting `solve.ts`'s
shared "invoke MiniZinc against known file paths, then classify" logic into a private helper and
adding a path-based sibling entrypoint, `solveFile()`, next to the existing content-based
`solve()` — the CLI's `solve` subcommand calls `solveFile()` directly, with no `readFile` step of
its own. `solve()` itself (signature, behavior, its own `tests/solver/solve.test.ts` suite) is
unchanged.

## Technical Context

**Language/Version**: TypeScript, Node 24+ native execution — no build step. Confirmed
hands-on (research.md Finding 2): a `.ts` file with a `node` shebang, executable bit set, runs
directly and imports sibling `.ts` modules using this repo's existing convention.

**Primary Dependencies**: `@stricli/core@1.3.0` (new) — zero runtime/peer dependencies, confirmed
by installing it and running real commands through it (research.md Finding 2). Provides typed
flag/positional parsing and subcommand dispatch (ADR-003 §2.3), replacing this plan's original
`node:util.parseArgs` + hand-rolled dispatch approach — reversed after review, before any
implementation existed (ADR-003's revision history). Not `@effect/cli`/`@effect/platform` —
confirmed incompatible with this repo's pinned `effect@4.0.0-beta.107` (ADR-003 Context;
tracked for when that changes at
[issue #5](https://github.com/akollegger/zebra-space/issues/5)).

**Storage**: N/A.

**Testing**: Node's built-in test runner, extended with a `tests/cli/` suite that spawns the
built `bin` entrypoint as a real subprocess (per `contracts/cli-contract.md`) rather than
importing its internals — this feature's actual contract is the command-line surface itself.

**Target Platform**: Same as the rest of the repo, plus this feature inherits
`specs/002-minizinc-integration`'s MiniZinc/Gecode prerequisite for the `solve` subcommand
specifically — `--help`/`--version` and the unknown-subcommand path do not depend on it.

**Project Type**: This repo's first CLI entrypoint (a `bin` in `package.json`) — everything
else so far has been library code or test-only.

**Performance Goals**: N/A — bounded by `solve()`'s own timeout (`specs/002-minizinc-integration`).

**Constraints**: `--help`/`--version` and unknown-subcommand handling MUST work without invoking
`solve()` or requiring MiniZinc to be installed at all (spec.md User Story 3's independence from
User Story 1).

**Scale/Scope**: One subcommand (`solve`) today, registered in a Stricli route map that's
already built to grow — adding a second subcommand is a route-map entry, not a redesign
(ADR-003 §4).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. RFC/ADR-Gated Delivery | PASS | Spec derived from ADR-003 (design/adr/ADR-003-cli-interface.md), parent RFC-002; gated by `speckit-adr-gate`. |
| II. Effect-Idiomatic Code | PASS | Argument parsing/dispatch is delegated to `@stricli/core` — a library concern, not puzzle logic, nothing to gain by wrapping it in `Effect`. The `solve` subcommand's implementation function calls `solveFile()` (already an `Effect`) and only unwraps to exit code/stdout at that function's own boundary, per ADR-003 §2.4. |
| III. Graphs as the Constraint Representation | N/A | This feature touches no `@relateby/pattern` graph — it's a thin CLI layer over an existing capability. |
| IV. Design-First, Then Test-First | PASS | Design (RFC-002 → ADR-002 → ADR-003 → this spec) precedes implementation. `tests/cli/*.test.ts` (Phase 2, tasks.md) must be written first and fail against the current repo (no `bin` exists yet) before implementation makes them pass. |

No violations — Complexity Tracking is not needed.

## Project Structure

### Documentation (this feature)

```text
specs/003-cli-interface/
├── plan.md                    # This file (/speckit-plan command output)
├── research.md                # Phase 0 output (/speckit-plan command)
├── data-model.md              # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── cli-contract.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md              # Phase 1 output (/speckit-plan command)
└── tasks.md                   # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── cli/
│   ├── main.ts                    # bin entrypoint: buildRouteMap + buildApplication + run (FR-001, FR-008–011)
│   └── subcommands/
│       └── solve.ts               # `solve` subcommand: buildCommand with typed flags/positional, calls src/solver/solve.ts's solveFile() (FR-002–007)
└── solver/                        # existing (specs/002-minizinc-integration) — solve.ts refactored (not redesigned)
                                    # to add a path-based solveFile() entrypoint alongside the existing
                                    # content-based solve(), sharing one internal minizinc-invocation/
                                    # classification helper (see Summary's revision note above)

tests/
└── cli/
    └── cli.test.ts                 # SC-001–007, spawns the built bin as a subprocess

package.json                        # adds "bin": { "zebra": "./src/cli/main.ts" }, dependency on @stricli/core
```

**Structure Decision**: Single-project structure, consistent with prior features. Adds
`src/cli/` as this repo's first CLI entrypoint (built on `@stricli/core`) and a matching
`tests/cli/` suite. `src/solver/solve.ts` gets a small, additive refactor — a new path-based
`solveFile()` entrypoint sharing its core logic with the existing `solve()` — rather than staying
fully untouched; no solving logic is duplicated or reimplemented (FR-003), and `solve()`'s own
signature/behavior/tests are unaffected.

## Complexity Tracking

*No Constitution Check violations — this section is not needed.*
