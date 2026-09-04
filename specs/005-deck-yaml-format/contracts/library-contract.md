# Contract: Deck library (`src/deck/`)

This is the primary contract for this feature — a TypeScript library other code (a future game
loop, tests) calls directly. `classifyCards` and `solveDeck`'s closure-answer projection have no
CLI verb of their own (cli-contract.md's "Why no `deck` subcommand"); `loadDeck`/`deckCsp` are
also reached indirectly via `zebra extract` (cli-contract.md). Function signatures below are the
contract; internal file layout is an implementation detail of plan.md's Project Structure.

## `loadDeck`

```ts
function loadDeck(yamlText: string): Effect.Effect<Deck, DeckError>
```

Parses `yamlText` and validates it against every rule in data-model.md (`Csp`'s and `Card`'s
validation rules, FR-002/FR-003/FR-004). Succeeds only with a `Deck` that has already passed
every structural check — there is no partially-validated intermediate value this contract
exposes. Fails with the specific `DeckError` variant (data-model.md) identifying what's wrong and
where.

A sibling `loadDeckFile(path: string): Effect.Effect<Deck, DeckError>` reads the file at `path`
and calls `loadDeck` on its contents — mirrors `src/solver/solve.ts`'s `solve`/`solveFile` split
(research.md Finding 2's precedent).

## `classifyCards`

```ts
function classifyCards(deck: Deck): Readonly<Record<string /* card id */, CardClassification>>
```

Pure function (no `Effect`, no failure mode — a `Deck` that reached this function already passed
`loadDeck`'s validation, so every reference it inspects is known to resolve). Implements
data-model.md's `CardClassification` derivation (FR-005): one entry per card in `deck.cards`.

## `deckCsp`

```ts
function deckCsp(deck: Deck): ExtractedCsp
```

Pure, total conversion from `deck.csp` to `ExtractedCsp` (`src/extraction/types.ts`) — flattens
the `constraints` map to an array (ADR-006 §2.2); `entities` and `domains` pass through
unchanged. Never fails: every value `loadDeck` accepted is already a well-formed `ExtractedCsp`
member by construction (data-model.md's `Constraint` union is a structural mirror of
`ExtractedConstraint`).

## `solveDeck`

```ts
function solveDeck(deck: Deck): Effect.Effect<SolvedDeck, SolverError | CompileError>
```

Calls `deckCsp(deck)`, compiles and solves it via the project's existing capabilities (`compile()`
in `src/compiler/compile.ts` and `solve()` in `src/solver/solve.ts`, both unmodified — FR-006),
and returns a `SolvedDeck` (data-model.md): the raw `SolveResult`, `classifyCards(deck)`'s
output, and — only when the outcome is `UniquelySolvable` — the closure answer (FR-007, FR-008)
or an `AnswerError` (FR-009) when `deck.closure.answer`'s condition matches zero or more than one
entity in the solution.

Failure mode is exactly the existing `SolverError` and `CompileError` unions — this feature
introduces no new solving or compiling failure, consistent with FR-006's "no deck-specific
solving code."

## Types

`Deck`, `Card`, `Csp`, `Constraint`, `Closure`, `CardClassification`, `SolvedDeck`, `DeckError` —
all as specified in data-model.md, exported from `src/deck/types.ts`.
