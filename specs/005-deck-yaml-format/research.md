# Research: Deck YAML Format Library Support

## Finding 1: YAML parsing library

**Decision**: Add the `yaml` package (eemeli/yaml) as a new dependency.

**Rationale**: No YAML parser exists in this codebase yet (`package.json` has none), and Node has
no built-in one. `yaml` is pure JavaScript, has zero runtime dependencies of its own, and parses
directly to plain JS values (arrays/objects/scalars) that an `effect` `Schema.decodeUnknown` can
then validate — matching this project's existing pattern of decoding untrusted input through an
`effect` `Schema` (`src/extraction/types.ts`) rather than trusting a parser's output shape
directly.

**Alternatives considered**:
- `js-yaml` — equally capable, but its typings and maintenance cadence are less active than
  `yaml`'s as of this writing, and it pulls in `argparse` as a dependency of its CLI (unused
  here) where `yaml` has none.
- Hand-rolling a minimal YAML subset parser — rejected outright: YAML's block-mapping/sequence
  syntax is exactly what a deck author reasonably expects to write freely (comments, nested
  maps, inline `{a: b}` flow mappings per ADR-006 §2.1's schema block), and reimplementing enough
  of it to be trustworthy costs far more than adopting a maintained library.

## Finding 2: Effect-wrapped file loading, following existing precedent

**Decision**: Reading a deck file and parsing its YAML are wrapped by hand in `Effect.try`/
`Effect.tryPromise`, the same pattern `src/solver/solve.ts` already uses for `node:child_process`
(CLAUDE.md's standing note: hand-wrap external capabilities in `Effect` rather than reaching for
an unrelated `@effect/*` package). No new `@effect/platform` dependency is introduced.

**Rationale**: `@effect/platform`'s `FileSystem`/`Command` modules peer-depend on `effect@^3.22.x`,
incompatible with this repo's pinned `effect@4.0.0-rc.110` (already confirmed broken for
`@effect/platform`'s `Command` module per `specs/002-minizinc-integration`'s research). The same
incompatibility applies to its file-reading module, so the same workaround applies.

**Alternatives considered**: Using `@effect/platform`'s `FileSystem` — rejected for the peer-
dependency incompatibility above, consistent with the project's standing pattern.

## Finding 3: Constraint vocabulary and representation — already decided

**Decision**: Reuse ADR-006 §2.2's constraint vocabulary as-is, and adapt a deck's `csp` block to
`ExtractedCsp` (`src/extraction/types.ts`) for solving, exactly as ADR-006 §1/§2.2/§4 specifies.

**Rationale**: This was the central decision of ADR-006 itself, not something this planning phase
re-opens. Re-litigating it here would duplicate work already done and recorded.

**Alternatives considered**: None — see ADR-006 §3 for the alternatives already evaluated and
rejected at the architecture-decision stage.

## Finding 4: Locating the closure answer's entity in a solved assignment

**Decision**: `SolveResult.UniquelySolvable.assignment` (`src/solver/types.ts`) is a flat record
keyed by variable name. For a variable declared on a domain whose `entityType` has more than one
entity, the compiler (`src/compiler/compile.ts`) emits it as an entity-indexed MiniZinc array,
with entities in exactly the order `csp.entities` lists them, filtered to that `entityType` —
confirmed by reading `computeCompiledDomains`' `entityIds` construction. The parsed assignment
therefore returns that variable's value as an array in the same order. Locating a closure's
answer means: filter `csp.entities` to `closure.answer.entityType`, read the same-length array
at `assignment[closure.answer.variable]`, and find the index whose value matches
`closure.answer.equals` — that entity's `id` is the answer (per `reveal: id`, ADR-006 §2.1, the
only value the format currently supports).

**Rationale**: This reuses the compiler's own declared ordering guarantee rather than introducing
a second, independent way to correlate entities with solved values.

**Alternatives considered**: Asking the compiler to also emit an explicit entity→index mapping —
rejected as unnecessary; the ordering is already deterministic and already relied upon by
`compile.ts` itself for `entityIds`, so this feature can read the same guarantee rather than
requesting a new one.

**Open detail carried into data-model.md**: enum-typed values come back wrapped as `{ e: "Name" }`
(confirmed in `tests/solver/catalog-examples.test.ts`), so an equality check against
`closure.answer.equals` (a plain string) must compare against the wrapped value's `e` field, not
the wrapper object itself.

## Finding 5: A `zebra deck` CLI subcommand (superseded — see `contracts/cli-contract.md`)

**This decision was reversed after implementation and review.** Once `extract` gained direct
deck support (folding this finding's compile/solve half into the existing `extract | solve`
pipeline), what remained — card classification and the closure answer — turned out to fail a
sharper test than the one this finding applied: a CLI verb should operate on whatever input is
viable for it, the way `extract`/`solve` now do regardless of source. Classification and the
closure answer depend on *cards*, a concept only the deck format has, so no version of them
would do anything meaningful given a prose puzzle or a compiled model — they were never a
general verb narrowly implemented, they were deck-internal structure inspection wearing a
command's clothes. The `deck` subcommand was removed; `classifyCards`/`solveDeck` remain
library-only. Kept below as the record of what was decided at the time and why.

### Original finding

**Decision**: Add a `deck` subcommand (`zebra deck <deck.yaml> [--json]`) alongside the existing
`extract`/`solve` subcommands (`src/cli/subcommands/`), running the full pipeline (load →
validate → classify → convert → solve → closure answer) in one invocation and reporting either
the validation failure or the solved outcome.

**Rationale**: Constitution Principle VI requires every capability be invocable as a command with
input and output, usable unattended in CI — a library with no command-line surface wouldn't meet
that bar. A single combined subcommand (rather than separate `validate`/`solve` steps) matches
this project's existing one-verb-per-subcommand convention and the fact that solving an invalid
deck is meaningless — there's no case where a caller wants one step without the other.

**Alternatives considered**: Separate `zebra deck validate` and `zebra deck solve` subcommands —
rejected; splitting them would let a caller solve a deck that never passed validation, and no
existing subcommand exposes intermediate pipeline stages this way (`extract --json` stops before
compiling, but that's a genuinely useful intermediate artifact — the extracted CSP itself — where
a "validated-but-unsolved deck" is not).
