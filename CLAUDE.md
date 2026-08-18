# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See [README.md](README.md) for the project's mission, non-goals, and a human-facing summary of
the design process (its own "Design Process" section). This file is the more detailed,
operational counterpart: commands, key dependencies, and the mechanics of how RFC/ADR/speckit
are actually enforced. The other top-level READMEs (`design/rfc/README.md`, `design/adr/README.md`,
`catalog/README.md`, `catalog/mzn/README.md`) are each scoped to their own directory — living
indexes and format docs for that directory's content — and are linked from the relevant sections
below rather than duplicated here.

## Project state

`catalog/` holds a seeded puzzle catalog (`catalog/puzzles/PZL-NNNN-*.md`, indexed in `catalog/README.md`, per [ADR-001](design/adr/ADR-001-catalog-format-seeding.md)) plus a growing MiniZinc example catalog (`catalog/mzn/*.mzn`, per [ADR-002](design/adr/ADR-002-adopt-minizinc-solver.md) §2.6). `src/solver/` holds the MiniZinc solve-and-classify capability (ADR-002); `tests/` holds automated checks against both (`pnpm test`, Node's built-in test runner). There is otherwise still no puzzle generation or graph representation. When adding that, establish the directory layout and update this file's Architecture section accordingly.

## Purpose

Zebra Space is for working with [zebra puzzles](https://en.wikipedia.org/wiki/Zebra_Puzzle) (aka Einstein's puzzles) end-to-end:

1. Generating prose puzzles
2. Modeling puzzles as [constraint satisfaction problems](https://en.wikipedia.org/wiki/Constraint_satisfaction_problem)
3. Representing constraints as graphs
4. Solving puzzles with a solver

Background reading: [Context Graphs & Agentic Decisions](https://medium.com/neo4j/context-graphs-agentic-decisions-9a125f22f411) and [Solving Zebra Puzzles Using Constraint-Guided Multi-Agent Systems](https://arxiv.org/html/2407.03956v3). [MiniZinc](https://www.minizinc.org) is referenced as prior art for constraint modeling/solving.

## Commands

Package manager is **pnpm** (pinned via `packageManager` in `package.json`; Node version pinned in `.tool-versions` via asdf/mise).

```bash
pnpm install       # install dependencies
pnpm test          # runs tests/**/*.test.ts via Node's built-in test runner (node --test)
```

`pnpm-workspace.yaml` currently only sets `allowBuilds` for `msgpackr-extract` (a transitive dependency's native build gate) — there are no workspace packages defined yet.

**MiniZinc prerequisite**: `src/solver/`'s tests require the `minizinc` CLI with a registered
finite-domain (CP) solver (Gecode by default — MIP-only solvers like COIN-BC don't support the
multi-solution enumeration this project needs). Install MiniZinc (e.g. `brew install minizinc`
on macOS), then run `./scripts/setup-minizinc-solver.sh` to check/register a CP solver if it
isn't wired up automatically (see `specs/002-minizinc-integration/research.md` Finding 1 for
why that step is sometimes needed).

## Key dependencies

- **`effect`** — the `Effect` functional-effects library (pinned to the `4.0.0-rc` line, currently `4.0.0-rc.110` — upgraded from the `4.0.0-beta` line once the release train reached RC; the beta pin was a pragmatic stopgap while the API was still churning). Expect puzzle generation/solving logic to be modeled as `Effect` pipelines (Effect, Option, pipe, etc.) rather than plain async/await or thrown exceptions. Note: the entire `@effect/*` ecosystem (`@effect/platform`, `@effect/ai` and its provider packages, `@effect/cli`, etc.) has **not** caught up to `effect` 4.x at all as of this pin — every recent release still peer-depends on `effect@^3.22.x`, incompatible here regardless of which 4.x prerelease is pinned. Confirmed broken for `@effect/platform`'s `Command` module (see `specs/002-minizinc-integration/research.md`/`tasks.md` T001) — `src/solver/solve.ts` instead wraps `node:child_process` by hand in an `Effect`. Confirmed broken the same way for `@effect/ai` (see `design/spikes/SPIKE-004-llm-based-extraction/SPIKE.md`) — that spike used `@openrouter/sdk` directly instead (a thin API client with zero peer dependencies, not an agentic framework) wrapped by hand the same way. Treat this as a standing pattern, not a one-off: check any new `@effect/*` package's peer dependency on `effect` before adopting it, and default to hand-wrapping the underlying capability in an `Effect` when it doesn't match. **Before writing any Effect code**, read `node_modules/effect/AGENTS.md` completely and follow its links when relevant — it's kept in sync with the exact pinned version, unlike general Effect knowledge, which may assume a different API surface (confirmed: this pinned `4.0.0-rc.110` build is still missing some otherwise-standard combinators, e.g. `Effect.either`/`Effect.fromEither`, carried over from the beta line). The `effect-ts` skill (`~/.claude/skills/effect-ts`) points here.
- **`@relateby/pattern`** — native TypeScript `Pattern`/`Subject`/`StandardGraph` APIs (backed by a Rust "gram" codec) for representing puzzles as graphs. Notable pieces:
  - `Subject.fromId(...).withLabel(...).withProperty(...)` builds graph entities.
  - `Pattern` composes subjects/relationships; `StandardGraph.fromPatterns([...])` builds a queryable graph.
  - `Gram.parse` / `Gram.stringify` / `Gram.validate` read/write the gram text notation and return `Effect` values.
  - `patternToRaw` / `patternFromRaw` / `validatePayload` convert to/from a JSON-safe interchange format — intended for passing patterns from a WASM-capable producer (e.g. a server) to a WASM-less consumer (e.g. a browser client).

This points toward an architecture where puzzle constraints are represented as **gram graphs** (via `@relateby/pattern`), and puzzle generation/solving is orchestrated with **Effect** pipelines.

## Design process: RFC → ADR → speckit

This project uses [speckit](https://github.com/github/spec-kit) (`.specify/`, `.claude/skills/speckit-*`) for spec-driven implementation, extended with an RFC/ADR layer that must precede it. Together they form a double-diamond: RFC covers Discover/Define, ADR covers Develop, speckit covers Deliver.

- **RFC** (`design/rfc/RFC-NNN-*.md`, via `/rfc-create`; reviewed via `/rfc-review`) — the problem and why it matters, plus high-level candidate approaches. WHAT/WHY only, no implementation detail. Numbered `##` sections (renumber if one is omitted); index at `design/rfc/README.md`.
- **ADR** (`design/adr/ADR-NNN-*.md`, via `/adr-create`; reviewed via `/adr-review`) — one technical decision, concrete enough to implement. Always requires at least one existing parent RFC (`rfcs:` front-matter field, a list — an ADR MAY serve more than one RFC when it's genuinely shared infrastructure, e.g. a CLI shape multiple problem explorations depend on); `/adr-create` never creates or touches anything under `specs/`. Index at `design/adr/README.md`.
- **speckit** (`specs/NNN-*/`, via `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`) — implementation, seeded from one or more ADRs referenced in the `/speckit-specify` call (e.g. `/speckit-specify ADR-005: <description>`).

`/rfc-create` and `/adr-create` keep their respective `design/*/README.md` index tables in sync automatically — don't hand-edit those tables. Use `/rfc-review`/`/adr-review` before moving a draft to `review`/`accepted` status; they report findings and suggested revisions but don't edit the document themselves.

This is enforced, not just conventional: `/speckit-specify` has mandatory hooks registered in `.specify/extensions.yml`:
- `before_specify` → `speckit-adr-gate` hard-blocks the call if it doesn't reference at least one existing ADR (bare `ADR-5`, zero-padded, filename, or `@design/adr/ADR-005-*.md` form all resolve).
- `after_specify` → `speckit-adr-link` backlinks the new `spec.md` (a `**Derived From**` line) to its ADR(s), and appends the spec's path to each ADR's `specs:` list.

Do not bypass this by hand-editing `spec.md`/`plan.md` without a corresponding ADR, and don't hand-edit the `adrs:`/`specs:` front-matter lists that `/adr-create` and `speckit-adr-link` maintain automatically.
