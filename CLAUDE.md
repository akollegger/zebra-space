# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

This repository is a fresh scaffold with no application source code yet — only `package.json`, the pnpm lockfile/workspace config, and this documentation. There are no commits on `main`. When adding the first real code, establish the directory layout and update this file's Architecture section accordingly.

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
pnpm test          # placeholder — no tests configured yet, exits with an error
```

`pnpm-workspace.yaml` currently only sets `allowBuilds` for `msgpackr-extract` (a transitive dependency's native build gate) — there are no workspace packages defined yet.

## Key dependencies

- **`effect`** — the `Effect` functional-effects library. Expect puzzle generation/solving logic to be modeled as `Effect` pipelines (Effect, Option, pipe, etc.) rather than plain async/await or thrown exceptions.
- **`@relateby/pattern`** — native TypeScript `Pattern`/`Subject`/`StandardGraph` APIs (backed by a Rust "gram" codec) for representing puzzles as graphs. Notable pieces:
  - `Subject.fromId(...).withLabel(...).withProperty(...)` builds graph entities.
  - `Pattern` composes subjects/relationships; `StandardGraph.fromPatterns([...])` builds a queryable graph.
  - `Gram.parse` / `Gram.stringify` / `Gram.validate` read/write the gram text notation and return `Effect` values.
  - `patternToRaw` / `patternFromRaw` / `validatePayload` convert to/from a JSON-safe interchange format — intended for passing patterns from a WASM-capable producer (e.g. a server) to a WASM-less consumer (e.g. a browser client).

This points toward an architecture where puzzle constraints are represented as **gram graphs** (via `@relateby/pattern`), and puzzle generation/solving is orchestrated with **Effect** pipelines.

## Design process: RFC → ADR → speckit

This project uses [speckit](https://github.com/github/spec-kit) (`.specify/`, `.claude/skills/speckit-*`) for spec-driven implementation, extended with an RFC/ADR layer that must precede it. Together they form a double-diamond: RFC covers Discover/Define, ADR covers Develop, speckit covers Deliver.

- **RFC** (`design/rfc/RFC-NNN-*.md`, via `/rfc-create`) — the problem and why it matters, plus high-level candidate approaches. WHAT/WHY only, no implementation detail.
- **ADR** (`design/adr/ADR-NNN-*.md`, via `/adr-create`) — one technical decision, concrete enough to implement. Always requires an existing parent RFC (`rfc:` front-matter field); `/adr-create` never creates or touches anything under `specs/`.
- **speckit** (`specs/NNN-*/`, via `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`) — implementation, seeded from one or more ADRs referenced in the `/speckit-specify` call (e.g. `/speckit-specify ADR-005: <description>`).

This is enforced, not just conventional: `/speckit-specify` has mandatory hooks registered in `.specify/extensions.yml`:
- `before_specify` → `speckit-adr-gate` hard-blocks the call if it doesn't reference at least one existing ADR (bare `ADR-5`, zero-padded, filename, or `@design/adr/ADR-005-*.md` form all resolve).
- `after_specify` → `speckit-adr-link` backlinks the new `spec.md` (a `**Derived From**` line) to its ADR(s), and appends the spec's path to each ADR's `specs:` list.

Do not bypass this by hand-editing `spec.md`/`plan.md` without a corresponding ADR, and don't hand-edit the `adrs:`/`specs:` front-matter lists that `/adr-create` and `speckit-adr-link` maintain automatically.
