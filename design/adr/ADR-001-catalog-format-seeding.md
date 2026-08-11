---
id: ADR-001
title: Puzzle Catalog Format and Seeding
status: proposed
rfc: RFC-001
created: 2026-08-11
specs: []
---

# ADR-001: Puzzle Catalog Format and Seeding

## 1. Context

RFC-001 (5.2, 9.1) identifies catalog selection as the foundational generation strategy — the
shared substrate every other strategy (9.2–9.4) feeds output back into — and its Goals (3) treat
the catalog as growing infrastructure for solver evaluation, difficulty/tier analysis, and human
success/fail tracking, not just a lookup table. None of that exists yet: there's no puzzle file
format, no directory, no index, and no seed content. This ADR settles the concrete format,
location, and initial seeding approach for the catalog *substrate* — it does not decide the
selection mechanism itself (e.g. random vs. filtered retrieval, or what interface exposes it),
which is a separate decision a follow-up ADR should make once there's a substrate to select
from. It likewise does not design solving, graph representation, or a live attempt-history
logging system — those stay out of scope per RFC-001's Non-Goals (4) and are called out
explicitly below. It also deliberately stops short of the solver-evaluation dataset RFC-001
envisions long-term: there's no parent RFC yet for evaluation itself, so this ADR seeds the
catalog with prose and basic metadata only, leaving the answer-key/solution representation for
that future RFC to settle.

