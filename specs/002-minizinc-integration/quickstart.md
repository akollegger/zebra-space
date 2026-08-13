# Quickstart: MiniZinc Solver Integration

Validates that the solve-and-classify capability satisfies spec.md's Success Criteria.

## Prerequisites

- Repo checked out on branch `002-minizinc-integration`.
- Dependencies installed: `pnpm install`.
- The MiniZinc toolchain installed (e.g. `brew install minizinc` on macOS).
- A registered finite-domain (CP) solver (Gecode by default). Run
  `./scripts/setup-minizinc-solver.sh` — it checks `minizinc --solvers` for one and registers
  Gecode if it's installed but not wired up (research.md Finding 1; not automatic on at least
  some Homebrew-based setups, though newer Gecode formula versions self-register).

## Automated checks (SC-001–SC-005)

```bash
pnpm test
```

Exercises, per `contracts/solve-contract.md` and `data-model.md`:

- A known-unsatisfiable toy model → `Unsatisfiable` (SC-001).
- A known-uniquely-solvable toy model → `UniquelySolvable` with the correct assignment (SC-002).
- A known-multiply-satisfiable toy model → `MultiplySatisfiable`, without over-searching (SC-003).
- The seeded `catalog/mzn/PZL-0004-whodunit.mzn` → `UniquelySolvable`, matching
  `specs/001-catalog-seeding/answer-keys.md`'s recorded answer for `PZL-0004` exactly (SC-004).
- No leftover files in the OS temp directory after each attempt, success or failure (SC-005).

## Manual check

Run the seeded example directly to see the mechanism end-to-end outside the test suite:

```bash
minizinc --output-mode json catalog/mzn/PZL-0004-whodunit.mzn
```

Expected: a single JSON object naming Professor Plum, the Candlestick, and the Conservatory —
matching `specs/001-catalog-seeding/answer-keys.md`'s `PZL-0004` entry.
