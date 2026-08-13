---
id: ADR-003
title: CLI Interface Shape
status: proposed
rfcs: [RFC-002]
created: 2026-08-13
specs: []
---

# ADR-003: CLI Interface Shape

## 1. Context

RFC-002/ADR-002 gives this project a real, working `solve()` capability
(`src/solver/solve.ts`, `specs/002-minizinc-integration`) with no way for a person to invoke it
directly from a terminal. A CLI tool was floated earlier, during discussion of catalog
modification, but that's a separate, not-yet-designed workstream — this ADR is scoped to what
exists now: exposing `solve`.

This ADR decides the CLI's interface *shape* — how a user invokes any of this project's
capabilities, not just this one — and its first concrete subcommand, `solve`. The shape is
deliberately more general than `solve` alone, so future capabilities can be added as new
subcommands without redesigning what's already shipped. Those future additions are follow-up
edits to *this* ADR when they have a concrete design, not something this ADR preemptively
parents itself to now: per the constitution's RFC:ADR many-to-many convention (Principle I,
v1.1.0), an ADR gains an additional parent RFC when a decision concretely serves it, not on
spec. This ADR's only parent is RFC-002, because `solve` is the only thing it actually decides
right now.

**A load-bearing constraint discovered before drafting**: `@effect/cli` (the "effect-cli" the
original ask named) is not usable here. Its latest stable release (0.77.0) peer-depends on
`effect@^3.22.1` and `@effect/platform@^0.97.1` — the exact same incompatibility ADR-002/spec
002's T001 already hit and worked around, since this repo is pinned to `effect@4.0.0-beta.107`.
This ADR's argument-parsing decision (2.3) is a direct consequence of that finding, not a
stylistic preference.

## 2. Decision

### 2.1 Shape

Subcommand-oriented: `zebra <subcommand> [args...] [flags...]` — matching `git`/`gh`/`docker`/
`kubectl`/`pnpm` convention rather than a single-purpose flat-flag tool. Standard global flags:
`--help`/`-h` (both top-level, listing available subcommands, and per-subcommand, describing
that subcommand's own args/flags) and `--version`. An unknown subcommand prints the available
subcommand list and exits non-zero — it never silently no-ops.

### 2.2 First subcommand: `solve`

```
zebra solve <model.mzn> [--data <file.dzn>] [--solver <id>] [--json]
```

Reads the given `.mzn` (and optional `.dzn`) file(s) from disk and calls `solve()`
(`src/solver/solve.ts`) with their contents. Default output is human-readable (the classified
outcome — unsatisfiable / uniquely solvable, with its assignment / multiply satisfiable — printed
plainly); `--json` prints the same information as JSON, mirroring `solve()`'s own `SolveResult`
shape (data-model.md, `specs/002-minizinc-integration`) rather than inventing a second output
schema.

Exit codes are reserved for actual errors, not for the *content* of a valid result: any
successful `solve()` outcome — `UniquelySolvable`, `Unsatisfiable`, and `MultiplySatisfiable`
alike — exits `0`. `Unsatisfiable` and `MultiplySatisfiable` are meaningful, correct answers,
not failures; `solve` reports what's true about the model, it doesn't judge whether the puzzle
is "good." Only a `SolverError` (the solver itself couldn't run or complete) exits non-zero,
with the error printed to stderr. Whether a puzzle *should* be flagged for not being uniquely
solvable is a separate, future concern — e.g. a puzzle-linting subcommand that opts into treating
non-uniqueness as a warning or failure — and is out of scope for `solve` itself.

### 2.3 Argument parsing and subcommand dispatch

Node's built-in `node:util.parseArgs` handles flag/positional parsing — zero new dependencies,
and the only option compatible with this repo's pinned `effect@4.0.0-beta.107` (Context;
`@effect/cli` is not). Subcommand dispatch (mapping the first positional argument to a handler)
is hand-rolled — a plain lookup, not a library — consistent with `solve.ts`'s own precedent of
wrapping Node built-ins by hand in `Effect` rather than reaching for `@effect/platform`/
`@effect/cli`.

### 2.4 Effect usage

Each subcommand's handler is still an `Effect` pipeline — typed errors, no thrown exceptions.
The `solve` subcommand's handler calls `solve()` directly (already an `Effect`) and only
converts to a process exit code / stdout output at the outermost boundary
(`Effect.runPromise`/`Effect.runPromiseExit` at the CLI entrypoint) — not scattered through the
logic.

### 2.5 Package and entrypoint

A `bin` entry in `package.json` (e.g. `"zebra": "./src/cli/main.ts"`) plus a corresponding
entrypoint file. The exact path/filename is an implementation detail for the eventual
`/speckit-specify` spec to settle, not this ADR's job to pin precisely — this ADR only commits
to *that* a `bin` field and entrypoint are needed, and that `solve` is reachable through it.

## 3. Alternatives Considered

- **`@effect/cli`** (the original ask). Rejected: incompatible peer dependencies (Context) — not
  a stylistic rejection, a hard version-compatibility blocker with this repo's pinned `effect`.
- **A third-party argument-parsing library** (commander, yargs, cac). Rejected: this project has
  consistently preferred Node built-ins over new dependencies where they're sufficient (native
  TypeScript execution, the built-in test runner, and now this) — `node:util.parseArgs` covers
  what a `solve`-sized CLI needs without adding a dependency.
