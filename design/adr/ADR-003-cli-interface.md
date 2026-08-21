---
id: ADR-003
title: CLI Interface Shape
status: proposed
rfcs: [RFC-002, RFC-003]
created: 2026-08-13
specs:
  - specs/003-cli-interface
  - specs/004-nl-csp-extraction
---

# ADR-003: CLI Interface Shape

## 1. Context

A real, working `solve()` capability now exists (`src/solver/solve.ts`,
`specs/002-minizinc-integration`, from RFC-002/ADR-002) with no way for a person to invoke it
directly from a terminal. A CLI tool was floated earlier, during discussion of catalog
modification, but that's a separate, not-yet-designed workstream — scope here is what exists
now: exposing `solve`.

This ADR decides the CLI's interface *shape* — how a user invokes any of this project's
capabilities, not just this one — and its first concrete subcommand, `solve`. The shape is
deliberately more general than `solve` alone, so future capabilities can be added as new
subcommands without redesigning what's already shipped. Those future additions are follow-up
edits to *this* ADR when they have a concrete design, not something this ADR preemptively
parents itself to now: per the constitution's RFC:ADR many-to-many convention (Principle I,
v1.1.0), an ADR gains an additional parent RFC when a decision concretely serves it, not on
spec. At drafting, this ADR's only parent was RFC-002, because `solve` was the only thing it
decided — see below for how and when a second parent was added.

**A load-bearing constraint discovered before drafting**: `@effect/cli` (the "effect-cli" the
original ask named) is not usable here. Its latest stable release (0.77.0) peer-depends on
`effect@^3.22.1` and `@effect/platform@^0.97.1` — the exact same incompatibility ADR-002/spec
002's T001 already hit and worked around, since this repo is pinned to `effect@4.0.0-beta.107`.
This ADR's argument-parsing decision (2.3) is a direct consequence of that finding.
[Tracking issue #5](https://github.com/akollegger/zebra-space/issues/5)
watches for `@effect/platform`/`@effect/cli` catching up to the Effect 4.0 line — independent of
that, though: 2.3's actual choice (Stricli) stands on its own merits, not as a placeholder
waiting for that issue to close.

**RFC-003 added as a second parent RFC**: exactly the scenario this ADR's own Consequences
already anticipated ("whichever RFC motivates that subcommand becomes an additional parent RFC
at that time") — [ADR-004](ADR-004-llm-extraction-critic-loop.md)'s LLM-based extraction with a
solver-validated critic loop and [ADR-005](ADR-005-extractedcsp-mzn-compiler.md)'s
`ExtractedCsp`-to-`.mzn` compiler together make RFC-003's extraction pipeline complete except for
a user-facing entry point — 2.6 adds that entry point, concretely serving RFC-003, not just
RFC-002.

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

Passes the given `.mzn` (and optional `.dzn`) file paths straight to the solve capability
(`src/solver/solve.ts`) — this subcommand doesn't read those files into memory itself or stage
its own copy; whatever the solve capability needs from disk is its own concern, not duplicated
here. Default output is human-readable (the classified outcome — unsatisfiable / uniquely
solvable, with its assignment / multiply satisfiable — printed plainly); `--json` prints the same
information as JSON, mirroring the solve capability's own `SolveResult` shape (data-model.md,
`specs/002-minizinc-integration`) rather than inventing a second output schema.

Exit codes are reserved for actual errors, not for the *content* of a valid result: any
successful outcome — `UniquelySolvable`, `Unsatisfiable`, and `MultiplySatisfiable`
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
implementation calls the solve capability directly (already an `Effect`) and only converts to a
process exit code / stdout output at that function's own boundary
(`Effect.runPromise`/`Effect.runPromiseExit`) — not scattered through the logic. Stricli itself
has no opinion about `Effect`; this boundary is entirely this project's own convention, applied
inside whatever function Stricli calls for a given subcommand.

### 2.5 Package and entrypoint

A `bin` entry in `package.json` (e.g. `"zebra": "./src/cli/main.ts"`) plus a corresponding
entrypoint file. The exact path/filename is an implementation detail for the eventual
`/speckit-specify` spec to settle, not this ADR's job to pin precisely — this ADR only commits
to *that* a `bin` field and entrypoint are needed, and that `solve` is reachable through it.

### 2.6 Second subcommand: extract

```
zebra extract <puzzle.md> [--json] [--model <id>] [--frontier-model <id>]
```

Exposes [ADR-004](ADR-004-llm-extraction-critic-loop.md)'s extraction pipeline (schema-
constrained LLM extraction, a fidelity critic judging the extraction against the source prose —
not a solver round-trip — informed revision, and cheap-first model routing escalating to
frontier on repeated critic rejection) composed with
[ADR-005](ADR-005-extractedcsp-mzn-compiler.md)'s compiler. `<puzzle.md>` is a
`catalog/puzzles/PZL-NNNN-*.md`-shaped file, passed straight to the extraction capability the
same way `solve` (2.2) passes its file path straight through without re-reading or re-validating
it itself.

