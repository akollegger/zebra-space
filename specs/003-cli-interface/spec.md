# Feature Specification: CLI Interface

**Feature Branch**: `003-cli-interface`

**Created**: 2026-08-13

**Status**: Draft

**Input**: User description: "CLI Interface as detailed in @design/adr/ADR-003-cli-interface.md: build the zebra CLI tool — subcommand-oriented (zebra <subcommand> [args] [flags]) with global --help/--version, and its first subcommand, solve, wrapping the existing src/solver/solve() capability."

**Derived From**: ADR-003 (design/adr/ADR-003-cli-interface.md)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Solve a puzzle from the command line (Priority: P1)

A user has a puzzle expressed as a MiniZinc model and wants to know whether it's solvable —
and if so, how — without writing any code or knowing this project's internals.

**Why this priority**: This is the entire reason the CLI exists — turning the existing `solve()`
capability into something a person can actually run. Nothing else in this feature has value
without it.

**Independent Test**: Can be fully tested by running the tool against a model file and
confirming the printed result matches the model's known outcome.

**Acceptance Scenarios**:

1. **Given** a model file with exactly one valid solution, **When** the user runs the `solve`
   subcommand against it, **Then** the tool prints that solution in a readable form and exits
   successfully.
2. **Given** a model file with no valid solution, **When** the user runs `solve` against it,
   **Then** the tool prints that the puzzle is unsatisfiable and still exits successfully — this
   is a correct answer, not a tool failure.
3. **Given** a model file with more than one valid solution, **When** the user runs `solve`
   against it, **Then** the tool prints that the puzzle has multiple solutions and still exits
   successfully, for the same reason.
4. **Given** the solver itself can't run or complete (e.g. a missing dependency or a malformed
   model), **When** the user runs `solve`, **Then** the tool prints a clear error to stderr and
   exits unsuccessfully — this case, and only this case, is a failure.

---

### User Story 2 - Get machine-readable output for scripting (Priority: P2)

A user wants to pipe a solve result into another tool or script, rather than read it themselves.

**Why this priority**: Valuable on top of User Story 1's human-readable output, but scripting is
a secondary use case compared to a person directly checking a puzzle.

**Independent Test**: Can be fully tested by running the tool with a machine-readable output
flag and confirming the output parses as well-formed structured data matching the solve result.

**Acceptance Scenarios**:

1. **Given** any model file, **When** the user requests machine-readable output, **Then** the
   printed output is valid, parseable structured data describing the same result the
   human-readable form would show.

---

### User Story 3 - Discover how to use the tool without external docs (Priority: P3)

A first-time user wants to learn what the tool can do and how, from the tool itself.

**Why this priority**: Good discoverability matters for a tool meant to be invoked directly, but
it's a usability layer on top of Stories 1-2's actual capability, not a precondition for it.

**Independent Test**: Can be fully tested by running help/version flags alone, with no other
arguments, and confirming useful output.

**Acceptance Scenarios**:

1. **Given** the tool is installed, **When** the user asks for top-level help, **Then** they see
   a list of available subcommands.
2. **Given** the tool is installed, **When** the user asks for help on a specific subcommand,
   **Then** they see that subcommand's own arguments and options.
3. **Given** the tool is installed, **When** the user asks for the tool's version, **Then** they
   see it printed.
4. **Given** the user runs a subcommand that doesn't exist, **When** the tool processes that
   request, **Then** it lists the available subcommands and exits unsuccessfully, rather than
   doing nothing.

### Edge Cases

- What happens if the given model file doesn't exist or can't be read? Treated as a solver
  failure (User Story 1, Scenario 4) — a clear error on stderr, unsuccessful exit.
- What happens if both a human-readable and machine-readable output request are given at once?
  Machine-readable output takes precedence — a user who explicitly asks for structured output
  should always get it.
- What happens if no subcommand is given at all? Same as top-level help (User Story 3, Scenario
  1) — showing available subcommands is more useful than a bare error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a single command-line tool, invoked as
  `zebra <subcommand> [args] [flags]`.
- **FR-002**: The system MUST provide a `solve` subcommand accepting a model file path, an
  optional data file path, an optional solver choice, and an optional machine-readable-output
  flag.
- **FR-003**: `solve` MUST pass the given model (and data, if given) to the existing solve
  capability and report its result — it MUST NOT re-implement or duplicate any solving logic.
- **FR-004**: By default, `solve` MUST print its result in a human-readable form describing the
  outcome (unsatisfiable, uniquely solvable with its solution, or multiply satisfiable).
- **FR-005**: When machine-readable output is requested, `solve` MUST print the same result as
  structured data (JSON) instead of the human-readable form.
- **FR-006**: `solve` MUST exit successfully for every outcome the solve capability itself
  reports without error — unsatisfiable and multiply-satisfiable results are correct answers,
  not tool failures, and MUST NOT cause an unsuccessful exit.
- **FR-007**: `solve` MUST exit unsuccessfully, with a clear error message on stderr, only when
  the solve capability itself fails to run or complete.
- **FR-008**: The tool MUST support a top-level help flag that lists available subcommands.
- **FR-009**: The tool MUST support a per-subcommand help flag that describes that subcommand's
  own arguments and options.
- **FR-010**: The tool MUST support a version flag that prints the tool's version.
- **FR-011**: Running an unrecognized subcommand MUST list the available subcommands and exit
  unsuccessfully, rather than silently doing nothing.

### Key Entities

- **CLI Invocation**: One run of the tool — a subcommand plus its arguments and flags.
- **Solve Report**: The human-readable or machine-readable rendering of a solve outcome,
  presented to the user by the `solve` subcommand.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Running `solve` against a model with exactly one solution shows that solution and
  exits successfully.
- **SC-002**: Running `solve` against an unsatisfiable model reports that outcome and still
  exits successfully.
- **SC-003**: Running `solve` against a multiply-satisfiable model reports that outcome and
  still exits successfully.
- **SC-004**: Requesting machine-readable output from `solve` produces valid, parseable
  structured data matching the underlying result, for 100% of the outcomes in SC-001–003.
- **SC-005**: Running `solve` against an input that causes the solve capability itself to fail
  exits unsuccessfully with an error visible on stderr.
- **SC-006**: Top-level help, per-subcommand help, and the version flag each produce relevant,
  non-empty output without running any subcommand's actual logic.
- **SC-007**: Running an unrecognized subcommand lists available subcommands and exits
  unsuccessfully.

## Assumptions

- The CLI is invoked through this project's existing Node/pnpm tooling (e.g. `pnpm exec zebra
  ...`, or directly as `zebra ...` once installed) — exact installation/invocation mechanics are
  an implementation detail, not a change to any requirement above.
- Exact wording of human-readable output is left to implementation; this spec only constrains
  its *content* (which outcome, and the solution when there is one), per ADR-003's own deferral
  of exact text.
- Only `solve` exists as a subcommand for this feature. Future subcommands (e.g. anything
  catalog-related) are out of scope here and will be specified separately when designed, per
  ADR-003's Consequences.
