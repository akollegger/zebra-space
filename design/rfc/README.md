# RFCs — Requests for Comment

RFCs capture **WHAT** a problem is and **WHY** it matters, plus high-level candidate directions —
the Discover/Define half of the double-diamond design process described in the project's
[CLAUDE.md](../../CLAUDE.md). They deliberately exclude implementation detail; that lives in one
or more child [ADRs](../adr/README.md).

## When to write an RFC

- A new capability or subsystem is being considered and the problem/scope isn't settled yet.
- Multiple genuinely different high-level directions exist and the trade-off is worth recording.
- Before any `/adr-create` or `/speckit-specify` work — every ADR requires a parent RFC.

## Format

Created/updated via `/rfc-create`. File: `design/rfc/RFC-NNN-short-title.md`, `NNN` zero-padded.

**Front-matter** (YAML):

| Field | Description |
|---|---|
| `id` | `RFC-NNN` |
| `title` | Short descriptive title |
| `status` | `draft` \| `review` \| `accepted` \| `superseded` |
| `created` | ISO date (`YYYY-MM-DD`) |
| `adrs` | List of child ADR ids — maintained automatically by `/adr-create`, do not hand-edit |

**Required sections** (numbered `##`, renumber if one is omitted):

1. Summary
2. Problem / Motivation
3. Goals
4. Non-Goals
5. Proposed Approach (high-level) — split into numbered `###` subsections when more than one
   distinct axis or strategy is being explored
6. Alternatives Considered
7. Open Questions — each item individually numbered (`7.1.`, `7.2.`, ...), never a plain bullet
   list, so other sections, ADRs, and future RFCs can cite exactly which question they address
8. ADRs — list of child ADRs, kept in sync with the `adrs:` front-matter field

Optional appendices may follow as additional numbered sections (`## 9. Appendix: ...`, etc.) —
useful for a research-level comparative evaluation of candidate approaches from section 5 that's
too detailed for the main body but still belongs at the RFC's WHAT/WHY level (i.e. it compares
options, it doesn't design one).

Use `/rfc-review` before moving a draft to `review`/`accepted`.

## Index

| RFC | Title | Status | ADRs |
|---|---|---|---|
| [RFC-001](RFC-001-parameterizable-puzzle-generation.md) | Parameterizable Natural-Language Zebra Puzzle Generation | draft | ADR-001 |
