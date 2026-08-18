# ADRs — Architecture Decision Records

ADRs capture the technical **HOW** for one architecturally-significant decision — the Develop
half of the double-diamond design process described in the project's
[CLAUDE.md](../../CLAUDE.md). Every ADR requires at least one existing parent
[RFC](../rfc/README.md) — usually one, but an ADR MAY serve more than one RFC when a decision is
genuinely shared infrastructure (e.g. a CLI interface shape that multiple problem explorations
depend on); an ADR never creates or modifies anything under `specs/` itself — that happens when a
`/speckit-specify` call references it.

## When to write an ADR

- A parent RFC has settled the problem/direction and a specific technical decision now needs to
  be made and recorded before implementation.
- The decision is concrete enough to hand to `/speckit-specify` as a feature seed.
- If a decision would genuinely serve more than one RFC, list all of them as parents rather than
  picking one arbitrarily and mentioning the rest only in prose — this project's linkage between
  RFCs and ADRs is mechanized (index tables, gate hooks), and an unlisted relationship doesn't
  benefit from that.

## Format

Created/updated via `/adr-create`. File: `design/adr/ADR-NNN-short-title.md`, `NNN` zero-padded.

**Front-matter** (YAML):

| Field | Description |
|---|---|
| `id` | `ADR-NNN` |
| `title` | Short descriptive title |
| `status` | `proposed` \| `accepted` \| `rejected` \| `superseded` |
| `rfcs` | Parent RFC id(s), a list — **required, at least one**, set at creation, only ever grows (never hand-remove an entry) |
| `created` | ISO date (`YYYY-MM-DD`) |
| `specs` | List of speckit feature directories derived from this ADR — maintained automatically by the `speckit-adr-link` hook, do not hand-edit |

**Required sections** (numbered `##`, renumber if one is omitted) — `status` lives only in
front-matter, no matching body section:

1. Context
2. Decision — split into numbered `###` subsections (`2.1`, `2.2`, ...) when the decision has
   more than one genuinely distinct facet (e.g. format, location, seeding plan)
3. Alternatives Considered
4. Consequences
5. Related — RFC link(s) and (automatically maintained) spec links

Use `/adr-review` before moving a draft to `accepted`.

## Index

| ADR | Title | Status | RFCs | Specs |
|---|---|---|---|---|
| [ADR-001](ADR-001-catalog-format-seeding.md) | Puzzle Catalog Format and Seeding | proposed | RFC-001 | specs/001-catalog-seeding |
| [ADR-002](ADR-002-adopt-minizinc-solver.md) | Adopt MiniZinc as the Constraint-Solver Ecosystem | proposed | RFC-002 | specs/002-minizinc-integration |
| [ADR-003](ADR-003-cli-interface.md) | CLI Interface Shape | proposed | RFC-002 | specs/003-cli-interface |
| [ADR-004](ADR-004-llm-extraction-critic-loop.md) | Adopt LLM-Based Extraction with a Solver-Validated Critic Loop | proposed | RFC-003 | _(none yet)_ |
| [ADR-005](ADR-005-extractedcsp-mzn-compiler.md) | ExtractedCsp to MiniZinc Compiler | proposed | RFC-002, RFC-003 | _(none yet)_ |
