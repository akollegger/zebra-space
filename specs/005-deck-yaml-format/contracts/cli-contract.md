# Contract: `zebra deck`

Extends [`specs/003-cli-interface/contracts/cli-contract.md`](../../003-cli-interface/contracts/cli-contract.md),
which remains the source of truth for the shared invocation shape (bare-`zebra` help, top-level
`--help`/`-h`/`--version` dispatch rule, unknown-subcommand handling, per-subcommand `--help`).
This file documents only what's new: `deck`.

## Invocation shape

```
zebra deck <deck.yaml> [--json]
```

| Arg/Flag | Required | Notes |
|---|---|---|
| `<deck.yaml>` | yes | Path to a deck document (ADR-006 §2.1). Passed to `loadDeckFile` (library-contract.md) — not pre-validated by the CLI layer itself, mirroring `solve`'s and `extract`'s file-path convention. |
| `--json` | no | Machine-readable output instead of human-readable. |

Runs the full pipeline in one invocation: load, validate, classify, convert, solve, and (when
solvable) answer the closure. There is no separate "validate only" or "solve only" mode
(research.md Finding 5) — a deck that fails validation is reported as a validation failure and
the pipeline stops there; it is never partially solved.

## Output (human, default)

- **Validation failure**: the specific `DeckError` (data-model.md), naming the offending card or
  reference — e.g. `Card 'red-middle' depends on unknown card 'domain-color'`.
- **Unsatisfiable**: `This deck's puzzle has no solution.`
- **Uniquely solvable**: the closure's answer in plain language, plus each card's derived
  classification.
- **Multiply satisfiable**: `This deck's puzzle has more than one solution — it is not uniquely
  solvable.` (No answer is reported — matching `solve`'s own behavior for this outcome.)
- **Uniquely solvable but the closure's answer doesn't resolve** (`AnswerError`,
  data-model.md): a message naming which — no matching entity, or more than one — rather than a
  silently guessed answer (Constitution Principle VI).

## Output (`--json`)

The `SolvedDeck` (data-model.md) as JSON on success; the `DeckError` as JSON on validation
failure. Exit code distinguishes the two (below) so a script can branch without parsing the body.

## Exit codes

Reuses Stricli's exact taxonomy (`specs/003-cli-interface/research.md` Finding 3):
`Success`=0, `CommandRunError`=1, `InvalidArgument`=252, `UnknownCommand`=251.

Matches `solve`'s existing convention exactly: `Unsatisfiable`, `MultiplySatisfiable`, and an
`AnswerError` are successful *classifications* the tool reports, not failures of the tool
itself — `solve`'s own command exits 0 for all three of its `SolveResult` variants, only a
`SolverError` (an operational failure — bad model, solver crash, timeout) exits non-zero. This
feature's `DeckError` (a validation failure) is the one new failure mode, and does exit
`CommandRunError`=1 — the run genuinely couldn't proceed, unlike a well-formed deck whose puzzle
merely turned out unsatisfiable or underdetermined.
