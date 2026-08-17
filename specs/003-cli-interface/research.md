# Research: CLI Interface

Hands-on verification against this repo's actual toolchain (Node 24.14.1), consistent with how
`specs/002-minizinc-integration/research.md` did its due diligence — not just documentation.

**Revision note**: this feature's argument-parsing/dispatch decision changed after planning
began — see ADR-003's revision history. The findings below reflect the current decision
(`@stricli/core`, ADR-003 §2.3), verified hands-on in this repo before committing to it.

## Finding 1: a `.ts` file with a `node` shebang runs directly as an executable, no build step

Tested directly: a file starting with `#!/usr/bin/env node`, marked executable (`chmod +x`), runs
via `./file.ts` and correctly imports a sibling module (`../solver/solve.ts`) using this
project's existing relative-`.ts`-extension import convention. This confirms a `package.json`
`bin` entry can point straight at a `.ts` entrypoint — consistent with this project's established
no-build-step approach (native Node 24 TypeScript support) — rather than needing a compiled
`.js` output or a wrapper script.

**Decision**: `package.json`'s `bin` field points directly at `src/cli/main.ts`, which starts
with `#!/usr/bin/env node` and is checked in with the executable bit set.

## Finding 2: `@stricli/core` installs and runs cleanly, with zero dependencies, confirmed end-to-end

Installed `@stricli/core@1.3.0` directly (`pnpm add`) — no build-approval prompts (confirms zero
native postinstall scripts), no dependency conflicts. Built a scratch command
(`buildCommand`/`buildRouteMap`/`buildApplication`/`run`) with a typed flag and positional
argument and ran it through the actual scenarios ADR-003 §2.1 cares about, all matching exactly:

- `zebra hello world --count 2` → ran the typed handler correctly (flag and positional values
  matched their declared types with no casting).
- `zebra --help` → listed subcommands.
- `zebra --version` → printed the configured version string.
- `zebra hello --help` → showed `hello`'s own flags/arguments, independently of top-level help.
- `zebra bogus` → a clear "no command registered" message, non-zero exit.
- `zebra hello world --version` → **rejected** as "No flag registered for `--version`" — confirms
  ADR-003 §2.1's dispatch rule holds exactly as designed: a global flag given after a subcommand
  name does not leak into that subcommand's behavior. This is Stricli's native behavior, not
  something this project has to implement or maintain.

**Correction to `buildApplication` usage**: `run()` takes a built `Application`
(`buildApplication(routeMap, config)`), not a raw route map directly — an easy mistake (the
error message when omitted is unhelpful: `Cannot read properties of undefined`). Worth noting
for whoever writes `src/cli/main.ts`.

## Finding 3: Stricli's exit-code taxonomy is more precise than this ADR originally assumed

Verified by making a scratch command throw, and by triggering Stricli's own routing/parsing
errors. Stricli exports a documented `ExitCode` enum, confirmed against actual process exit
codes observed (negative enum values wrap to their unsigned-byte form on Unix, `256 + code`):

| Stricli `ExitCode` | Raw value | Observed process exit code | When |
|---|---|---|---|
| `Success` | `0` | `0` | Command completed without throwing |
| `CommandRunError` | `1` | `1` | The command's own implementation threw an error |
| `InvalidArgument` | `-4` | `252` | An unrecognized/malformed flag was given |
| `UnknownCommand` | `-5` | `251` | `argv[0]` didn't match any registered subcommand |

**Implication for `solve`**: a `SolverError` thrown from the `solve` subcommand's implementation
produces `CommandRunError` → exit `1`, matching FR-007's requirement exactly. An unrecognized
subcommand (FR-011) exits `251` (`UnknownCommand`), not `1` — still non-zero/"unsuccessful" as
FR-011 requires, but `contracts/cli-contract.md`'s exit-code table needs correcting to name the
actual code rather than assuming everything non-`solve`-related exits `1`.

## Decision: exit code mapping (revised)

Per ADR-003 §2.2 and the finding above: `solve` itself only ever produces `0` (any resolved
`SolveResult`) or `1` (`SolverError`, via `CommandRunError`) — this project's own code never
calls `process.exit` directly for these cases, it just lets `solve()`'s success/failure become
the command implementation's return/throw, and Stricli's `run()` handles the rest. Stricli-level
usage errors (unknown subcommand, bad flags) use Stricli's own `ExitCode` values (Finding 3) —
non-zero, but not `1` — which is what FR-011 actually requires ("exit unsuccessfully"), not a
specific code.
