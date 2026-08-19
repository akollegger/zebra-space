# Implementation Plan: Puzzle Catalog Seeding

**Branch**: `001-catalog-seeding` | **Date**: 2026-08-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-catalog-seeding/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Establish `catalog/puzzles/` as one Markdown+frontmatter file per puzzle (ADR-001's schema),
seed it with the canonical 1962 *Life International* puzzle plus two hand-authored classic-CSP
puzzles, and add `catalog/README.md` as a living index — giving the other RFC-001 generation
strategies (and this feature's own automated check) real, non-empty catalog content to work
against for the first time.

## Technical Context

**Language/Version**: No application code — deliverables are Markdown+YAML content files. The
one supporting artifact that is code is a TypeScript test file, run via Node 24+'s native
type-stripping (same toolchain `src/index.ts` already uses; no build step).

**Primary Dependencies**: None new. No npm package is added for this feature.

**Storage**: Flat files on disk — `catalog/puzzles/*.md` (public), `catalog/README.md` (public
index), `eval/answer-keys.json` (private, FR-009). No database.

**Testing**: Node's built-in test runner (`node --test`, wired to `pnpm test`) checking SC-001
(file count), SC-002 (frontmatter completeness), SC-003 (index/file parity). SC-004 (unique
solution) is verified manually per FR-009 — not automatable without a solver, which ADR-001
explicitly defers.

**Target Platform**: Same as the rest of the repo (local Node 24+ dev environment) — no new
runtime surface.

**Project Type**: Content-seeding feature within the existing single-package repo.

**Performance Goals**: N/A — static content, no runtime performance concern.

**Constraints**: Puzzle body MUST stay unstructured prose (ADR-001 §2.1) — the automated check
MUST validate frontmatter only, never impose a body structure.

**Scale/Scope**: 3 seed entries (1 canonical + 2 hand-authored, per spec.md's Assumptions);
`PZL-NNNN` id space supports up to 9999 entries without renumbering (ADR-001 §2.2).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. RFC/ADR-Gated Delivery | PASS | Spec derived from ADR-001 (design/adr/ADR-001-catalog-format-seeding.md), parent RFC-001; gated by `speckit-adr-gate`. |
| II. Effect-Idiomatic Code | N/A | No puzzle generation/solving logic is written by this feature — it's content plus a plain assertion-based test file, not an `Effect` pipeline concern. |
| III. Graphs as the Constraint Representation | N/A | Deliberately out of scope: puzzles are stored as prose only, per ADR-001 §2.1 and RFC-001's Non-Goals. No constraint graph is built here. |
| IV. Design-First, Then Test-First | PASS | Design (RFC-001 → ADR-001 → this spec) precedes implementation. `tests/catalog/catalog.test.ts` (Phase 0/1 output below) is written first and MUST fail against the current, catalog-less repo before seed content is added — satisfying test-first for everything automatable (SC-001–003). SC-004 is a manual check (FR-009), justified by ADR-001's explicit deferral of a solver, not a gate violation. |

No violations — Complexity Tracking is not needed.

## Project Structure

### Documentation (this feature)

```text
specs/001-catalog-seeding/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

The private verification artifact (FR-009) was originally authored here as `answer-keys.md`
during implementation, then later relocated to `eval/answer-keys.json` (moved, and reformatted
from Markdown to JSON) so it could double as the extraction eval's machine-readable ground truth.

No `contracts/` directory: this feature exposes no API, CLI, or other interface to document —
it's content plus a test file, purely internal to the repo.

### Source Code (repository root)

```text
catalog/
├── README.md                                    # living index (ADR-001 §2.3)
└── puzzles/
    ├── PZL-0001-life-international-1962.md      # canonical, FR-004
    ├── PZL-0002-<hand-authored-short-name>.md    # FR-005
    └── PZL-0003-<hand-authored-short-name>.md    # FR-005

tests/
└── catalog/
    └── catalog.test.ts                           # SC-001/002/003, node --test
```

**Structure Decision**: Single-project structure (matches the existing repo). This feature adds
two new top-level directories, `catalog/` (content) and `tests/` (automated checks) — it does
not touch `src/index.ts` or add any new source module, since no application code is required.

## Complexity Tracking

*No Constitution Check violations — this section is not needed.*
