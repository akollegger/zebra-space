# Data Model: CLI Interface

## CLI Invocation

One run of the tool.

| Field | Type | Notes |
|---|---|---|
| `subcommand` | string \| undefined | `argv[0]`; `undefined` means bare `zebra` (top-level help) |
| `positionals` | string[] | Positional args after the subcommand (e.g. the model file path) |
| `flags` | Record<string, string \| boolean \| number> | Parsed by `@stricli/core` per that subcommand's own typed parameter definitions (ADR-003 §2.3) |

**Validation rules**: only `argv[0]` is ever checked against the global flag set (`--help`,
`-h`, `--version`) — never scanned anywhere else. If it matches, the invocation is handled
globally and nothing else in `argv` is consulted (User Story 3). Otherwise `argv[0]` is
`subcommand`, and it MUST resolve against Stricli's route map (FR-011) or the invocation is
rejected with `UnknownCommand` (research.md Finding 3); everything in `positionals`/`flags` then
belongs entirely to that subcommand, including its own `--help`/`-h` (ADR-003 §2.1's dispatch
rule, verified as Stricli's native behavior in research.md Finding 2).

## Solve Report

The rendering of a `solveFile()` outcome (`SolveResult`, `src/solver/types.ts`) presented to the
user by the `solve` subcommand. `solveFile()` is a path-based sibling of the solve capability's
existing content-based `solve()`, added by this feature so the subcommand can pass the user's
model/data file paths straight through — no `readFile` step of its own, no intermediate temp
copy (plan.md's revision note; both entrypoints share one internal helper, so no solving logic is
duplicated).

| Field | Type | Notes |
|---|---|---|
| `format` | `"human"` \| `"json"` | Selected by the `--json` flag (FR-005); `"human"` is the default (FR-004) |
| `result` | `SolveResult` | The underlying, already-typed result from `solveFile()` — not re-derived or re-shaped, per FR-003 |
| `exitCode` | `0` \| `1` | `0` for any resolved `SolveResult` variant; `1` (Stricli's `CommandRunError`) only for a `SolverError` (research.md Finding 3, FR-006/FR-007) — distinct from Stricli's own `251`/`252` usage-error codes, which apply before a Solve Report can even be produced |

**Relationship**: exactly one Solve Report per `solve` CLI Invocation — the report's `result` is
whatever `solveFile()` (built on the existing solve capability, `specs/002-minizinc-integration`)
returns for that invocation's model/data file paths; this feature adds no new solving logic
(FR-003).

## Relationships

- A CLI Invocation either resolves to a known subcommand handler (e.g. `solve`, producing a
  Solve Report) or falls through to the unknown-subcommand/help path — never both.
- `--version` and top-level `--help` don't produce a Solve Report at all; they're handled before
  subcommand dispatch (research.md's `--help`/`--version` decision).