**Prior art surveyed**: existing zebra-puzzle resources fall into two categories relevant here —
(a) published/canonical puzzles as natural-language prose (e.g. the original 1962 *Life
International* puzzle reproduced on
[Wikipedia](https://en.wikipedia.org/wiki/Zebra_Puzzle), and hand-curated collections like
[Brainzilla's](https://www.brainzilla.com/logic/zebra/)), and (b) open-source
generators/solvers that produce fresh puzzles programmatically (e.g.
[tuchandra/zebra](https://github.com/tuchandra/zebra),
[Kryowulf/LogikGen](https://github.com/Kryowulf/LogikGen),
[murfffi/zebra4j](https://murfffi.github.io/zebra4j/)) or benchmark datasets of structured (not
prose) constraint grids at scale (e.g. the ZebraLogic-style benchmark referenced by
[Sophon's OpenReward zebra environment](https://sophon.at/tools/openreward-generalreasoning-zebra)).
Category (a) is directly relevant to seeding — it's already natural-language prose, matching
RFC-001's Goal 1. Category (b) is more relevant to ADR-003/004 (generation strategies 3–4) than
to this ADR, though its tools are a candidate future *source* feeding this catalog once built.

## 2. Decision

### 2.1 Format

One Markdown file per puzzle, with YAML frontmatter for structured metadata and the Markdown
body holding the puzzle as natural-language prose (the clues a person reads, per RFC-001 Goal
1). Frontmatter schema:

```yaml
---
id: PUZZLE-NNN
title: <short title>
# tier taxonomy isn't settled yet (RFC-001 Open Question 7.3) — reserved, no defined values yet
tier: unknown
# CSP-neutral sizing, not "houses"/"attributes":
variables: 20     # e.g. entities × attribute-categories
domains: 5        # count of distinct domains (e.g. attribute categories) — a count, not a size;
                  # sidesteps whether a domain is binary/enumerated/range/open-ended
constraints: 14   # count of clues/constraints
source: null      # optional URL pointing to where this puzzle was copied/adapted from;
                  # null/absent means hand-authored or otherwise not copied from anywhere
difficulty: unknown     # placeholder; populated later by 5.3's solver-in-the-loop tuning
created: <date>
---

<the puzzle, in whatever natural-language form the author chose>
```

The body is unstructured prose, full stop — not a numbered list, not any other prescribed
layout. It may be a numbered list of clues, a narrative paragraph, verse, or include preamble
and framing text that isn't a "clue" in any formal sense. Nothing about it is directly
computable; that's the whole point of keeping it informal (see Non-Goal 4) rather than a
formalism this ADR would otherwise be tempted to define.

There is deliberately no `solution`/answer-key field yet. RFC-001's Goals (3, 9.1) do call for
the catalog to support solver evaluation eventually, but *how* a solution should be represented,
and how it's checked against an attempt, is properly the concern of a future RFC about
evaluation — committing to a `solution` shape here, before that RFC has scoped the actual
requirements, risks locking in a representation nobody has evaluated yet. Storing clues only as
prose (no structured/graph form either) matches RFC-001's Non-Goal (4) of deferring formal
constraint representation to separate work — this ADR's catalog is prose-plus-metadata only,
not yet a solver-evaluation dataset in the full sense RFC-001 envisions. A `solution` field can
be added as a non-breaking frontmatter extension once that future RFC settles its shape.

This schema is deliberately minimal and scoped to catalog-selection's own seed entries — it is
**not** proposed as a universal schema every future strategy must conform to. There's no
`strategy`/provenance-mechanism field: catalog selection is the only strategy contributing
entries right now, so recording "which strategy produced this" would be a constant, meaningless
value. When ADR-002/003/004 (catalog modification, generate-from-solution, scenario generation)
start contributing entries, each is free to add whatever fields actually justify themselves for
*that* strategy (e.g. catalog modification likely wants a `derived_from: PUZZLE-NNN` pointer;
generate-from-solution might want a random seed) rather than forcing one shared field to cover
every case speculatively.

### 2.2 Directory

`catalog/puzzles/PUZZLE-NNN-short-name.md`, `NNN` zero-padded, numbered sequentially — the same
convention already established for `design/rfc/RFC-NNN-*` and `design/adr/ADR-NNN-*`.
`catalog/` sits at the repo root, sibling to `design/` and `src/`: it's runtime data the
application consumes, not design documentation and not source code.

### 2.3 Index

`catalog/README.md`, mirroring the living-index pattern already used by
`design/rfc/README.md` and `design/adr/README.md` — a table of `Puzzle | Title | Size | Source |
Status` (no `Tier` column while that field is a placeholder), refreshed whenever an entry is
added. Kept manually in sync for now (no dedicated `catalog-create` skill exists yet);
implementing this ADR should include maintaining that index as a functional requirement.

### 2.4 Seeding

Seed the initial catalog with (1) the canonical 1962 *Life International* puzzle (public domain,
widely reproduced) transcribed into this format, and (2) a small number of hand-authored
puzzles expressible as classic CSPs, rather than scraping third-party collections — see section
3 (Alternatives Considered) for why. Seed entries leave `tier` at its `unknown` placeholder
value (2.1); they're chosen to match RFC-001's Goal of supporting classic-CSP puzzles first
(RFC-001 §3), not tagged against a tier taxonomy that isn't settled yet.

## 3. Alternatives Considered

- **JSON (or YAML) instead of Markdown+frontmatter for the whole entry, including clues.**
  Rejected: RFC-001 Goal 1 is puzzles as natural-language prose a person reads — burying clues
  as strings inside a JSON array is a worse authoring and review experience than a Markdown body,
  and produces noisier diffs in PRs.
- **One large file (array of all puzzles) instead of one file per puzzle.** Rejected: doesn't
  match the one-file-per-item convention already established for RFCs/ADRs, produces messy diffs
  when a single puzzle is added or edited, and makes it harder to reference one puzzle by a
  stable path (needed for future solve/attempt-history entries, RFC-001 Open Question 7.4).
- **Scrape/adapt existing published puzzle collections (e.g. Brainzilla) directly as seed
  content.** Rejected as the primary sourcing method: most published collections carry no clear
  open license, and building a benchmark-quality catalog on uncertain-provenance content risks
  having to rip it out later. Hand-authoring plus the one clearly public-domain canonical puzzle
  avoids that risk; the `source` field exists specifically so any future adaptation is cited
  rather than silently absorbed — anyone adding a `source` URL is expected to have already
  checked it's public-domain or otherwise permitted before copying.
- **Import an existing structured benchmark (e.g. a ZebraLogic-style dataset) wholesale.**
  Rejected for this ADR: those are distributed as structured constraint grids for LLM-eval
  benchmarking, not natural-language prose, and importing a well-known public eval set risks
  contaminating later solver-evaluation claims if a solver was trained on it. Noted as a
  candidate reference for later difficulty calibration (5.3), not as catalog content.
- **Defer seeding entirely — leave the catalog empty until ADR-002/003/004 (strategies 2–4)
  contribute the first entries.** Rejected: this is a bootstrapping exercise — the catalog
  substrate needs at least something in it to be testable, demonstrable, and usable as the
  target other strategies contribute back into, per RFC-001's Goals (3). Two cheaply-sourced
  seed entries (one public-domain, one hand-authored) cost little and unblock everything
  downstream; waiting for another strategy to populate the catalog first has no real benefit and
  blocks validating the format/directory/index decisions in this ADR at all.

## 4. Consequences

- The catalog starts deliberately small (a handful of entries) and is expected to grow primarily
  through ADR-002/003/004 (strategies 2–4) contributing validated output back into it, per
  RFC-001's Goals (3) — this ADR only establishes the format/location/index those contributions
  land in.
- This ADR does not make catalog selection (RFC-001 5.2 item 1) actually usable end-to-end — it
  builds the substrate (format/directory/index/seed content) but not the retrieval mechanism
  (e.g. random vs. filtered selection, or what interface exposes it). A follow-up ADR must decide
  that before `/speckit-specify` can build a working "select a puzzle" capability.
- Solver evaluation (RFC-001 Goal 3, 9.1) is not actually usable yet from this catalog alone —
  there's no `solution` field, so nothing can be checked for correctness against an entry.
  That, along with solve/attempt-history tracking (RFC-001 Open Question 7.4), is deferred to a
  future RFC scoped to evaluation, which should settle the solution representation before an ADR
  adds it here as a non-breaking extension.
- Copyright/licensing discipline (checking before setting `source`) must be maintained by every
  future contributor to the catalog, not just this seed — worth calling out in any future
  catalog-related ADR or contribution guide.
- Deliberately not designing a universal per-strategy metadata schema now (see Decision) means
  ADR-002/003/004 will each need to decide their own additional fields when they're written —
  a small amount of repeated decision-making, traded for not guessing at fields a strategy that
  doesn't exist yet might need.
- `catalog/README.md`'s index is manually maintained for now; if the catalog grows large enough
  that manual upkeep becomes error-prone, a dedicated maintenance skill (mirroring
  `rfc-create`/`adr-create`'s automatic index updates) would be a reasonable follow-up.

## 5. Related

- RFC: RFC-001
- Specs: _(populated automatically by the speckit ADR-link hook once `/speckit-specify` references this ADR)_
