# Implementation Plan: Deck YAML Format Library Support

**Branch**: `005-deck-yaml-format` | **Date**: 2026-09-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-deck-yaml-format/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Add a `src/deck/` library that parses a deck YAML document (ADR-006), validates its structural
rules (dangling references, dependency cycles, unsupported tier/constraint values), derives each
card's classification without any hand-authored role field, converts the deck's `csp` block to
the project's existing `ExtractedCsp` representation, and solves it via the existing solving
capability — producing a solved outcome and, when uniquely solvable, the closure's specific
answer. A new `zebra deck` CLI subcommand exposes the whole pipeline as one command, satisfying
Constitution Principle VI.

## Technical Context

**Language/Version**: TypeScript, run directly under Node (this repo's pinned Node version via
`.tool-versions`) — no separate build step, matching `src/solver`/`src/compiler`/`src/extraction`.

**Primary Dependencies**: `effect` (existing, pinned `4.0.0-rc.110`) for all control flow per
Constitution Principle II; `yaml` (new — research.md Finding 1) for parsing; `@stricli/core`
(existing) for the new CLI subcommand.

**Storage**: Filesystem only — deck documents are `.yaml` files, conventionally under
`catalog/decks/` (ADR-006 §2.4). No database, no new persistent state.

**Testing**: Node's built-in test runner (`node --test`, existing `pnpm test` convention),
`tests/deck/` alongside the existing `tests/solver/`, `tests/compiler/`, `tests/extraction/`
directories.

**Target Platform**: Node.js — a library consumed by other TypeScript code, plus a CLI
subcommand; no browser or server target.

**Project Type**: Library, with a thin CLI subcommand extension (mirrors `extract`/`solve`).

**Performance Goals**: None beyond "a single CLI/library call returns promptly" — this feature
is authoring-time/pre-play validation and one-shot solving, not the per-swipe interactive solving
RFC-005 §5.7 already defers as separate, unbuilt work.

**Constraints**: Offline — no network access, consistent with `pnpm test`'s existing constraint.
Non-interactive and closed-world (Constitution Principle VI): report a validation problem or an
unresolved closure answer rather than guessing or asking a follow-up question.

**Scale/Scope**: Decks are small by design (RFC-005 §5.5: 10–16 cards over 3–5 entities) — no
scale concern.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. RFC/ADR-Gated Delivery | **Pass** | Derived from ADR-006 (parent RFC-005); `speckit-adr-gate` already passed for this spec. |
| II. Effect-Idiomatic Code | **Pass** | Loading, validation, and solving are `Effect` pipelines throughout `src/deck/`, following `src/solver`/`src/compiler`'s existing style (research.md Finding 2). |
| III. Graphs as the Constraint Representation | **Justified deviation, not new** | `deck.csp` mirrors `ExtractedCsp`'s plain data shape, not `@relateby/pattern` graphs — the same deviation ADR-002 §2.6/ADR-005 already recorded and deferred, not a new one this feature introduces. See Complexity Tracking. |
| IV. Design-First, Then Test-First | **Pass** | Design is this plan, seeded from ADR-006; `/speckit-tasks`/`/speckit-implement` will write failing tests before implementation, per existing project practice. |
| V. Lint-Clean, Type-Safe Code | **Pass** | No new dependency requires weakening `tsconfig.json`'s strictness or disabling a Biome rule. |
| VI. A Callable Tool, Not a Decision System | **Pass** | The `zebra deck` subcommand (contracts/cli-contract.md) makes this capability command-invocable; `DeckError`/`AnswerError` report problems rather than resolving them (FR-002–FR-004, FR-009). |

*Re-checked after Phase 1 design — no new violations surfaced; the single justified deviation
(Principle III) is unchanged and remains recorded in Complexity Tracking below.*

## Project Structure

### Documentation (this feature)

```text
specs/005-deck-yaml-format/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── library-contract.md
│   └── cli-contract.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── deck/                    # NEW — this feature
│   ├── types.ts             # Deck, Card, Csp, Constraint, Closure, CardClassification,
│   │                        # SolvedDeck, DeckError (data-model.md)
│   ├── load.ts              # loadDeck/loadDeckFile: parse (yaml) + validate (Effect)
│   ├── classify.ts          # classifyCards (pure)
│   └── solve.ts             # deckCsp + solveDeck (Effect; calls existing src/solver/solve.ts)
├── cli/
│   └── subcommands/
│       └── deck.ts          # NEW — `zebra deck` subcommand
├── extraction/               # existing, unmodified — Constraint/ArithmeticExpression/
│                              # DerivedCondition/RuleTableOperand types reused directly
├── solver/                   # existing, unmodified — solve()/SolveResult reused directly
└── compiler/                 # existing, unmodified

tests/
└── deck/                    # NEW — fixtures per quickstart.md's "Running the test suite"
    ├── fixtures/*.yaml
    ├── load.test.ts
    ├── classify.test.ts
    └── solve.test.ts
```

**Structure Decision**: A new `src/deck/` module alongside the existing `src/extraction/`,
`src/solver/`, `src/compiler/` — same flat, single-project layout (Option 1), no new top-level
directory or package boundary. `src/deck/` depends on `src/extraction/types.ts` (for the
`Constraint`-adjacent shared types) and `src/solver/` (for solving), matching the existing
one-directional dependency flow (extraction → compiler → solver, with `deck` as a new consumer
at the same layer as a puzzle would be, not inserted between existing layers).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `deck.csp` uses plain data structures (mirroring `ExtractedCsp`), not `@relateby/pattern` graphs (Principle III) | ADR-006 §1/§2.2 deliberately aligns the deck format's constraint vocabulary with `ExtractedCsp` so a deck's `csp` block solves via the existing pipeline with no translation step | Representing decks as `@relateby/pattern` graphs now would require building the graph→MiniZinc compilation path ADR-002 §2.6 and ADR-005 already deferred as future work project-wide — this feature would then block on work no other part of the codebase has done yet, to represent a puzzle a shape nothing currently consumes |
