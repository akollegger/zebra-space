# ADRs — Architecture Decision Records

ADRs capture the technical **HOW** for one architecturally-significant decision — the Develop
half of the double-diamond design process described in the project's
[CLAUDE.md](../../CLAUDE.md). Every ADR requires an existing parent [RFC](../rfc/README.md); an
ADR never creates or modifies anything under `specs/` itself — that happens when a
`/speckit-specify` call references it.

## When to write an ADR

- A parent RFC has settled the problem/direction and a specific technical decision now needs to
  be made and recorded before implementation.
- The decision is concrete enough to hand to `/speckit-specify` as a feature seed.

## Format

Created/updated via `/adr-create`. File: `design/adr/ADR-NNN-short-title.md`, `NNN` zero-padded.

**Front-matter** (YAML):

| Field | Description |
|---|---|
| `id` | `ADR-NNN` |
| `title` | Short descriptive title |
| `status` | `proposed` \| `accepted` \| `rejected` \| `superseded` |
| `rfc` | Parent RFC id — **required**, set at creation, never hand-edited |
| `created` | ISO date (`YYYY-MM-DD`) |
| `specs` | List of speckit feature directories derived from this ADR — maintained automatically by the `speckit-adr-link` hook, do not hand-edit |

**Required sections** (numbered `##`, renumber if one is omitted) — `status` lives only in
front-matter, no matching body section:

1. Context
2. Decision — split into numbered `###` subsections (`2.1`, `2.2`, ...) when the decision has
   more than one genuinely distinct facet (e.g. format, location, seeding plan)
3. Alternatives Considered
4. Consequences
5. Related — RFC link and (automatically maintained) spec links

Use `/adr-review` before moving a draft to `accepted`.

## Index

| ADR | Title | Status | RFC | Specs |
|---|---|---|---|---|
| [ADR-001](ADR-001-catalog-format-seeding.md) | Puzzle Catalog Format and Seeding | proposed | RFC-001 | specs/001-catalog-seeding |
