# TODO

High-level work units, each tackled separately. Every entry declares how it will be pursued:

- **RFC/ADR** — needs design discovery and/or a recorded decision first (`/rfc-create`, `/adr-create`), then usually a speckit feature.
- **speckit** — well-enough understood to go straight to a spec-driven implementation (still requires a parent ADR per the gate).
- **plan+execute** — a less formal plan discussed in-session, then executed directly.
- **collaborative iteration** — ongoing, incremental work done together over many sessions (no single spec or end state), e.g. growing the catalog.

Entries are removed (or moved to a "Done" section if we want history) when the work unit is complete or superseded.

---

## 0. Foundations: define the problem space

**Approach: RFC/ADR** — [RFC-004](design/rfc/RFC-004-computational-decision-making.md) drafted
2026-08-21, status `draft`.

Numbered 0 because it's foundational rather than sequenced first: RFC-001/002/003 each assumed a
well-posed problem as input without defining one, and the gap only became visible once the catalog
started acquiring non-determinate material. RFC-004 defines well-posedness (a six-condition
ladder), reconciles satisfaction (CSP) with optimization (COP), and classifies problems as
determinate / ambiguous-NL / subjective / non-problem.

Gates workstreams 2 and 3 below: the eval's outcome taxonomy (2) should follow from what can go
wrong in principle rather than from today's failure modes, and the expressiveness gaps (3) are
easier to scope once the classification exists. Doesn't gate workstream 1 — authoring puzzles is
how the classification gets tested. Next step is `/rfc-review`, then an ADR for the
expected-outcome vocabulary (RFC-004 §7.3).

## 1. Grow the puzzle catalog in size, complexity, and variety

**Approach: collaborative iteration**

Expand `catalog/puzzles/` beyond the initial 14 relatively simple puzzles, mixing:

- deterministic constraint problems (harder zebra-style, larger domains)
- non-problems (prose that looks like a puzzle but has nothing to solve — the system should say so)
- optimization problems (an objective, not just satisfaction)
- subjective/ambiguous problems (where multiple solutions is the *correct* outcome)

Tag each puzzle with its category and rough difficulty. Treat new puzzles as a **held-out set**: score them in the eval but don't tune extraction prompts or critic rules against them directly — the current 14 remain the "dev set" we're allowed to debug against. Divergence between dev and held-out pass rates is the overfitting alarm.

Growing the catalog will surface schema/architecture requirements early (a "this isn't a CSP" outcome, objective functions in the extraction schema, multiply-satisfiable-as-pass) — feed those into workstreams 2 and 3 rather than patching ad hoc.

## 2. Harden the eval: grader fidelity, outcome taxonomy, and run stability

**Approach: RFC/ADR → speckit** (the outcome taxonomy is a real design decision; the grader and stability work then falls out of it)

The current pass rate overstates and understates at the same time:

- **Grader fidelity**: `MATCH` on parallel-array puzzles (PZL-0001/0002/0006/0008/0010) verifies vocabulary only, not pairing/ordering. Subset-shaped answers (PZL-0014: 3 expected tokens vs 12 actual) are compared against full assignments and read as false MISMATCHes. The grader needs pairing-aware and answer-shape-aware comparison.
- **Outcome taxonomy**: `SOLVE_MULTIPLY_SATISFIABLE` is currently always a failure; for subjective/ambiguous puzzles (workstream 1) it must be able to be the expected, passing outcome. Likewise non-problems need a passing "correctly declined to model" outcome.
- **Run stability**: extraction is stochastic — the same commit has historically scored anywhere from 0/14 to 3/14 across runs in a single day. Add repeat-run support (N runs per eval) and report per-puzzle pass *frequency* ("solves 7 reliably, 4 sometimes, 3 never") instead of single-snapshot pass rates, so we know whether the current 9/14 is a floor or a lucky draw.

## 3. Close structural expressiveness gaps in the extraction schema / compiler

**Approach: RFC/ADR → speckit** (each gap is a constraint-language feature decision, not a puzzle-specific patch)

Four of the five current failures are capability gaps, not tuning problems. Fix the *class*, never the puzzle:

- **Reified adjacency** (PZL-0001): adjacency constraints can't appear inside a reified implication's `then` list.
- **Simultaneity/equality of events** (PZL-0010): no way to represent "arrive at the same moment"; the critic correctly rejects every attempt.
- **Derived per-entity variables** (PZL-0011): extraction emits references like `priya_credit_score` with no declarable domain — either the schema needs derived/attribute variables or the extractor needs a supported way to express them.

Guardrail for this workstream (and a standing rule elsewhere): an improvement is legitimate if it's stated in terms of a constraint-language feature; if it can only be stated in terms of a specific PZL, it's overfitting and doesn't belong here.

## 4. Premise linting for extraction (noted, not yet scoped)

**Approach: RFC/ADR** — a design question, not a known feature to build.

Recorded from the discussion behind `catalog/`'s subjective puzzles (PZL-0033–PZL-0039), to pick up at implementation time. The idea: a check that audits the *gap between prose and model* rather than the model's internal consistency — flagging where an extraction invented a constraint the text never stated, or ignored a stated fact that a near-universally-held premise would have turned into one.

Why it's worth its own consideration rather than folding into the critic loop:

- **[ADR-004](design/adr/ADR-004-llm-extraction-critic-loop.md) §3 already rejected a lint layer**, but a different one — referential integrity (are constraint-referenced values members of their declared domains) — on the grounds that MiniZinc's own type system catches it downstream for free. **That reasoning does not transfer here.** Nothing downstream catches an invented premise: a model with a hallucinated constraint, and a model missing a premise-derived one, both compile and solve cleanly. The solver never sees the prose (the same argument ADR-004's Context uses to reject solver round-tripping as a trust gate).
- The fidelity critic judges whether the extraction is faithful *to the prose*. A premise lint asks a different question: whether the prose alone was *sufficient*, and what had to be assumed to close the gap. Related but not the same check.
- PZL-0038 shows the check has to cut both ways. Importing a premise can be affirmatively wrong, not merely unwarranted — so a lint that only flags *missing* constraints would pass a system that over-constrains, and vice versa.

The real-world motivation is stronger than the puzzle framing suggests: the interesting everyday failure is a person (or a system) not accounting for a concern that looks obvious in retrospect. High agreement on a premise is exactly what makes its omission hard to notice in review — see `catalog/TODO.md`'s note on why the high-agreement/high-stakes cell is the sharpest test rather than the safest.

Depends on [RFC-004](design/rfc/RFC-004-computational-decision-making.md) §5.4's provenance framing (an answer holds only conditional on premises supplied) and its §7.11 (whether that condition rides in-band with the answer) — a lint has nowhere to report to until that's settled. Also a candidate addition to RFC-004 §5.7's silent-promotion list, which currently names four flavors and omits *inventing a constraint from world knowledge*.
