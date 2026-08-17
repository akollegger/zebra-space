---
id: ADR-003
title: CLI Interface Shape
status: proposed
rfcs: [RFC-002]
created: 2026-08-13
specs:
  - specs/003-cli-interface
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
stylistic preference. [Tracking issue #5](https://github.com/akollegger/zebra-space/issues/5)
watches for `@effect/platform`/`@effect/cli` catching up to the Effect 4.0 line — independent of
that, though: 2.3's actual choice (Stricli) stands on its own merits, not as a placeholder
waiting for that issue to close.

## 2. Decision

### 2.1 Shape

Subcommand-oriented: `zebra <subcommand> [args...] [flags...]` — matching `git`/`gh`/`docker`/
`kubectl`/`pnpm` convention rather than a single-purpose flat-flag tool.

**Global-flag dispatch is precise, not just "global flags exist"**: `argv[0]` is the *only*
position that determines global vs. subcommand handling. If `argv[0]` is `--help`, `-h`, or
`--version`, it's handled globally and the process exits immediately, ignoring everything else
in `argv`. Otherwise, `argv[0]` is the subcommand name, and everything in `argv.slice(1)`
belongs entirely to that subcommand — including its own `--help`/`-h`, defined independently
rather than reusing the top-level handler. Global flags are never recognized once a subcommand
has been identified: `zebra solve --version` is an unrecognized option for `solve`, not a global
version print. This is the behavior a user sees; per 2.3, it's provided by Stricli's own
route-map/command model, not hand-derived dispatch logic — the rule is stated here precisely
because it's still this ADR's decision about *what* the CLI does, independent of *how* (2.3).

An unknown subcommand (i.e. `argv[0]` matches neither the global flag set nor a registered
subcommand) prints the available subcommand list and exits non-zero — it never silently no-ops.

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

[`@stricli/core`](https://bloomberg.github.io/stricli/) (Bloomberg's TypeScript-native CLI
framework) handles flag/positional parsing and subcommand dispatch — `buildCommand` defines the
`solve` subcommand with typed flag/positional parameter definitions, `buildRouteMap` registers
it (and any future subcommand) under the top-level dispatcher, and `run` drives the entrypoint.

Verified before drafting: `@stricli/core@1.3.0` has **zero runtime dependencies and zero peer
dependencies** — no repeat of the `@effect/cli`/`@effect/platform` incompatibility (Context).
The published package is already-compiled ESM+CJS with a `.d.ts`, so it imports cleanly into
this repo's no-build-step native-TypeScript setup like any other dependency (its own quick-start
docs use a `tsup` build step for *its* example template, not a requirement it imposes on
consumers).

Stricli's defining property, and the reason it's chosen over a more established but
less-type-safe option (3, commander): flag/positional parameter definitions are declared once
and their types flow automatically into the command implementation's function signature — no
restating a separate options interface, no casting a loosely-typed parsed-options object.
Combined with built-in `--help`/`-h`/`--version`/`-v` generation and native route-map-based
subcommand dispatch, it implements 2.1's global-vs-subcommand dispatch rule correctly out of the
box, rather than this project hand-deriving and hand-maintaining it (which is what the original
version of this ADR did — see 3).

### 2.4 Effect usage

Each subcommand's implementation function (the `func` passed to Stricli's `buildCommand`) is
still an `Effect` pipeline — typed errors, no thrown exceptions. The `solve` subcommand's
implementation calls `solve()` directly (already an `Effect`) and only converts to a process
exit code / stdout output at that function's own boundary
(`Effect.runPromise`/`Effect.runPromiseExit`) — not scattered through the logic. Stricli itself
has no opinion about `Effect`; this boundary is entirely this project's own convention, applied
inside whatever function Stricli calls for a given subcommand.

### 2.5 Package and entrypoint

A `bin` entry in `package.json` (e.g. `"zebra": "./src/cli/main.ts"`) plus a corresponding
entrypoint file. The exact path/filename is an implementation detail for the eventual
`/speckit-specify` spec to settle, not this ADR's job to pin precisely — this ADR only commits
to *that* a `bin` field and entrypoint are needed, and that `solve` is reachable through it.

## 3. Alternatives Considered

- **`@effect/cli`** (the original ask). Rejected: incompatible peer dependencies (Context) — not
  a stylistic rejection, a hard version-compatibility blocker with this repo's pinned `effect`.
- **`node:util.parseArgs` + hand-rolled subcommand dispatch** (this ADR's original 2.3 decision).
  Rejected on reflection, before any implementation existed to migrate away from: real design
  effort was already spent precisely hand-deriving the exact global-vs-subcommand dispatch
  semantics 2.1 states (which position global flags are recognized at, how they interact with
  subcommand-owned flags, who owns `--help` at each level) — exactly what a purpose-built
  dispatch library exists to standardize. Continuing to hand-roll it, and hand-maintain
  per-subcommand help text, would have kept paying that cost as more subcommands are added.
- **`commander`**. A real contender — zero dependencies, extremely mature (~415M weekly
  downloads at the time of this decision), and the most battle-tested option available. Rejected
  in favor of Stricli specifically on type safety: commander's parsed options come back as a
  loosely-typed object, typically requiring a separately-declared interface and a cast to use
  safely, whereas Stricli's parameter definitions flow their types into the command
  implementation automatically. Given this project already treats typed correctness as a core
  value (`Effect` pipelines, typed `SolverError` variants), that structural difference outweighed
  commander's much larger adoption — accepting Stricli's real (if not alarming) maturity/
  community-support tradeoff (~584K weekly downloads at the time of this decision, but actively
  maintained by Bloomberg, not abandoned) in exchange.
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
- Adding a second subcommand means registering it in Stricli's route map (2.3) — no bespoke
  dispatcher structure to design or build, unlike the hand-rolled approach this ADR originally
  specified.
- Shell autocomplete (bash/zsh/fish) is available via Stricli's built-in support whenever this
  project chooses to wire it up — not something to build from scratch, just not turned on yet.
- Depending on Stricli means depending on a much smaller-adoption library than commander (~700x
  smaller by weekly downloads at the time of this decision, per 3). It's actively maintained by
  Bloomberg, not abandoned, but this is a real maturity/community-support tradeoff worth
  remembering if a rough edge is ever hit that a larger community would already have documented.
- `--help`/`--version` given *after* a subcommand name are that subcommand's own concern (or an
  unrecognized-option error, for `--version`) — never the global handler's (2.1). This matches
  Stricli's own root-command/route-map model; it's stated here as this project's expected
  behavior, not as a constraint this project had to design.

## 5. Related

- RFCs: RFC-002
- Specs: specs/003-cli-interface
