---
id: ADR-002
title: Adopt MiniZinc as the Constraint-Solver Ecosystem
status: proposed
rfc: RFC-002
created: 2026-08-12
specs: []
---

# ADR-002: Adopt MiniZinc as the Constraint-Solver Ecosystem

## 1. Context

RFC-002 established that this project needs a way to check whether a puzzle is solvable — and
specifically, uniquely solvable — without relying on manual solving, and that building a solver
ourselves is explicitly out of scope. RFC-002 §5.2 compared five candidate ecosystems and §5.4
listed the abstract requirements any solver-ready representation needs to expose (finite
enumerable domains, an explicit constraint list, coverage of the constraint shapes already in
the catalog, all/n-solutions query support, and stable identifiers for round-tripping results).
§5.1 defined what "solved" means: unsatisfiable, uniquely satisfiable, or multiply satisfiable.

This ADR converges on MiniZinc as the chosen ecosystem and makes the integration concrete enough
to build: which backend solver to target by default, how the puzzle reaches the solver from this
project's TypeScript/Effect codebase, and how uniqueness is checked efficiently (resolving
RFC-002's Open Question 7.2). It does **not** design the compiler that turns a puzzle's
`@relateby/pattern` graph into a MiniZinc model — that remains a separate, still-undesigned
follow-up ADR, per RFC-002's Non-Goal 2. This ADR only commits to the target this project's own
future graph representation must eventually be compiled to.

## 2. Decision

### 2.1 Ecosystem and compilation path

Use MiniZinc's own toolchain: generate a `.mzn` model and invoke the `minizinc` CLI, which
compiles it to FlatZinc internally and dispatches to a backend solver. This project does not
hand-generate FlatZinc directly — FlatZinc is meant to be a compiler output, and reimplementing
that flattening step ourselves would be error-prone for no real benefit, per RFC-002 §5.2's
comparison and the earlier discussion that motivated it. This resolves RFC-002 Open Question 7.4
in favor of the portable intermediate format over a solver-native one — the backend (2.2) can
change later without touching anything upstream of it.

### 2.2 Default backend solver

Gecode is the default backend. It ships bundled with standard MiniZinc installations (no extra
install step beyond MiniZinc itself), is open-source (MIT), and has solid general-purpose
performance for finite-domain CSPs. Because MiniZinc's whole design point is solver-agnosticism,
switching to a different backend (e.g. Chuffed) later — if a specific constraint shape
underperforms on Gecode — is a low-cost change that doesn't touch anything upstream of the
solver invocation.

### 2.3 Hand-off mechanism

Invoke the `minizinc` CLI as a local subprocess via `@effect/platform`'s `Command` module, per
the constitution's Effect-Idiomatic Code principle. This resolves RFC-002 Open Question 7.1 in
favor of local execution over a hosted/network service (see §3 for the rejected alternative).
The generated `.mzn` (and, if needed, a separate `.dzn` data file for puzzle-specific values) are
each written to a temp file in the OS temp directory before invocation, and passed to the CLI as
file-path arguments — MiniZinc's CLI takes file paths, not stdin. Temp files are cleaned up after
the invocation completes (success or failure). Solver output is captured from stdout. Non-zero
exit codes, parse failures, and timeouts are modeled as typed Effect errors rather than thrown
exceptions, so callers compose with the rest of this project's `Effect` pipelines.

### 2.4 Solving semantics — checking unique solvability

Resolves RFC-002 Open Question 7.2. Request at most 2 solutions per invocation
(`minizinc -n 2 ...`) rather than enumerating every solution:

- **0 solutions** → unsatisfiable.
- **Exactly 1 solution** → uniquely solvable — the desired state for a "good" puzzle.
- **2 solutions** → multiply satisfiable (under-constrained); the search stops at 2 without
  counting the rest, since the puzzle is already disqualified as uniquely solvable.

This bounds the cost of checking uniqueness for puzzles that happen to be heavily
under-constrained, where full enumeration could be expensive or unbounded.

### 2.5 Input/output shape

