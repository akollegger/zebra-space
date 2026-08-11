# Research: Puzzle Catalog Seeding

## Decision: Automated check tooling for SC-001/002/003

**Decision**: Use Node's built-in test runner (`node --test`, Node 24+) with a small hand-rolled
frontmatter reader, invoked as `pnpm test`. No new npm dependency.

**Rationale**: `package.json` has no test framework configured yet (`pnpm test` currently just
exits with an error). The constitution's Design-First-Then-Test-First principle expects a failing
automated check before the catalog content that makes it pass. The checks needed are simple
(count files, confirm frontmatter fields are present/non-empty, compare file count to index row
count) and don't need a YAML parsing library — Node 24's native TypeScript support (already
relied on by `src/index.ts`) runs a `.ts` test file directly, and the frontmatter schema (flat
`key: value` pairs, ADR-001 §2.1) is simple enough to split on the `---` delimiters and scan lines
without a dependency.

**Alternatives considered**:
- **vitest/jest**: rejected — a full test framework is disproportionate for three assertions
  over static content; it would also be the first test-framework decision made by a
  content-seeding feature rather than a piece of application logic, which isn't this feature's
  place to decide.
- **A YAML parsing library (`yaml`, `js-yaml`)**: rejected — the frontmatter schema is flat
  (no nested structures), so a minimal delimiter-based reader is sufficient for presence/
  non-empty checks and avoids a new dependency for this narrow use.

## Decision: Canonical puzzle source text

**Decision**: Transcribe the puzzle from the Wikipedia "Zebra Puzzle" article's "Description"
section (https://en.wikipedia.org/wiki/Zebra_Puzzle), which reproduces the original *Life
International* (17 December 1962) clues verbatim, plus the 25 March 1963 issue's published
solution (used only to cross-check the transcription's solvability per FR-008 — not stored in
the public frontmatter, per the Clarifications decision).

Verbatim clues (14 constraints over 5 houses × 5 attribute categories — nationality, house
color, pet, beverage, cigarette brand):

1. The Englishman lives in the red house.
2. The Spaniard owns the dog.
3. Coffee is drunk in the green house.
4. The Ukrainian drinks tea.
5. The green house is immediately to the right of the ivory house.
6. The Old Gold smoker owns snails.
7. Kools are smoked in the yellow house.
8. Milk is drunk in the middle house.
9. The Norwegian lives in the first house.
10. The man who smokes Chesterfields lives in the house next to the man with the fox.
11. Kools are smoked in the house next to the house where the horse is kept.
12. The Lucky Strike smoker drinks orange juice.
13. The Japanese smokes Parliaments.
14. The Norwegian lives next to the blue house.

Closing question: "Now, who drinks water? Who owns the zebra?"

Published solution (Life International, 25 March 1963), for FR-009's private answer key only:
Norwegian drinks water (house 1); Japanese owns the zebra (house 5).

Resulting size metadata for this entry's frontmatter: `variables: 25`, `domains: 5`,
`constraints: 14`.

**Rationale**: this is the puzzle FR-004 requires; getting the exact clue wording now means
`/speckit-tasks` and implementation don't need to re-derive it.

**Public-domain/redistribution status**: per spec.md's existing Assumptions, satisfied by the
puzzle's long-standing, unattributed reproduction across Wikipedia and numerous independent
puzzle/computation sites since 1962. Wikipedia's own article does not assert a specific license
for the original magazine text; no stronger legal confirmation is available or required by
FR-004/the Edge Cases entry beyond citing this reproduction as `source`.

## Decision: Hand-authored puzzle sizing

**Decision**: Both hand-authored puzzles target 4 houses × 4 attribute categories
(`variables: 16`, `domains: 4`), smaller than the canonical entry, to keep hand-authoring and
manual solvability verification (FR-008) tractable while still exercising the classic-CSP tier
RFC-001 scopes this catalog to.

**Rationale**: spec.md's Assumptions estimated "roughly 5 entities × 4 attribute categories";
committing to a slightly smaller 4×4 size at design time bounds the authoring effort concretely
without contradicting that assumption's intent (comparable to, not necessarily equal to, the
canonical puzzle).

**Alternatives considered**: matching the canonical puzzle's 5×5 size exactly — rejected, no
requirement calls for uniform sizing across seed entries, and a smaller size is easier to
hand-verify for uniqueness (FR-008) with confidence.