- **A flat, single-purpose tool with no subcommands** (e.g. a bare `zebra-solve` binary).
  Rejected: the entire point of deciding the *shape* now, ahead of every individual capability,
  is that `solve` today, and whatever this project adds next, don't fit one flat command — a
  subcommand structure is what lets this ADR be extended rather than replaced as more
  capabilities arrive.
- **Plain npm/pnpm scripts instead of a dedicated CLI** (e.g. `pnpm solve <file>`). Rejected:
  this project's own [README](../../README.md) frames it as "a place for" generating, modeling,
  representing, and solving puzzles — an active, user-facing set of capabilities, not just an
  internal library other code happens to import. A real `bin`/subcommand tool makes that framing
  concrete: discoverable via `--help`, invocable outside the repo, and structured to grow as
  more of those capabilities get their own subcommands. Scripts don't carry that user-facing
  intent the same way, and don't compose into a single discoverable entry point.

## 4. Consequences

- This ADR's Decision is deliberately incomplete by design — it specifies `solve` and nothing
  else. Every future subcommand this project adds is a follow-up addition to *this* ADR, not a
  new one, since they'd all share this interface-shape decision — and whichever RFC motivates
  that subcommand becomes an additional parent RFC at that time (constitution Principle I,
  v1.1.0), not preemptively now. Reviewers should expect this document to grow.
- Exit codes signal tool failure only, never puzzle "quality" — `Unsatisfiable`/
  `MultiplySatisfiable` exit `0` alongside `UniquelySolvable` (2.2). This deliberately leaves
  room for a future puzzle-linting subcommand to make non-uniqueness a warning or failure on its
  own terms, without `solve` having pre-judged that question.
- The hand-rolled subcommand dispatcher (2.3) is a simple lookup adequate for one subcommand; it
  will need real structure (a registry/table, shared flag-parsing helpers) once a second
  subcommand is added — that structure isn't designed yet and shouldn't be speculatively built
  now for a dispatcher with one entry.
- No shell-completion story yet (bash/zsh/fish completions) — not needed until the subcommand
  surface is large enough to make tab-completion valuable.
- `node:util.parseArgs` is less featureful than a CLI library: no auto-generated per-subcommand
  help text, no built-in validation errors. `--help` output is hand-maintained per subcommand
  for now, a real (if small) ongoing cost traded for the zero-new-dependency benefit.

## 5. Related

- RFCs: RFC-002
- Specs: _(populated automatically by the speckit ADR-link hook once `/speckit-specify` references this ADR)_
