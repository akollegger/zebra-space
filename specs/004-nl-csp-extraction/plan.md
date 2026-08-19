# Implementation Plan: Natural-Language Puzzle to Solvable CSP Extraction

**Branch**: `004-nl-csp-extraction` | **Date**: 2026-08-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-nl-csp-extraction/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Add a `zebra extract <puzzle.md>` CLI subcommand (ADR-003 §2.6) that turns a prose zebra puzzle
into a compiled MiniZinc model by default, or its raw `ExtractedCsp` structure with `--json`. An
LLM produces the `ExtractedCsp`; a second, schema-constrained LLM call critiques it for fidelity
to the source prose (not solvability) and, on rejection, feeds its specific issues back for a
bounded number of same-tier revisions before escalating to a materially different model tier
(ADR-004 §2.4). A separate, purely mechanical compiler (ADR-005) renders an accepted
`ExtractedCsp` to `.mzn` text — it has no dependency on the critic loop and is reused verbatim for
both the CLI's default output and any other future consumer.

## Technical Context

**Language/Version**: TypeScript (pinned `typescript@^7.0.2`, tsgo preview, per package.json and
Constitution Principle V) targeting Node.js 24.14.1 (`.tool-versions`)

**Primary Dependencies**: `effect@4.0.0-rc.110` (critic-loop control flow), `@openrouter/sdk`
(new — LLM calls for both extraction and critique, hand-wrapped in `Effect.tryPromise` per
ADR-004 §2.3, the same pattern `src/solver/solve.ts` already uses for `node:child_process`),
`@stricli/core@^1.3.0` (existing CLI framework, new `extract` command mirrors `solve.ts`)

**Storage**: N/A — reads a puzzle Markdown file from disk (`catalog/puzzles/PZL-NNNN-*.md`
shape), writes rendered output to stdout; no persistence layer

**Testing**: `node --test` via `pnpm test`, extending the existing `tests/` layout; see Research
Finding 2 for why this feature's default suite stubs the LLM provider boundary rather than
following `tests/solver/`'s live-CLI-invocation convention

**Target Platform**: Node.js CLI, run locally or in CI (macOS/Linux dev machines per this
project's existing `zsh`/macOS tooling conventions)

**Project Type**: Single project — extends the existing CLI (`src/cli/`) with a new subcommand
and two new top-level capability modules (`src/extraction/`, `src/compiler/`), mirroring how
`src/solver/` was added in specs/002

**Performance Goals**: Not latency-critical — bounded by LLM API round-trip time, not a
throughput target; a single `extract` invocation processing one puzzle is the whole scope (no
batch/service mode)

**Constraints**: Default `pnpm test` run MUST NOT require network access, an API key, or incur
per-run cost (Research Finding 2); critic-loop attempts are bounded per ADR-004 §2.4 (2
same-tier revisions before escalating, a fixed small number of tiers) rather than open-ended
retry

**Scale/Scope**: Single-puzzle, single-invocation CLI usage — no concurrent extraction, no
persisted extraction history/corpus (explicitly out of scope, spec.md Assumptions)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. RFC/ADR-Gated Delivery | PASS | Seeded from ADR-003 §2.6, ADR-004, ADR-005, each with RFC-002 and/or RFC-003 as parent(s); this plan itself is the mechanism, not a violation of it. |
| II. Effect-Idiomatic Code | PASS | Critic loop and provider calls are `Effect` pipelines per ADR-004 §2.3/§2.4 (see Research Finding 1 for the specific combinator choices); no bare `async`/`await` in `src/extraction/` or `src/compiler/`. |
| III. Graphs as the Constraint Representation | **DEVIATION (justified)** | `ExtractedCsp` (ADR-004 §2.2, refined by ADR-005 §2.4/§2.5) is a bespoke TypeScript type, not a `@relateby/pattern` `Pattern`/`Subject`/`StandardGraph`. See Complexity Tracking below — this is a knowing, already-reviewed deviation, not new scope creep. |
| IV. Design-First, Then Test-First | PASS | RFC-003 → ADR-004/005 → this spec/plan already completed the design-first half; implementation tasks (speckit-tasks, not this plan) will follow test-first. |
| V. Lint-Clean, Type-Safe Code | PASS | No planned use of relaxed tsconfig settings or suppressed Biome rules; `DerivedCondition`/`ArithmeticExpression` discriminated unions (ADR-005 §2.4/§2.5) are precisely what strict mode is for. |

**Post-Phase 1 re-check**: data-model.md consolidated ADR-004/ADR-005's types into one canonical
module without introducing any new bespoke abstraction beyond what those ADRs already decided;
`contracts/cli-contract.md` and `quickstart.md` introduced no new dependency or structure. The
table above is unchanged after design — the Principle III deviation remains the only gap, still
justified as above, nothing new surfaced.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
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
│   ├── types.ts          # ExtractedCsp, ExtractedConstraint, FidelityCritique,
│   │                       DerivedCondition, ArithmeticExpression, ExtractionError taxonomy
│   └── extract.ts         # extract→critique→revise→escalate Effect pipeline (ADR-004 §2.3/§2.4),
│                           hand-wrapped @openrouter/sdk calls
├── compiler/
│   └── compile.ts         # ExtractedCsp -> .mzn text (ADR-005), no dependency on extraction/
├── cli/
│   ├── main.ts             # existing route map, gains `extract` alongside `solve`
│   └── subcommands/
│       └── extract.ts      # new Stricli command, mirrors solve.ts; --json / --model / --frontier-model
└── solver/                 # existing (specs/002), unchanged — extract never calls solve

tests/
├── extraction/
│   ├── extract.test.ts     # default suite: critic-loop control flow against a stubbed
│   │                        provider boundary (Research Finding 2) — deterministic, no network
│   └── live.test.ts        # opt-in: real OpenRouter calls, auto-skipped without OPENROUTER_API_KEY
├── compiler/
│   └── compile.test.ts     # default suite: ExtractedCsp -> .mzn rendering, pure/deterministic
└── cli/
    └── cli.test.ts          # existing, extended with `extract` invocation cases
```

**Structure Decision**: Single project, extending the existing `src/`/`tests/` layout the same
way specs/002 (`src/solver/`) and specs/003 (`src/cli/`) already did — no new top-level project,
no web/mobile split. `src/extraction/` and `src/compiler/` are new top-level capability modules,
consistent with `src/solver/`'s precedent of one directory per pipeline stage rather than a
single monolithic module.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|---------------------------------------|
| Principle III: `ExtractedCsp` is a bespoke TypeScript type, not a `@relateby/pattern` graph | The graph representation of puzzle constraints is explicitly undesigned/out-of-scope work — RFC-003's own scope and ADR-004's Context/§4 both name it as future work, not something this feature can respect without inventing that design itself, unreviewed, mid-implementation. `ExtractedCsp` was deliberately shaped to make that future translation cheap (ADR-004 §2.2: entities/constraints as candidate nodes/edges), so this isn't a structure that forecloses Principle III — it's a documented stepping stone toward it. | Building the `Pattern`/`Subject`/`StandardGraph` representation now, inside this feature, would mean inventing a second, undesigned architectural decision (how puzzle constraints map to `@relateby/pattern` primitives) mid-implementation — ADR-004 already names the graph-representation compiler as explicitly out of scope (Context: "the graph-representation compiler (RFC-003 Non-Goal, still undesigned)") and RFC-003 itself scopes it as a Non-Goal. That mapping deserves its own RFC/ADR when the graph-representation work is actually taken up, not an ad hoc choice made here to satisfy this gate. |
