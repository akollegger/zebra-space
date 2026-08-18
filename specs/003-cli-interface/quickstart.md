# Quickstart: CLI Interface

Validates that the `zebra` CLI satisfies spec.md's Success Criteria. Assumes
`specs/002-minizinc-integration`'s prerequisites (MiniZinc + a registered CP solver) are already
met — see that feature's quickstart if not.

## Prerequisites

- Repo checked out on branch `003-cli-interface`, dependencies installed (`pnpm install`).
- MiniZinc + a registered solver (`./scripts/setup-minizinc-solver.sh` if needed).

## Automated checks (SC-001–SC-007)

```bash
pnpm test
```

Exercises, per `contracts/cli-contract.md` and `data-model.md`:

- `solve` against the real seeded example (`catalog/mzn/PZL-0004-whodunit.mzn`) → human-readable
  output showing Professor Plum/Candlestick/Conservatory, exit `0` (SC-001).
- `solve` against a known-unsatisfiable toy model → reports that outcome, exit `0` (SC-002).
- `solve` against a known-multiply-satisfiable toy model → reports that outcome, exit `0` (SC-003).
- The same three cases with `--json` → valid, parseable JSON matching the outcome (SC-004).
- `solve` against a nonexistent file → error on stderr, exit `1` (SC-005).
- `zebra --help`, `zebra solve --help`, `zebra --version` → non-empty, relevant output, no
  solver invoked (SC-006).
- `zebra bogus-subcommand` → lists subcommands, exit `251` (Stricli's `UnknownCommand`, per
  `contracts/cli-contract.md`) (SC-007).

## Manual check

Run the CLI directly to see it end-to-end outside the test suite:

```bash
zebra solve catalog/mzn/PZL-0004-whodunit.mzn
```

Expected: a plain-language statement that Professor Plum, with the Candlestick, in the
Conservatory, is the unique solution — matching `specs/001-catalog-seeding/answer-keys.md`'s
`PZL-0004` entry — and a successful exit.

```bash
zebra solve catalog/mzn/PZL-0004-whodunit.mzn --json
```

Expected: the same result as JSON, with `culprit`/`weapon`/`room` keys (research.md Finding 6
from `specs/002-minizinc-integration`: enum values come back as `{"e": "Name"}`).

```bash
zebra --help
zebra solve --help
zebra --version
zebra nonsense
echo "exit: $?"
```

Expected, respectively: a subcommand list; `solve`'s own argument/flag descriptions; a version
string; a subcommand list plus a non-zero exit code from the last `echo`.