At the decision level — not the compiler's design, which stays deferred (Context) — a puzzle's
computable CSP representation maps onto MiniZinc as: decision variables as `array of var` (one
array per domain/attribute-category, sized to the puzzle's entity count) constrained to their
finite value sets, and constraints as MiniZinc `constraint` statements built from `alldifferent`,
comparison/arithmetic operators, and `if-then-else`, as appropriate to the clue being expressed.
This directly satisfies RFC-002 §5.4's requirements: MiniZinc's decision variables are inherently
finite-domain and enumerable, its constraint statements are computable predicates over named
variables, and its built-ins already cover every constraint shape present in the current catalog
(e.g. `PZL-0007`'s arithmetic, `PZL-0004`'s all-different, `PZL-0010`'s ordering, `PZL-0011`'s
if-then rules). Output parsing must preserve the stable identifiers RFC-002 §5.4 called for, so a
solution maps back to "which entity gets which attribute" in the original puzzle rather than
anonymous array indices. Concretely, solver invocations use `minizinc --output-mode json`, so
solutions come back as JSON with variable names as keys — a stable, directly parseable format
rather than a custom `output` statement this project would otherwise have to design and maintain
per model.

### 2.6 Example catalog

To build and validate the eventual graph-to-`.mzn` compiler (Context; deferred to a follow-up
ADR), this project accumulates hand-written MiniZinc examples in `catalog/mzn/`, sibling to
`catalog/puzzles/`. Each example is one `.mzn` file, named after the puzzle it models where one
exists (e.g. `catalog/mzn/PZL-0004-whodunit.mzn`) — a growing, concrete reference corpus of what
a catalog puzzle's constraints look like in MiniZinc, independent of any compiler. This ADR only
establishes the directory and naming convention; populating it — hand-translating catalog
puzzles into `.mzn`, one at a time — is follow-up work, not required for this decision to be
complete.

## 3. Alternatives Considered

- **Run MiniZinc as a hosted/containerized service instead of a local subprocess.** Rejected:
  adds a network dependency and deployment surface for no current benefit — this project's
  puzzle sizes and usage don't need it, and a local subprocess keeps development and CI simple.
  Revisit if solving ever needs to scale beyond a single process.
- **Hand-generate FlatZinc directly, skip the MiniZinc language entirely.** Rejected (2.1):
  FlatZinc is a compiler target, not an authoring format; reimplementing MiniZinc's flattening
  ourselves adds risk without a corresponding benefit, since nothing here requires bypassing the
  standard toolchain.
- **Use `minizinc-python` instead of the CLI.** Rejected: it's a Python-first binding, which is
  the wrong language bridge for a TypeScript/Effect codebase — it would introduce a second
  runtime dependency (Python) purely to reach a tool that already exposes a plain CLI.
  Subprocess invocation via `@effect/platform`'s Command module stays entirely within this
  project's existing stack.
- **Enumerate all solutions instead of capping at 2 for uniqueness checks.** Rejected (2.4): full
  enumeration is unnecessary work once a second solution has been found — the puzzle is already
  known to not be uniquely solvable — and could be expensive or slow for badly under-constrained
  puzzles.
- **Chuffed as the default backend instead of Gecode.** Rejected for now: Gecode ships bundled
  with MiniZinc by default, so it requires no extra install step; Chuffed remains a reasonable
  fallback to revisit if a specific constraint class is shown to perform poorly on Gecode.

## 4. Consequences

- MiniZinc becomes an external toolchain dependency, not an npm package — any environment
  running this capability (developer machines, CI) needs the `minizinc` CLI installed
  separately. This should be documented (e.g. `CLAUDE.md`'s Commands section) once the
  integration is actually built.
- The graph-to-`.mzn` compiler itself remains undesigned — a follow-up ADR must design how a
  `@relateby/pattern` graph is translated into the `array of var` / `constraint` shape this ADR
  commits to (2.5), informed by RFC-002 §5.4's requirements and this ADR's chosen target.
- CLI-subprocess integration (2.3) has real overhead (process startup, serialization through
  stdout) that's acceptable for this project's puzzle sizes, but would need revisiting if a
  future use case turns solving into a hot path (e.g. real-time interactive generation at scale).
- Gecode (2.2) is swappable for a different MiniZinc-compatible backend later at low cost, since
  nothing upstream of the solver invocation depends on which backend is selected.
- Checking uniqueness by capping at 2 solutions (2.4) means this project never has visibility
  into *how* under-constrained a multiply-satisfiable puzzle is (e.g. 2 solutions vs. 200) unless
  a future need justifies paying for fuller enumeration.
- MiniZinc itself is MPL 2.0-licensed (Gecode is separately MIT-licensed, per 2.2). This project
  invokes MiniZinc as an external CLI tool (2.3) rather than linking or modifying its source, so
  MPL 2.0's file-level copyleft obligations don't attach to this codebase. This resolves RFC-002
  Open Question 7.3.
- `catalog/mzn/` (2.6) starts empty — it's a follow-up authoring effort, one example at a time,
  not something this ADR populates. It's expected to directly inform (and later validate against)
  the graph-to-`.mzn` compiler ADR once that's written.

## 5. Related

- RFC: RFC-002
- Specs: _(populated automatically by the speckit ADR-link hook once `/speckit-specify` references this ADR)_
