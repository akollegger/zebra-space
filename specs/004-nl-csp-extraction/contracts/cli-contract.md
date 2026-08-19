# Contract: `zebra extract`

Extends [`specs/003-cli-interface/contracts/cli-contract.md`](../../003-cli-interface/contracts/cli-contract.md),
which remains the source of truth for the shared invocation shape (bare-`zebra` help, top-level
`--help`/`-h`/`--version` dispatch rule, unknown-subcommand handling, per-subcommand `--help`) and
for `solve`'s own contract, unaffected by this feature. This file documents only what's new:
`extract`.

## Invocation shape

```
zebra extract <puzzle.md> [--json] [--model <id>] [--frontier-model <id>]
```

| Arg/Flag | Required | Notes |
|---|---|---|
| `<puzzle.md>` | yes | Path to a `catalog/puzzles/PZL-NNNN-*.md`-shaped file, passed straight through — not re-read/re-validated by the CLI layer itself (ADR-003 §2.6, mirrors `solve`'s file-path convention). |
| `--json` | no | Print the raw `ExtractedCsp` plus the model tier that produced it; **bypasses compilation entirely** (ADR-003 §2.6). |
| `--model <id>` | no | OpenRouter `provider/model-name` string for the default (cheap) tier. Precedence: flag > `ZEBRA_MODEL` env var > built-in default (`openai/gpt-4o-mini`, ADR-004 §2.5). |
| `--frontier-model <id>` | no | OpenRouter `provider/model-name` string for the escalation tier. Precedence: flag > `ZEBRA_FRONTIER_MODEL` env var > built-in default (`anthropic/claude-sonnet-4.5`, ADR-004 §2.5). |

No alias/registry layer over model identifiers — full OpenRouter strings only (ADR-003 §2.6).

## Output (default — no `--json`)

The compiled `.mzn` text (ADR-005), prefixed with a `%`-comment provenance header naming the
source puzzle file and which model tier produced the accepted extraction. Directly pipeable to
`zebra solve` or saveable into `catalog/mzn/`.

## Output (`--json`)

The accepted `ExtractedCsp` (data-model.md) as JSON, plus the producing model tier — never passed
through the compiler, so it never surfaces a `CompileError`.

## Exit codes

Reuses Stricli's exact taxonomy `specs/003-cli-interface/research.md` Finding 3 already verified
(`Success`=0, `CommandRunError`=1, `InvalidArgument`=252, `UnknownCommand`=251) — same meaning as
`solve`'s contract, applied to this subcommand's own success/failure conditions:

| Code | Meaning |
|---|---|
| `0` | A rendered result was reached: a critic-accepted `ExtractedCsp` (`--json`), or a critic-accepted **and** successfully compiled `.mzn` model (default). |
| `1` | `CriticRejected` (escalation exhausted without acceptance), `ProviderError`, `SchemaRejected`, `SchemaViolation` (ADR-004 §2.6), or — default output only — `CompileError` (ADR-005) — Stricli's `CommandRunError`. Printed to stderr. |
| `251` | Unrecognized subcommand — shared with `solve`'s contract, unaffected by this feature. |
| `252` | Unrecognized/malformed flag. |

## Guarantees

- `extract` never invokes `solve` and never surfaces `solve`'s outcome vocabulary
  (`Unsatisfiable`/`UniquelySolvable`/`MultiplySatisfiable`) — exit `0` here means "reached a
  rendered result," not "the puzzle is solvable" (ADR-003 §2.6/§4). Chaining to `solve` to check
  solvability is a separate, explicit step a caller takes on the rendered `.mzn` output.
- `--json` and the default path fail on genuinely disjoint conditions past the shared critic-loop
  errors: only the default path can additionally fail with `CompileError`, since `--json` never
  compiles.
- A rejected extraction's full attempt history (every tier, every revision round's `ExtractedCsp`
  and `FidelityCritique`) is available on `CriticRejected`, not just the final attempt
  (data-model.md) — printed to stderr in a form suitable for manual review, exact formatting is
  implementation's call.
- **Every failure names its cause and a next action, with no JS stack trace appended** (spec.md
  SC-003). The four extraction failures are deliberately distinguishable from each other in the
  printed text, because their remedies differ:

  | Failure | What the user is told to do |
  |---|---|
  | `ProviderError` | Service unreachable/failed — check connectivity or credentials; retry. |
  | `SchemaRejected` | The provider refused the schema shape itself. Retrying won't help; use a different `--model`. |
  | `SchemaViolation` | The model replied outside the schema (or ignored the tool call). Retrying may help; a stronger model more so. |
  | `CriticRejected` | The translation couldn't be validated as faithful — shows every attempt's specific issues. |

  Stack-trace suppression is a contract detail, not cosmetics: an error whose message is buried
  under frames from `node_modules/effect` fails SC-003's "without needing to inspect internal
  logs or source code". Enforced by test, not convention.
- `--model`/`--frontier-model`/`ZEBRA_MODEL`/`ZEBRA_FRONTIER_MODEL` accept any string; an
  unrecognized identifier surfaces as `ProviderError` at request time, not validated upfront
  (ADR-003 §4).

## Non-guarantees (explicitly out of scope for this contract)

- No guarantee of stable human-readable `%`-comment header wording across versions — only the
  `.mzn` body's validity as a MiniZinc model, and `--json`'s JSON structure, are stable.
- No batch mode (multiple puzzle files in one invocation) — one puzzle per `extract` call
  (spec.md Assumptions).
- No automatic `catalog/mzn/` write — `extract` prints to stdout; saving into the catalog is a
  manual step the caller takes (ADR-003 §4).
