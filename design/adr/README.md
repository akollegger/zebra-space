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

**Required sections** (`##`):

1. Status
2. Context
3. Decision
4. Alternatives Considered
5. Consequences
6. Related — RFC link and (automatically maintained) spec links

Use `/adr-review` before moving a draft to `accepted`.

## Index

| ADR | Title | Status | RFC | Specs |
|---|---|---|---|---|
| _(none yet)_ | | | | |
