---
id: RFC-002
title: Constraint Solver Selection
status: draft
created: 2026-08-12
adrs: [ADR-002, ADR-003, ADR-005]
---

# RFC-002: Constraint Solver Selection

## 1. Summary

Zebra-style CSPs are generated and cataloged — and, per RFC-001's planned strategies, will be
modified — with no way to check solvability, let alone *unique* solvability, other than working a
puzzle out by hand. An existing, mature constraint-solver ecosystem can take over that check,
rather than building solving logic from scratch.

## 2. Problem / Motivation

Every seed puzzle in the catalog (RFC-001, ADR-001) was verified solvable by hand, one at a
time. That doesn't scale: RFC-001's catalog-modification strategy (§9.2; a follow-up ADR under
RFC-001) needs to confirm that a *programmatically generated* variant is still uniquely
solvable, and manual solving can't be the verification method for something meant to run
automatically. RFC-001's own Non-Goals (4) and ADR-001's Context explicitly exclude solving from
that RFC's scope.

Building a solver is itself a large, well-studied problem (constraint propagation, search
strategies, global constraints, performance tuning) that mature ecosystems already solve well.
The project's background reading already names [MiniZinc](https://www.minizinc.org) as prior art
for constraint modeling/solving.

## 3. Goals

- Select one constraint-solver ecosystem/toolchain that fits this project's stack
  (TypeScript/Effect, Node) well enough to integrate cleanly.
- Establish a shared definition of what "solved" means for this project's puzzles (e.g.
  unsatisfiable, uniquely satisfiable, or multiply satisfiable) before any ADR designs the
  hand-off around it.
- Identify, at a high level, what a computable CSP representation needs to expose to be
  solver-ready — without designing that representation itself (Principle III already commits
  puzzle constraints to `@relateby/pattern` graphs; this RFC is about what a graph needs to be
  able to produce for a solver, not the graph format itself).
- Keep the integration loosely coupled enough that changing solver ecosystems later doesn't
  require re-touching puzzle generation or catalog code.

## 4. Non-Goals

- Implementing a constraint solver, or any part of one — propagation algorithms, search
  strategies, and global-constraint implementations are explicitly out of scope. This project
  hands off to a solver; it does not build one.
- Designing the graph-to-computable-CSP compiler itself. That's a child ADR's job once a solver
  ecosystem is chosen here — the compiler's target format depends on this RFC's outcome.
- Puzzle generation, catalog modification, or any other RFC-001 generation strategy. This RFC is
  only about the solving/hand-off boundary those strategies will eventually depend on.
- Difficulty calibration or solver-in-the-loop tuning (RFC-001 §5.3). That work *consumes* this
  capability once it exists; it isn't this RFC's concern.

## 5. Proposed Approach (high-level)

### 5.1 What "solved" means

A puzzle handed to a solver should come back as exactly one of: unsatisfiable (the clues
contradict each other — no valid assignment exists), uniquely satisfiable (exactly one valid
assignment — the desired state for a "good" puzzle), or multiply satisfiable (more than one
valid assignment — an under-constrained puzzle). Zebra-style puzzles are specifically expected
to be uniquely satisfiable; distinguishing that from "merely satisfiable" is what makes
uniqueness checking harder than plain solving, and any ecosystem choice needs to support it
directly or via a workaround (see Open Question 7.2).

### 5.2 Candidate solver ecosystems

Directions worth evaluating, compared on solving power for finite-domain CSPs, ecosystem
maturity, integration shape, and license terms:

- **MiniZinc**, compiled to FlatZinc and run against a backend solver (e.g. Gecode, Chuffed, or
  OR-Tools' FlatZinc interface) — a modeling language plus a mature, solver-agnostic toolchain.
- **Google OR-Tools' CP-SAT solver** used directly (native bindings or its own modeling API),
  bypassing MiniZinc's modeling layer entirely.
- **SMT solvers** (e.g. Z3) via their API bindings — a different theoretical framing
  (satisfiability modulo theories) that also handles finite-domain CSPs.
- **Constraint logic programming systems** (e.g. SWI-Prolog's `clpfd`) — a longstanding, mature
  approach to exactly this class of problem.
- **Any usable pure JS/TS constraint-solving library**, if one exists with enough solving power
  for this project's puzzle sizes — worth checking for, since it would avoid a cross-language
  hand-off entirely.

### 5.3 Hand-off mechanism shapes

Independent of which ecosystem is chosen, the puzzle needs to reach the solver somehow.
Candidate shapes, at a conceptual level: invoking a local CLI/subprocess, linking a native
library/binding directly into the Node process, or calling a hosted/network API. Each has
different implications for latency, offline development, and deployment — worth naming now so
the eventual ADR evaluates them deliberately rather than defaulting to whichever shape the
chosen ecosystem happens to make easiest.

### 5.4 What a solver-ready representation needs to expose

Independent of which ecosystem is chosen (5.2), any solver hand-off needs the computable CSP to
expose, at minimum:

- **Finite, enumerable domains** — every variable's possible values must be a finite, enumerable
  set. This excludes continuous domains (e.g. real-valued ranges) — consistent with this project's
  classic-CSP scope.
- **An explicit constraint list** — every constraint expressible as a computable predicate over a
  finite set of variables, not natural-language prose. The graph must be translatable into "for
  these N variables, this relation must hold," not left implicit in a clue's wording.
- **Coverage of the constraint shapes already in the catalog** — equality/assignment,
  all-different, arithmetic relations (sums, comparisons), ordering/precedence, and simple
  if-then logic, since seed puzzles already exercise all of these (e.g. `PZL-0007`'s arithmetic,
  `PZL-0004`'s all-different, `PZL-0010`'s ordering, `PZL-0011`'s if-then rules).
- **A way to ask for all solutions (or a count/proof of exactly one)**, not just a single
  satisfying assignment — required for the uniqueness check central to §5.1, and tied to Open
  Question 7.2.
- **Stable identifiers for variables and values** that survive round-tripping back to the
  original graph/puzzle, so a solver's output maps back to "which entity gets which attribute"
  rather than anonymous indices.

This is a requirements list, not a design — how a graph is actually compiled to meet these
requirements for a specific ecosystem is the eventual compiler ADR's job (Non-Goal 2).

## 6. Alternatives Considered

- **Adopt an existing zebra-puzzle-specific solver** (e.g. the generators/solvers ADR-001's
  Context already surveyed as prior art: `tuchandra/zebra`, `Kryowulf/LogikGen`,
  `murfffi/zebra4j`). Rejected as the primary solution: those solve zebra-style attribute-grid
  puzzles specifically, but this catalog already includes non-attribute-grid CSPs (map coloring,
  N-Queens, cryptarithmetic, packing — see `catalog/`) that a zebra-specific solver wouldn't
  handle. A general-purpose CSP solver ecosystem covers this catalog's actual diversity; a
  zebra-specific tool would work for a subset of it at best.
- **Implement a minimal custom solver ourselves** (e.g. simple backtracking with basic
  constraint propagation). Rejected: even a "minimal" solver handling all-different constraints
  and relational clues is a real undertaking with well-known failure modes (poor performance
  without good propagation/heuristics), and mature tools already solve this class of problem
  well — reinventing it would be a poor use of effort.
- **Defer solvability verification indefinitely, keep solving by hand.** Rejected: doesn't scale
  past the seed catalog, and permanently blocks catalog modification (RFC-001 §9.2) and any
  future difficulty-calibration or evaluation work.
- **Use an LLM as the "solver."** Rejected as a primary mechanism: this project's own motivation
  (RFC-001) is partly grounded in LLMs being unreliable at strict combinatorial reasoning at
  scale, so using one to *verify* solvability would undermine the verification's trustworthiness.
  Possibly useful later as a cross-check, but not the primary solving mechanism.

## 7. Open Questions

7.1. Does the chosen solver ecosystem need to run locally (subprocess or native binding), or is
a hosted/network service acceptable, given latency, availability, and offline-development
tradeoffs?

7.2. How should "uniquely solvable" be checked efficiently — does a candidate ecosystem support
enumerating all solutions (or proving there's exactly one) directly, or does uniqueness require
solving twice (once normally, once with the first solution's assignment excluded) as a
workaround?

7.3. What license terms apply to candidate solver backends (some are open-source with
restrictions, some are commercial), and does that affect redistribution or contributor
requirements for this project?

7.4. Should the eventual graph-to-CSP compiler target a specific solver's native format, or a
more portable intermediate format (e.g. FlatZinc, which multiple backends can consume), to keep
the solver choice more easily revisable later?

## 8. ADRs

- ADR-002: Adopt MiniZinc as the Constraint-Solver Ecosystem
- ADR-003: CLI Interface Shape
- ADR-005: ExtractedCsp to MiniZinc Compiler

## 9. Appendix: Solver Ecosystem Comparison

Qualitative comparison of §5.2's candidates, on the axes that section names. Research-level, not
a decision — the eventual ADR should verify these before committing.

| Ecosystem | Solving Power | Maturity | Integration Shape | License |
|---|---|---|---|---|
| MiniZinc + FlatZinc backend (Gecode/Chuffed/OR-Tools) | High — global constraints, choice of backend solver | Very mature; long academic and industry use | CLI/subprocess via the `minizinc` toolchain | MiniZinc: MPL 2.0; backends vary (Gecode: MIT; Chuffed: MIT) |
| OR-Tools CP-SAT (used directly) | High — state-of-the-art CP-SAT solver, very fast on many CSPs | Very mature; Google-maintained, widely used in industry | Native bindings (C++ core; official Python/Java/.NET bindings, no first-class Node/TS binding) | Apache 2.0 |
| SMT solver (e.g. Z3) | High for its class, but framed as SMT rather than native finite-domain CP — can encode CSPs, just not its primary design target | Very mature; widely used in formal verification and program analysis | Native bindings (has a JS/WASM build) or CLI | MIT |
| Prolog CLP (e.g. SWI-Prolog `clpfd`) | Good for finite-domain CSPs; decades of use on exactly this puzzle class | Very mature | CLI/subprocess, or embed a Prolog engine | SWI-Prolog: BSD-2 |
| JS/TS-native constraint library (if a suitable one exists) | Unverified — needs research; likely lower solving power than the above for larger puzzles | Varies; generally less mature than the above | Native (no cross-language hand-off needed) | Varies |
