<!--
Sync Impact Report
Version change: (unratified template) → 1.0.0
Modified principles: n/a — initial ratification
Added sections:
  - Core Principles: I. RFC/ADR-Gated Delivery, II. Effect-Idiomatic Code,
    III. Graphs as the Constraint Representation, IV. Design-First, Then Test-First
  - Governance
Removed sections:
  - [SECTION_2_NAME]/[SECTION_2_CONTENT] and [SECTION_3_NAME]/[SECTION_3_CONTENT] placeholders
    (omitted — no additional-constraints or workflow content beyond the principles/governance
    below is established yet; add a section if and when concrete content exists)
Deferred TODOs: none
-->

# Zebra Space Constitution

## Core Principles

### I. RFC/ADR-Gated Delivery

No implementation work MAY proceed through `/speckit-specify` without referencing at least one
existing Architecture Decision Record (ADR), and no ADR MAY exist without a parent RFC. The
chain is: RFC (the problem, and why it matters) → ADR (the technical decision, and how) →
speckit spec/plan/tasks/implement. This is mechanically enforced, not just conventional: the
`speckit-adr-gate` hook (registered in `.specify/extensions.yml`, `before_specify`) hard-blocks
`/speckit-specify` when no ADR is referenced, and `speckit-adr-link` (`after_specify`) backlinks
the resulting spec to its ADR(s).

Rationale: implementation must trace back to an explicit, reviewed design decision, not to scope
invented ad hoc mid-build.

### II. Effect-Idiomatic Code

Puzzle generation and solving logic MUST be modeled as `Effect` pipelines (`Effect`, `Option`,
`pipe`, and related combinators) rather than bare `async`/`await` or thrown exceptions.

Rationale: `effect` is a core dependency chosen specifically to make control flow, error
handling, and composition explicit and typed; ad hoc async code bypasses that discipline.

### III. Graphs as the Constraint Representation

Puzzle constraints MUST be represented using `@relateby/pattern`'s `Pattern`/`Subject`/
`StandardGraph` primitives rather than bespoke, ad hoc data structures.

Rationale: representing constraints as graphs is a stated project purpose, and a single shared
representation is what lets puzzle generation, the solver, and graph rendering interoperate
without each inventing its own translation layer.

### IV. Design-First, Then Test-First

Every feature is designed before it is built: the RFC/ADR process (Principle I) settles what
the problem is, why it matters, and the technical approach before any code is written.
Implementation only begins once an ADR exists, and from that point on it MUST follow test-first
practice — tests are written and observed to fail before the code that makes them pass is
written.

Rationale: design-first prevents architecture from being improvised inside a pull request;
test-first, applied once the design is settled, keeps "deciding what to build" and "proving it
works" as separate, sequential concerns rather than tangled together.

## Governance

This constitution supersedes all other project practices and conventions. Amendments are made
via `/speckit-constitution` and follow semantic versioning: MAJOR for backward-incompatible
principle removals or redefinitions, MINOR for new or materially expanded principles, PATCH for
wording or clarification fixes with no rule change. `/speckit-plan`'s Constitution Check gate is
the primary compliance checkpoint for new work; any justified deviation from a principle MUST be
recorded in that plan's Complexity Tracking rather than silently ignored.

**Version**: 1.0.0 | **Ratified**: 2026-08-11 | **Last Amended**: 2026-08-11
