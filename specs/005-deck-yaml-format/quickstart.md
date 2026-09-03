# Quickstart: Deck YAML Format Library Support

## Prerequisites

- This repo's usual setup (`pnpm install`), plus the MiniZinc toolchain (`README.md`/CLAUDE.md's
  existing prerequisite for anything that solves — unchanged by this feature).
- No new external service or credential — this feature is entirely local/offline, consistent
  with `pnpm test`'s existing no-network constraint.

## Validate a deck (library)

```ts
import { Effect } from "effect"
import { loadDeckFile } from "../src/deck/load.ts"

const deck = await Effect.runPromise(loadDeckFile("catalog/decks/DECK-0001-maple-street.yaml"))
// Throws (rejects) with a DeckError if the deck has a dangling reference, a dependency cycle,
// an unsupported tier, or an unrecognized constraint kind (FR-002–FR-004).
```

**Expected outcome**: a deck built from a fixture matching User Story 1's Acceptance Scenario 1
(every reference resolves) resolves to a `Deck` value; one matching Scenario 2 or 3 (a dangling
reference or a cycle) rejects with a `DeckError` naming the offending card.

## Solve a validated deck (library)

```ts
import { solveDeck } from "../src/deck/solve.ts"

const solved = await Effect.runPromise(solveDeck(deck))
console.log(solved.outcome._tag)       // "UniquelySolvable" | "Unsatisfiable" | "MultiplySatisfiable"
console.log(solved.answer)             // present only when uniquely solvable
console.log(solved.classifications)    // one entry per card id
```

**Expected outcome**: matches User Story 2 and 3's Acceptance Scenarios — a deck built (by
construction, in the test fixture) to have exactly one solution reports `UniquelySolvable` and a
specific answer; a deliberately underdetermined or contradictory fixture reports the other two
outcomes with no fabricated answer.

## Validate and solve from the command line

```
pnpm zebra deck catalog/decks/DECK-0001-maple-street.yaml
```

**Expected outcome**: human-readable output naming either a validation problem, or the solved
outcome plus (when uniquely solvable) the closure's answer and every card's classification — per
`contracts/cli-contract.md`. Add `--json` for machine-readable output; pipe to a script to
confirm the exit code distinguishes a validation failure (1) from a reported classification
outcome (0), per that contract's Exit codes section.

## Running the test suite

```
pnpm test
```

New fixtures for this feature live under `tests/deck/` (mirroring `tests/solver/`,
`tests/compiler/`'s existing layout) — a handful of small deck YAML documents covering: a fully
valid deck, a dangling `dependsOn` reference, a dependency cycle, an unsupported tier, an
unrecognized constraint kind, a uniquely solvable deck, an unsatisfiable one, a multiply
satisfiable one, and a closure whose answer condition matches zero or more than one entity.
