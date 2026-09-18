# Quickstart: Shared String-Equivalence Matching

## Prerequisites

- `pnpm install` already run.
- No live API key needed — everything here is offline, deterministic string comparison.

## Validate the regression case (SC-004)

```bash
pnpm test -- tests/eval/grader.test.ts
```

Expected: the existing `"hardcover book set"` / `"book_set"` alias case still passes, unchanged,
after the pluralization fold is added to `comparisonKey`.

## Validate the new pluralization fold (FR-008)

Add (or, once implemented, run) a case in `tests/eval/grader.test.ts`:

```ts
assert.equal(comparisonKey(sanitizeIdentifier("moves")), comparisonKey(sanitizeIdentifier("move")))
```

Expected: equal — no alias-table entry required for this pair.

## Validate the loader consolidation (SC-002)

```bash
grep -rn "async function loadAliases" scripts/ design/spikes/
```

Expected: zero matches once `scripts/eval-extraction.ts` and
`design/spikes/SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts` both import
`loadAnswerValueAliases` from `src/eval/aliases.ts` instead of defining their own.

## Validate a new consumer needs no new comparison code (SC-001)

```ts
import { stringsMatch } from "../../src/eval/aliases.ts"

stringsMatch("Hardcover Book Set", "book_set", { "hardcover book set": ["book_set"] }) // true
stringsMatch("Red", "Bed") // false — genuinely different values are never conflated
```

## Validate no live fuzzy promotion (FR-006, SC-003)

```bash
grep -rn "embeddingSemanticMatch\|nameResembles" src/eval/
```

Expected: zero matches — neither fuzzy heuristic is imported into or called from the new shared
module or `grader.ts`. (SPIKE-013/SPIKE-015's own files keep using their existing heuristics per
the resolved clarification — this check confirms the shared, production-facing module never
adopts them, not that every historical file is gone.)

## Full regression

```bash
pnpm test
```

Expected: 200+/201 passing (1 skipped without `OPENROUTER_API_KEY`, unchanged from before this
feature) — no test outside `tests/eval/` should need to change.
