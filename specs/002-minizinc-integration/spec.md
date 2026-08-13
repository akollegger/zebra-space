# Feature Specification: MiniZinc Solver Integration

**Feature Branch**: `002-minizinc-integration`

**Created**: 2026-08-12

**Status**: Draft

**Input**: User description: "Integration with MiniZinc as detailed in @design/adr/ADR-002-adopt-minizinc-solver.md"

**Derived From**: ADR-002 (design/adr/ADR-002-adopt-minizinc-solver.md)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Check whether a puzzle is solvable, and how (Priority: P1)

A developer has a puzzle expressed as a MiniZinc model and wants to know, without solving it by
hand, whether it's unsatisfiable, uniquely solvable, or multiply satisfiable (under-constrained).

**Why this priority**: This is the entire reason RFC-002/ADR-002 exist — replacing manual
solving with an automated check. Nothing else in this feature has value without it.

**Independent Test**: Can be fully tested by submitting three small hand-written models (one of
each outcome) and confirming each is classified correctly.

**Acceptance Scenarios**:

1. **Given** a MiniZinc model whose clues contradict each other, **When** it's submitted for
   solving, **Then** the result is classified as unsatisfiable.
2. **Given** a MiniZinc model with exactly one valid assignment, **When** it's submitted for
   solving, **Then** the result is classified as uniquely solvable, with that assignment
   returned.
3. **Given** a MiniZinc model with more than one valid assignment, **When** it's submitted for
   solving, **Then** the result is classified as multiply satisfiable, without waiting to find
   every possible assignment.

---

### User Story 2 - Get a usable answer back, not an opaque one (Priority: P2)

When a model is uniquely solvable, a developer needs the actual solution in a form that maps
back to the puzzle's own variable names — not anonymous array positions they'd have to decode by
hand.

**Why this priority**: A "yes it's solvable" answer without the actual assignment isn't very
useful for cross-checking against an expected answer (e.g. a private answer key) — this is what
makes the result actually usable, on top of User Story 1's bare classification.

**Independent Test**: Can be fully tested by submitting a solvable model and confirming the
returned solution's variable names match the model's own names, with correct values.

**Acceptance Scenarios**:

1. **Given** a uniquely solvable model with named variables, **When** its solution is returned,
   **Then** each variable's name and solved value are both present and correctly paired.

---

### User Story 3 - See it actually work on a real catalog puzzle (Priority: P3)

A developer or reviewer wants at least one concrete, real example — an existing catalog puzzle,
hand-translated into MiniZinc — to prove this capability works end-to-end, not just in isolated
toy tests.

**Why this priority**: Toy tests (User Stories 1-2) prove the mechanism works in principle; a
real catalog puzzle proves it works in practice, and gives future work (e.g. a graph-to-MiniZinc
compiler) a concrete reference to check itself against.

**Independent Test**: Can be fully tested by running the seeded example through this capability
and comparing its result against that puzzle's existing recorded answer.

**Acceptance Scenarios**:

1. **Given** the seeded example in the MiniZinc example catalog, **When** it's run through this
   capability, **Then** the result is uniquely solvable, and the returned solution matches that
   puzzle's existing private answer-key entry exactly.

### Edge Cases

- What happens if the MiniZinc toolchain isn't installed/available? The failure MUST be surfaced
  as a clear, specific error — not a generic crash or a silent empty result.
- What happens if solving takes too long (e.g. a pathological model)? The attempt MUST time out
  and fail clearly rather than hang indefinitely.
- What happens if the submitted model has a syntax error? The failure MUST be surfaced as a
  clear, specific error distinguishable from "unsatisfiable" (a syntax error is not the same as
  a puzzle having no solution).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST solve a given MiniZinc model (and optional accompanying data) by
  invoking the `minizinc` CLI as a local subprocess.
- **FR-002**: The system MUST request at most 2 solutions per solve attempt, and classify the
  result as unsatisfiable (0 returned), uniquely solvable (exactly 1 returned), or multiply
  satisfiable (2 returned) — never waiting to enumerate beyond 2.
- **FR-003**: The system MUST use Gecode as the default backend solver.
- **FR-004**: The system MUST parse solver output as JSON and return a structured result mapping
  each variable's name to its solved value (when a solution exists).
- **FR-005**: The system MUST write the model (and optional data) to temporary files before
  invocation, and remove those temporary files after the attempt completes, whether it succeeds
  or fails.
- **FR-006**: The system MUST surface failures (missing toolchain, non-zero exit, model syntax
  errors, timeouts) as specific, catchable errors rather than throwing generic exceptions or
  crashing.
- **FR-007**: A MiniZinc example catalog MUST exist as a directory, sibling to the existing
  puzzle catalog, for accumulating hand-written reference models over time.
- **FR-008**: The MiniZinc example catalog MUST contain at least one entry: an existing catalog
  puzzle, hand-translated into a MiniZinc model, to demonstrate this capability end-to-end.
- **FR-009**: Running the seeded example through this capability MUST return a uniquely-solvable
  result whose solution matches that puzzle's existing recorded answer exactly.
- **FR-010**: The project's setup documentation MUST note the MiniZinc toolchain (with Gecode) as
  a required external dependency for this capability.

### Key Entities

- **Solve Request**: A MiniZinc model, plus optional accompanying data, submitted for solving.
- **Solve Result**: The classified outcome of a solve attempt — unsatisfiable, uniquely
  solvable, or multiply satisfiable — carrying the variable→value assignment when one exists.
- **Example Catalog Entry**: One hand-written MiniZinc model in the example catalog,
  corresponding to an existing puzzle catalog entry.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A known-unsatisfiable toy model is correctly classified as unsatisfiable.
- **SC-002**: A known-uniquely-solvable toy model is correctly classified as uniquely solvable,
  with a correct variable→value assignment returned.
- **SC-003**: A known-multiply-satisfiable toy model is correctly classified as multiply
  satisfiable, without the attempt taking longer than enumerating just 2 solutions requires.
- **SC-004**: The MiniZinc example catalog contains at least one entry, and running it through
  this capability reproduces that puzzle's existing recorded answer exactly.
- **SC-005**: No temporary files created during a solve attempt remain afterward, whether the
  attempt succeeded or failed.

## Assumptions

- The MiniZinc toolchain (with Gecode) is available on the `PATH` in development and CI
  environments; this feature documents that requirement but does not install the toolchain
  itself.
- The seeded example catalog entry (FR-008) is `PZL-0004` (Whodunit) — ADR-002 §2.5 already
  names it as the reference example for the `alldifferent` constraint pattern, and it's small
  enough to hand-translate and verify with confidence.
- A reasonable default timeout (on the order of tens of seconds) applies to solve attempts, since
  ADR-002 doesn't pin a specific value; this can be tuned later without changing this feature's
  scope.
- No automatic prose-to-MiniZinc translation exists yet — the seeded example is hand-translated,
  consistent with ADR-002 §2.6 describing the example catalog as built "one at a time, hand
  translated." An automatic compiler remains a separate, future ADR (RFC-002 Non-Goal 2).