**Default output is the compiled `.mzn` text**, not the raw `ExtractedCsp` — a critic-accepted
extraction is compiled ([ADR-005](ADR-005-extractedcsp-mzn-compiler.md)) before printing, since a
solvable MiniZinc model, not an internal JSON structure, is the actual RFC-003 Goal 3 deliverable
and the artifact a terminal user most likely wants: something readable, pipeable to `solve`, or
saveable directly into `catalog/mzn/`. The output includes a leading `%`-comment noting the
puzzle source and which model tier produced the extraction — provenance without breaking valid
MiniZinc syntax. `--json` instead prints the raw `ExtractedCsp` plus which model tier produced
it, **bypassing compilation entirely** — useful for inspecting a validated extraction even for a
construct the compiler doesn't yet handle, and it keeps compilation failures and
extraction/critique failures as separate, distinguishable concerns (below). Note what's absent
from both: any solve outcome. `extract` answers "is this a faithful translation" (and, by
default, "here's a valid MiniZinc model of it") — never "is this puzzle solvable," which is
`solve`'s question, asked separately, on purpose (§4).

This decouples two independent failure surfaces cleanly: the critic loop (extraction/critique)
can fail on its own terms regardless of output mode, and — for the default (non-`--json`) path
only — compilation can *additionally* fail on an already-accepted extraction (an
[ADR-005](ADR-005-extractedcsp-mzn-compiler.md) §2.3/§2.4 compile-time error, e.g. an
unrecognized relation or condition shape). `--json` never hits the second failure mode, since it
never compiles.

**Exit codes are simpler than an earlier draft of this ADR made them, once framed correctly.**
`extract` succeeds (`0`) when it reaches a rendered result — a critic-accepted `ExtractedCsp`
(`--json`), or a critic-accepted *and successfully compiled* `.mzn` model (default) — the same
way `solve` succeeds (`0`) when it runs to completion regardless of the solve outcome's content
(2.2). `extract` fails (non-zero) on `CriticRejected` (escalation exhausted without acceptance),
`ProviderError`/`SchemaViolation` (ADR-004 §2.6), or — default output only — a compiler error
(ADR-005), each printed to stderr. None of this involves `solve`'s outcome vocabulary
(`Unsatisfiable`/`UniquelySolvable`/`MultiplySatisfiable`) at all, because `extract` never
invokes `solve` itself — there's no risk of conflating the two subcommands' exit-code semantics
because they're not answering related questions in the first place.

**Model configuration follows the established convention across AI coding-agent CLIs**, surveyed
before drafting rather than invented: `--model` is the universal flag name (Claude Code, Aider,
Codex CLI, GitHub Copilot CLI, Cursor, Cody all use it), and every tool that documents precedence
agrees on flag > environment variable > built-in default. `--model` sets the cheap/default tier;
`--frontier-model` sets the escalation tier ([ADR-004](ADR-004-llm-extraction-critic-loop.md)
§2.5) — naming it `frontier`, not `weak`/`strong` or Aider's `weak-model`, matches the term this
project's own docs already use throughout. Matching environment variables, `ZEBRA_MODEL` and
`ZEBRA_FRONTIER_MODEL`, sit between the flags and the built-in defaults
(`google/gemini-2.5-flash-lite` / `anthropic/claude-sonnet-4.5`, ADR-004 §2.5) in precedence —
Aider's own rule (env var = tool prefix + upper-snake flag name) applied directly. Tool-namespaced
(`ZEBRA_*`), not provider-namespaced (e.g. `OPENROUTER_MODEL`): this tool isn't a single-vendor
wrapper, it fronts OpenRouter's many providers, the same reasoning Aider itself uses for its own
`AIDER_*`-prefixed variables despite also being multi-provider. Model identifiers are full
OpenRouter `provider/model-name` strings (e.g. `anthropic/claude-sonnet-4.5`) passed straight
through — no alias/registry layer, unlike Claude Code's named aliases (`opus`/`sonnet`/`haiku`) or
`llm`'s user-defined aliases; OpenRouter's own identifiers are already a stable, sufficient
format, and building a second naming layer on top isn't justified yet.

## 3. Alternatives Considered

