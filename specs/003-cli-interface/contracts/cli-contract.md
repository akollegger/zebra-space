# Contract: `zebra` CLI

Unlike `specs/002-minizinc-integration`'s `solve()` (a TypeScript function contract), this
feature's contract *is* the command-line surface itself — what a user or script can rely on.

## Invocation shape

```
zebra <subcommand> [args...] [flags...]
zebra --help | -h          # top-level: lists subcommands
zebra --version             # prints tool version
zebra <subcommand> --help | -h   # per-subcommand help
zebra <unknown-subcommand>  # lists subcommands, exits 1
```

**Dispatch rule**: only `argv[0]` is ever checked against the global flag set (`--help`, `-h`,
`--version`) — never scanned anywhere else in `argv`. If it matches, that's handled immediately
and everything after it is ignored. Otherwise `argv[0]` is the subcommand name, and
`argv.slice(1)` belongs entirely to that subcommand — including its own `--help`/`-h`. Global
flags are not recognized once a subcommand is identified: `zebra solve --version` is an
unrecognized option for `solve`, not a global version print (ADR-003 §2.1). Implemented by
`@stricli/core`'s route-map dispatch (ADR-003 §2.3) — verified to behave exactly this way
(research.md Finding 2), not hand-rolled logic this project maintains.

## `solve` subcommand

```
zebra solve <model.mzn> [--data <file.dzn>] [--solver <id>] [--json]
```

| Arg/Flag | Required | Notes |
|---|---|---|
| `<model.mzn>` | yes | Path to a MiniZinc model file |
| `--data <file.dzn>` | no | Path to a MiniZinc data file |
| `--solver <id>` | no | Defaults to `solve()`'s own default (Gecode, ADR-002 §2.2) |
| `--json` | no | Machine-readable output instead of human-readable (FR-005) |

**Output (human, default)**: a plain-language description of the outcome — unsatisfiable,
uniquely solvable (with the solution shown), or multiply satisfiable.

**Output (`--json`)**: the underlying `SolveResult` as JSON — same shape `solve()` itself
returns (`data-model.md`, `specs/002-minizinc-integration`), not a separate schema.

**Exit codes** (research.md Finding 3 — Stricli's own `ExitCode` taxonomy, verified hands-on):

| Code | Meaning |
|---|---|
| `0` | `solve()` returned a result — regardless of whether the puzzle was unique, unsatisfiable, or multiply satisfiable (FR-006) |
| `1` | `solve()` itself failed (`SolverError`) — Stricli's `CommandRunError` (FR-007) |
| `251` | An unrecognized subcommand was given — Stricli's `UnknownCommand` (FR-011). Non-zero, as FR-011 requires, but not the same code as a `solve` failure. |
| `252` | An unrecognized or malformed flag was given — Stricli's `InvalidArgument`. |

## Guarantees

- Exit code `0` never implies "the puzzle is uniquely solvable" — only that the tool ran to
  completion. Callers that care about uniqueness must inspect the output (human or `--json`),
  not just the exit code (ADR-003 §2.2/§4).
- A non-zero exit code's exact value distinguishes *why* it failed: `1` means `solve` itself
  failed; `251`/`252` mean the invocation itself was malformed (bad subcommand/flag) before
  `solve` ever ran. Callers that only check "zero or not" don't need this distinction, but it's
  stable and available to those that do (research.md Finding 3).
- `--json` output is always valid JSON parseable independent of locale/terminal width — no
  ANSI color codes or line-wrapping applied to that mode.
- Every subcommand supports `--help`/`-h` without requiring any of its other arguments to be
  valid or even present.

## Non-guarantees (explicitly out of scope for this contract)

- No shell-completion scripts (research.md; ADR-003 §4).
- No guarantee of stable human-readable text across versions — only `--json`'s structure is a
  stable contract; the plain-language wording may change (spec.md Assumptions).
- No subcommands beyond `solve` — anything else is a future contract addition, not implied by
  this one (ADR-003 §4).
