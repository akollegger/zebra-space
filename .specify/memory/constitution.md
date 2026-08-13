<!--
Sync Impact Report
Version change: 1.0.0 → 1.1.0
Modified principles:
  - I. RFC/ADR-Gated Delivery — clarified the RFC:ADR relationship as many-to-many (an ADR still
    requires at least one parent RFC, but MAY legitimately serve more than one when a decision
    is genuinely shared infrastructure). Materially expanded allowance, not a wording-only
    change — hence MINOR, not PATCH.
Added sections: none
Removed sections: none
Deferred TODOs: none
-->

# Zebra Space Constitution

## Core Principles

### I. RFC/ADR-Gated Delivery

No implementation work MAY proceed through `/speckit-specify` without referencing at least one
existing Architecture Decision Record (ADR), and no ADR MAY exist without at least one parent
RFC. The RFC:ADR relationship is many-to-many, not one-to-one: usually one RFC motivates one
ADR, but an ADR MAY list more than one parent RFC when the decision is genuinely shared
infrastructure that multiple problem explorations depend on (e.g. a CLI interface shape serving
both a generation-strategy RFC and a solving RFC) — such an ADR MUST NOT arbitrarily pick one
RFC as "the" parent and relegate the others to prose. The chain is: RFC(s) (the problem, and why
it matters) → ADR (the technical decision, and how) → speckit spec/plan/tasks/implement. This is
mechanically enforced, not just conventional: the `speckit-adr-gate` hook (registered in
`.specify/extensions.yml`, `before_specify`) hard-blocks `/speckit-specify` when no ADR is
referenced, and `speckit-adr-link` (`after_specify`) backlinks the resulting spec to its ADR(s).

Rationale: implementation must trace back to an explicit, reviewed design decision, not to scope
invented ad hoc mid-build. Allowing an ADR multiple parent RFCs reflects how shared-infrastructure
decisions actually arise, rather than forcing an artificial single-parent choice that a prose
workaround would then quietly undermine.

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

**Version**: 1.1.0 | **Ratified**: 2026-08-11 | **Last Amended**: 2026-08-13
