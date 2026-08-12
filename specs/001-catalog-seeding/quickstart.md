# Quickstart: Puzzle Catalog Seeding

Validates that the seeded catalog satisfies spec.md's Success Criteria.

## Prerequisites

- Repo checked out on branch `001-catalog-seeding`.
- Dependencies installed: `pnpm install`.
- Node version pinned via `.tool-versions` (Node 24+, needed for the built-in test runner and
  native TypeScript support already used by `src/index.ts`).

## Automated checks (SC-001, SC-002, SC-003)

```bash
pnpm test
```

Runs `tests/catalog/catalog.test.ts` (see `research.md`'s tooling decision), which asserts:

- `catalog/puzzles/` contains at least 3 files matching `PZL-\d{4}-.+\.md` (SC-001).
- Every matched file's frontmatter has all fields listed in `data-model.md`'s Puzzle Catalog
  Entry table, non-empty (SC-002).
- `catalog/README.md`'s table has exactly one row per matched file, and vice versa (SC-003).

Expected result before any catalog content exists: **fails** (no `catalog/puzzles/` directory,
per this project's test-first principle). Expected result once seeding is complete: **passes**.

## Manual check (SC-004)

`pnpm test` cannot check puzzle solvability — no solver exists yet (ADR-001 explicitly defers
that). Instead:

1. Open each file under `catalog/puzzles/`.
2. Solve it by hand from its prose clues alone.
3. Compare your solution against the matching entry in
   `specs/001-catalog-seeding/answer-keys.md` (the private verification artifact, FR-009).
4. Confirm exactly one assignment satisfies every clue for every entry.

## Browse the result

Open `catalog/README.md` and confirm it reads as a usable index: titles, sizes, sources, and
status for every seeded puzzle, with a working link to each file.
