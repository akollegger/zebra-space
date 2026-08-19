# Quickstart: Natural-Language Puzzle to Solvable CSP Extraction

Validates that `zebra extract` satisfies spec.md's Success Criteria. Assumes
`specs/003-cli-interface`'s prerequisites (the `zebra` CLI itself, MiniZinc + a registered CP
solver for anything piped to `solve`) are already met.

## Prerequisites

- Repo checked out on branch `004-nl-csp-extraction`, dependencies installed (`pnpm install`).
- For the default (non-live) test suite: nothing extra — Research Finding 2's stubbed provider
  boundary needs no network access or API key.
- For manual end-to-end runs and `tests/extraction/live.test.ts`: a real `OPENROUTER_API_KEY` in
  the environment. Without it, `live.test.ts` skips itself rather than failing.

## Automated checks (default suite, no network)

```bash
pnpm test
```

Exercises, per `contracts/cli-contract.md` and `data-model.md`:

- The critic loop's control flow against a stubbed provider — accept-on-first-attempt, accept-
  after-informed-revision, escalate-after-exhausted-revisions, and full-rejection
  (`CriticRejected` with every attempt's `ExtractedCsp`/`FidelityCritique` intact) (FR-003–FR-007).
- `src/compiler/compile.ts` rendering each `ExtractedConstraint` kind (including both
  `DerivedCondition` modes and `ArithmeticExpression` shapes) to `.mzn` text, and raising
  `CompileError` on an unrecognized relation/condition shape (ADR-005 §2.3/§2.4).
- `zebra extract` CLI wiring: default output is compiled `.mzn` with a provenance header,
  `--json` returns the raw `ExtractedCsp` and never compiles (SC-004), `--model`/
  `--frontier-model`/`ZEBRA_MODEL`/`ZEBRA_FRONTIER_MODEL` precedence (FR-010, SC-005), and the
  exit-code taxonomy in `contracts/cli-contract.md`.

## Automated checks (opt-in, live)

```bash
OPENROUTER_API_KEY=<key> pnpm test
```

Additionally runs `tests/extraction/live.test.ts`: real extraction attempts against the
stratified catalog sample SPIKE-004 used (PZL-0001, PZL-0005, PZL-0008, PZL-0011, PZL-0013),
checking SC-002's 80% faithful-translation-without-manual-correction bar. Skipped automatically
when `OPENROUTER_API_KEY` is absent — never a hard CI gate (Research Finding 2).

## Manual check

Run the CLI directly to see it end-to-end outside the test suite (requires
`OPENROUTER_API_KEY`):

```bash
zebra extract catalog/puzzles/PZL-0004-whodunit.md
```

Expected: a `%`-comment header naming the source file and the model tier used, followed by a
complete, valid `.mzn` model — pipeable straight to `zebra solve` (SC-001):

```bash
zebra extract catalog/puzzles/PZL-0004-whodunit.md > /tmp/PZL-0004.mzn
zebra solve /tmp/PZL-0004.mzn
```

```bash
zebra extract catalog/puzzles/PZL-0004-whodunit.md --json
```

Expected: the raw `ExtractedCsp` plus the producing model tier, as JSON — no `.mzn` text, no
compile step attempted (SC-004).

```bash
zebra extract catalog/puzzles/PZL-0004-whodunit.md --frontier-model anthropic/claude-sonnet-4.5
echo "exit: $?"
```

Expected: forces the frontier tier from the first attempt rather than starting cheap — useful for
comparing tiers directly. A puzzle whose prose is genuinely ambiguous enough to exhaust both
tiers' revision rounds instead prints `CriticRejected`'s full attempt history to stderr and exits
`1` (SC-003: the reported message alone should explain why, without needing to inspect logs).