- **`@effect/cli`** (the original ask). Rejected: incompatible peer dependencies (Context) — a
  hard version-compatibility blocker with this repo's pinned `effect`.
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
- **Accept raw prose text or stdin for `extract` instead of a file path** (2.6). Rejected: breaks
  consistency with `solve`'s own established file-path convention (2.2) for no real benefit,
  since puzzles already live as files (`catalog/puzzles/PZL-NNNN-*.md`) this project already has
  a naming convention for.
- **Keep the raw `ExtractedCsp` JSON as `extract`'s default output**, requiring a separate flag
  (an earlier draft of this ADR called it `--emit-mzn`) to get compiled MiniZinc. Rejected on
  reflection, before any implementation existed to migrate away from: `ExtractedCsp` is an
  internal intermediate representation whose primary audience is other tooling (the compiler,
  eventually a graph builder), not a terminal user — most invocations of `extract` want the
  actual solvable model (RFC-003 Goal 3's deliverable), not the internal schema behind it.
- **Compile for the default path, but skip the fidelity critic** (render whatever the first
  extraction attempt produces, unvalidated). Rejected: would compile a possibly-unfaithful
  extraction into a plausible-looking MiniZinc model with no indication it wasn't checked,
  defeating the critic loop's entire purpose. The critique is one additional LLM call; skipping
  it to save that cost isn't worth presenting unvalidated output as if it were trustworthy.
- **Have `extract` also solve the compiled model by default**, surfacing a solve outcome
  alongside it. Rejected: would reintroduce the conflation
  [ADR-004](ADR-004-llm-extraction-critic-loop.md)'s corrected design deliberately removed —
  `extract` answers "is this faithful" (and renders a model), never "is this solvable," which is
  `solve`'s question. Compiling to `.mzn` by default (above) doesn't cross that line; invoking
  `solve` on it would.
- **Defer model-selection flags, keep model identifiers purely internal configuration** (this
  ADR's own earlier position). Rejected on reflection: OpenRouter is an implementation detail
  from a CLI user's perspective — every surveyed peer tool (Claude Code, Aider, Codex CLI,
  Copilot CLI) treats model selection as a first-class, user-facing configuration surface, not
  something buried inside the tool. Deferring it risked inventing a bespoke, unfamiliar
  convention later instead of adopting the one that already exists.
- **Provider-namespaced environment variables** (e.g. `OPENROUTER_MODEL`, mirroring
  `ANTHROPIC_MODEL`). Rejected: this tool fronts OpenRouter's many providers, not one vendor —
  Aider faces the identical situation and still chose `AIDER_*`-prefixed variables over
  provider-namespaced ones, for the same reason.
- **A named-alias layer for models** (e.g. Claude Code's `opus`/`sonnet`/`haiku`, or `llm`'s
  user-defined aliases), instead of passing OpenRouter's `provider/model-name` strings straight
  through. Rejected for now: OpenRouter's own identifiers are already a stable, sufficient
  format; a second naming layer adds a registry to build and maintain with no evidenced need yet.
- **Flags only, no environment variable fallback.** Rejected: every surveyed tool that documents
  a two-tier or multi-tier model system (Claude Code's main/small-fast pair, Aider's
  main/weak/editor triple) supports both, specifically for reproducible, non-interactive/scripted
  use — a real use case this project's own `pnpm test`/CI context (ADR-004 §4's open Question
  7.4) will likely need.

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
- `extract` (2.6) inherits [ADR-004](ADR-004-llm-extraction-critic-loop.md)'s runtime
  requirements (network dependency, per-call $ cost) at the CLI surface — `solve` has neither.
  ADR-004 §4's open offline/CI-testability question is unaffected by this addition, not resolved
  by it. Its default path also inherits [ADR-005](ADR-005-extractedcsp-mzn-compiler.md)'s
  compile-time error surface, a failure mode `--json` alone doesn't have (2.6).
- `extract`'s default output (2.6) creates a natural, semi-manual workflow for growing
  `catalog/mzn/` (`ADR-002` §2.6): run `zebra extract <puzzle.md>`, review the compiled output by
  hand, commit it as a new reference entry. Building any tooling around that workflow (batch
  runs, automatic comparison against existing entries) is not decided here.
- `--model`/`--frontier-model` (and their `ZEBRA_*` environment variable equivalents, 2.6) accept
  any string an end user supplies — what happens on a malformed identifier or one OpenRouter
  doesn't recognize is a `ProviderError` (ADR-004 §2.6) surfaced at request time, not validated
  upfront by this ADR. A friendlier upfront check (e.g. against OpenRouter's model catalog) is
  possible future work, not decided here.
- RFC-003 is now a second parent RFC (Context) — the growth pattern already anticipated above,
  not a new one.

## 5. Related

- RFCs: RFC-002, RFC-003
- Specs: specs/003-cli-interface
