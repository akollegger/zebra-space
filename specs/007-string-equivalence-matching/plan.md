# Implementation Plan: Shared String-Equivalence Matching

**Branch**: `016-string-equivalence-matching` | **Date**: 2026-09-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-string-equivalence-matching/spec.md`

## Summary

Five independent mechanisms across this codebase currently answer "does this string mean the
same thing as that string" — with no shared code or data, and two of them (an embedding-
similarity fallback and a substring-containment fallback, built independently in different
spikes) already converged on wanting the pattern the production grader's alias table already
uses. This feature consolidates that pattern: `src/eval/grader.ts`'s existing `normalizeToken`/
`comparisonKey`/`AliasTable` already are the generic shared primitive ADR-011 calls for — they
just aren't consolidated or reused. The plan adds one new file (`src/eval/aliases.ts`) holding
the single alias-table loader and a `stringsMatch` convenience wrapper, folds plain pluralization
into `comparisonKey`, and migrates the two duplicated `loadAliases()` bodies onto the shared
loader. Per the resolved specification clarification (option A), SPIKE-013/SPIKE-015's own
fuzzy-fallback call sites are explicitly out of scope for this feature.

## Technical Context

**Language/Version**: TypeScript (tsgo preview, `typescript@^7.0.2`), Node 24, run directly (no build step)

**Primary Dependencies**: None new — reuses `src/compiler/compile.ts`'s `sanitizeIdentifier` and
`src/eval/grader.ts`'s existing `comparisonKey`/`normalizeToken`/`AliasTable`

**Storage**: `eval/aliases.json` (existing file, unchanged shape/content — read through one
consolidated loader instead of two duplicated ones)

**Testing**: Node's built-in test runner (`node --test` via `pnpm test`); extends
`tests/eval/grader.test.ts` with pluralization-fold cases, adds `tests/eval/aliases.test.ts` for
the new loader/`stringsMatch`

**Target Platform**: macOS/Linux dev machines, Node 24

**Project Type**: Library (`src/eval/`) consumed by CLI scripts (`scripts/eval-extraction.ts`) and spike code

**Performance Goals**: N/A — pure string comparison, no measurable overhead beyond one extra
suffix-strip step already inside an existing string fold

**Constraints**: `pnpm test` stays offline and free (existing project constraint); strict
`tsconfig` (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) MUST NOT be weakened;
Biome lint clean; every existing `grader.ts` caller's behavior MUST NOT change (FR-009)

**Scale/Scope**: One new file (`src/eval/aliases.ts`), one small change to `comparisonKey`
(`src/eval/grader.ts`), two call-site updates (`scripts/eval-extraction.ts`, SPIKE-008's
`puzzles.ts`) — no new packages, no data migration

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. RFC/ADR-Gated Delivery** — Seeded from ADR-011 (parents RFC-001, RFC-003, RFC-004);
  `speckit-adr-gate` passed; `speckit-adr-link` executed (`spec.md`'s `**Derived From**` line and
  ADR-011's `specs:` front-matter both confirmed).
- [x] **II. Effect-Idiomatic Code** — N/A by scope, not by exception: this is grading/scoring
  infrastructure, not puzzle generation or solving logic, and the existing code it extends
  (`grader.ts`'s pure functions, `scripts/eval-extraction.ts`'s plain-async `loadAliases`) is
  already written this way (research.md Decision 5). No new `Effect` boundary is introduced or
  bypassed.
- [x] **III. Graphs as Constraint Representation** — Untouched; no constraint representation
  involved.
- [x] **IV. Design-First, Then Test-First** — ADR-011 settled the design; implementation MUST
  write the pluralization-fold and loader-consolidation tests first, observe them fail against
  the current code, then make them pass.
- [x] **V. Lint-Clean, Type-Safe** — No strictness weakening; `AliasTable`/`NormalizedToken`
  shapes are unchanged from their current, already-strict types.
- [x] **VI. Callable Tool, Not Decision System** — Directly reinforced, not just satisfied: FR-006
  requires any future similarity signal to only ever produce a reviewable suggestion, never
  resolve a match on its own — the same "report, don't resolve" shape Principle VI already
  requires at the tool's outer boundary, applied here to alias curation.

No violations. No Complexity Tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/007-string-equivalence-matching/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
└── eval/
    ├── grader.ts        # comparisonKey gains pluralization fold; normalizeToken/AliasTable unchanged
    └── aliases.ts        # NEW — loadAnswerValueAliases() (the one loader), stringsMatch() convenience wrapper

scripts/
└── eval-extraction.ts   # local loadAliases() removed; imports loadAnswerValueAliases from src/eval/aliases.ts

design/spikes/
└── SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/
    └── puzzles.ts       # local loadAliases() removed; imports loadAnswerValueAliases from src/eval/aliases.ts

tests/
└── eval/
    ├── grader.test.ts   # extended: pluralization-fold cases alongside existing coverage
    └── aliases.test.ts  # NEW — loader + stringsMatch tests
```

**Structure Decision**: Single-project layout preserved; all changes are in-place extensions of
`src/eval/` plus two call-site updates. No new packages, no new top-level directories.
SPIKE-013/SPIKE-015 files are explicitly untouched (resolved clarification, option A).

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

None — no violations.
