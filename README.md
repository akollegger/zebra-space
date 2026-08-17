# Zebra Space - Puzzles, Representations, Solvers

Zebra space is a place for:

1. Generating prose [zebra puzzles](https://en.wikipedia.org/wiki/Zebra_Puzzle)
2. Modeling puzzles as [constraint satisfaction problems](https://en.wikipedia.org/wiki/Constraint_satisfaction_problem)
3. Representing constraints as graphs
4. Solving puzzles with a solver

## Getting Started

```bash
pnpm install
brew install minizinc && ./scripts/setup-minizinc-solver.sh   # one-time solver setup
pnpm link .                                                     # dev-mode: makes `zebra` runnable via pnpm exec
pnpm exec zebra solve catalog/mzn/PZL-0004-whodunit.mzn
```

`zebra --help` lists all available subcommands. `pnpm link .` only needs to be run once per
checkout — it self-links this package so its `bin` (`zebra`) resolves through `pnpm exec` without
a real global install.

## Mission

Zebra Space exists to explore how classic, well-understood [constraint
satisfaction](https://en.wikipedia.org/wiki/Constraint_satisfaction_problem) holds up as a
foundation for more agentic, LLM-driven reasoning. Zebra puzzles are the vehicle: a small,
tractable domain spanning strict/explicit clues, vague/contextual clues, and
subjective/preference-based ones — enough range to build and test real tooling without the
domain's own complexity getting in the way of the actual questions.

This is a place people (and agents) directly generate, inspect, and solve puzzles through real
tools — not just a library other code happens to import. That starts with a command-line
interface.

**Non-goals for now**: a general-purpose CSP framework for arbitrary domains, and a
hosted/multi-user service. Both are explicitly out of scope until a concrete need justifies
revisiting them.

## Design Process

Work here follows a double-diamond: an [RFC](design/rfc/README.md) settles what a problem is
and why it matters, one or more [ADRs](design/adr/README.md) settle the concrete technical
decision, and only then does a [spec](specs/) turn an ADR into implementation
(`/speckit-specify` → plan → tasks → implement). See [CLAUDE.md](CLAUDE.md) for how the three
layers connect and where the tooling that enforces this lives.

---
## References

Articles:
- [Context Graphs & Agentic Decisions](https://medium.com/neo4j/context-graphs-agentic-decisions-9a125f22f411)


Papers:
- [Solving Zebra Puzzles Using Constraint-Guided Multi-Agent Systems](https://arxiv.org/html/2407.03956v3)

Software:
- [MiniZinc](https://www.minizinc.org)
