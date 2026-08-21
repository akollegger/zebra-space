# Catalog TODO

Working notes for growing the catalog (TODO.md item 1 at the repo root). This is scratch
tracking for us, not part of the public catalog — `README.md`'s Index table remains the
catalog of record; nothing here duplicates it.

## Backlog

Puzzle ideas queued up but not yet written. Move an idea to `puzzles/` (per README.md's
"Adding a puzzle" steps) and delete it from here once it exists.

- _(empty — add ideas as we think of them)_

## Coverage

Rough count of existing puzzles by category (not tracked in puzzle frontmatter yet — this is
our own bookkeeping until/unless a `category` field gets formalized).

| Category | Count | Puzzles |
|---|---|---|
| Deterministic | 14 | PZL-0001–PZL-0014 |
| Non-problem | 1 | PZL-0015 |
| Optimization | 0 | — |
| Subjective/ambiguous | 0 | — |

## Dev / held-out split

Per the discussion behind this workstream: the current 14 are the **dev set** — fair game to
inspect while debugging extraction/critic/compiler issues. Puzzles added from here on are
**held-out** — scored by the eval but not used to guide prompt or compiler tuning, so a gap
between dev and held-out pass rates is our overfitting signal.

| Set | Puzzles |
|---|---|
| Dev | PZL-0001–PZL-0014 |
| Held-out | PZL-0015 |
