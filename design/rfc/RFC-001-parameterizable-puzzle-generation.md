---
id: RFC-001
title: Parameterizable Natural-Language Zebra Puzzle Generation
status: draft
created: 2026-08-11
adrs: []
---

# RFC-001: Parameterizable Natural-Language Zebra Puzzle Generation

## 1. Summary

We need a way to generate zebra puzzles as natural-language prose, controlled by parameters
rather than hand-authored one at a time, spanning a spectrum from strict/explicit clues through
vague contextual clues to subjective preference-based clues.

## 2. Problem / Motivation

"Generating prose zebra puzzles" is a stated purpose of this project, but nothing exists yet to
do it. Hand-authoring puzzles one at a time doesn't scale and gives no way to systematically vary
difficulty, size, or clue style. As referenced in [Context Graphs & Agentic
Decisions](https://medium.com/neo4j/context-graphs-agentic-decisions-9a125f22f411), clues aren't
all the same kind of thing:

- **Strict/explicit** clues are unambiguous binary constraints (e.g. "The Red House is the middle
  house"; "The Blue House is directly to the left of the Red House").
- **Vague/contextual** clues rely on interpretation rather than a fixed rule (e.g. "The Green
  House is to the right of the Red House" — does that mean immediately adjacent, or merely
  somewhere to the right? An agent must interpret it, not just parse it).
- **Subjective/preference-based** clues express weighted preferences or emotional states rather
  than hard constraints (e.g. "Cats are terrified of dogs"; "Dogs dislike the smell of zebras") —
  satisfying them is a matter of optimization, not binary satisfaction.

Without a generator that treats this as a real spectrum, we can only ever produce the simplest,
strictest kind of puzzle — the other two categories, and the more advanced constraint problems
they imply, would need to be bolted on as an afterthought.

## 3. Goals

- Generate zebra puzzles as natural-language prose (clues a person reads), not just structured
  data.
- Puzzle generation is parameterizable: things like puzzle size, the entities/attributes
  involved, and the mix of clue kinds are inputs to generation, not hardcoded.
- Support strict/explicit clues first, since these are cleanly expressible as classic constraint
  satisfaction problems.
- Keep the door open for vague/contextual and subjective/preference-based clues as later
  additions, without needing to redo the foundational generation work to accommodate them.
- No single generation strategy (5.2) is committed to by this RFC — which one(s) to build, and
  in what order, is deferred to a child ADR informed by the comparative evaluation in 9.
- Treat the puzzle catalog as growing shared infrastructure, not just a lookup table: every
  generation strategy that produces a validated puzzle should be able to contribute it back to
  the catalog, so the catalog accumulates into a dataset usable for solver evaluation, analysis
  of what makes puzzles harder or easier, and tracking human success/fail outcomes over time (see
  9.1).
- Generation strategies are evaluated not only on effort/correctness/novelty but on resistance
  to solver memorization, so regression testing (did a known puzzle still get solved correctly?)
  and generalization testing (is the solver actually reasoning, or recalling?) can be told apart
  (see 7, 9.1–9.5).

## 4. Non-Goals

- Solving generated puzzles — that's a separate downstream concern.
- Representing clues as formal/graph constraints — that's a separate concern with its own
  design work; this RFC only covers producing the natural-language puzzle itself.
- Building a full dynamic/flexible constraint-satisfaction engine now. Initial work targets
  puzzles expressible as classic CSPs; dynamic/flexible CSPs (needed for the vague/contextual
  and subjective/preference clue tiers) are future work this RFC should not foreclose.
- Visually rendering puzzles.

## 5. Proposed Approach (high-level)

### 5.1 Clue-strictness tiers

Treat clue strictness as a genuine axis of the problem, with three tiers mirroring the reference
article's three example puzzles: strict/explicit (classic CSP), vague/contextual (requires
interpretation, implies a more dynamic/flexible constraint model), and subjective/preference-based
(requires optimization rather than satisfaction). Ship the strict/explicit tier first, since it
maps directly onto classic CSPs, but choose a generation approach and puzzle representation that
doesn't assume every clue is strict — so the later tiers extend the same foundation instead of
replacing it.

### 5.2 Generation strategies

Treat *how* a puzzle is produced as its own axis, independent of clue-strictness. These are
**complementary capabilities that compose through the shared catalog (9.1), not mutually
exclusive alternatives to pick one from** — each buys a different guarantee at a different cost,
and there's no reason a mature system wouldn't eventually have all of them:

1. **Catalog selection** — pick an existing, pre-authored puzzle from a catalog. The shared
   substrate every other strategy below feeds.
2. **Catalog modification** — take a cataloged puzzle and vary it (e.g. swap entities/attributes,
   adjust size) to produce a new but related puzzle. Depends on 1 already having something to
   vary — this is the one genuine prerequisite relationship among the four.
3. **Generate-from-solution** — pick a valid answer grid first, derive the full set of clues that
   would prove it, then minimize down to the smallest subset that still uniquely determines the
   solution. Unlike the other strategies, this gives a uniqueness guarantee by construction
   rather than needing a separate solver pass to check it afterward. Independent of 1 and 2 — it
   doesn't need a catalog to run — but its validated output is a natural contribution back into it.
4. **Scenario generation** — generate a complete puzzle from scratch, including its entities,
   attributes, and clues. Also independent of 1–3, and likewise a natural contributor back into
   the catalog. This strategy itself has at least two distinct mechanisms worth evaluating
   separately:
   - *Symbolic generation*: assemble entities, attributes, and clues procedurally from
     constraint-generation rules, then verify solvability/uniqueness afterward.
   - *LLM-native authoring*: let an LLM invent the theme and clues directly, using the
     symbolic/CSP checker afterward as a validator rather than as the generator. Likely the most
     natural fit for the vague/contextual and subjective/preference clue tiers (5.1), since those
     clue kinds resist clean procedural/template generation.

So the relationship among them is a hub (1, the catalog) with one consumer that also produces
(2) and two independent producers (3, 4) — not a sequential ladder where each requires the last,
and not a menu where building one forecloses the others. The real decision isn't *which* to
build, it's *what order* to build them in and *how* their output composes through the catalog.
A later ADR should record that sequencing and composition, informed by the comparative
evaluation in the Appendix (section 9).

### 5.3 Cross-cutting concerns

Two further ideas apply *across* the strategies in 5.2 rather than being alternatives to them:

- **Solver-in-the-loop difficulty tuning**: once a solver exists, use it as an oracle during
  generation — generate candidates via any strategy above, score them by how much
  deduction/backtracking the solver needs, and search/iterate toward a target difficulty. This
  makes difficulty a real, steerable parameter rather than an accident of whichever strategy
  produced the puzzle.
- **Template/grammar-based natural-language rendering**: separate the constraint-generation step
  from the prose-rendering step — clues are produced as structured constraints first (by whichever
  strategy in 5.2), then rendered to natural language via templates per clue family. This is
  orthogonal to which generation strategy is used, but not automatic — it's a deliberate choice
  about where the symbolic/prose boundary sits.

## 6. Alternatives Considered

- **Start only with strict/explicit clues and defer the other two tiers indefinitely, treating
  them as a separate future RFC.** Rejected: parameterizability is a stated goal, and clue
  strictness is one of the parameters — designing as if only strict clues will ever exist risks
  a foundation that can't accommodate the others later without rework.
- **Treat the generation strategies in 5.2 as mutually exclusive alternatives to choose between**
  (e.g. commit to full scenario generation up front and treat the others as rejected options).
  Rejected: they aren't actually exclusive — 5.2's hub-and-spoke relationship (the catalog as
  shared substrate, with one dependent consumer and two independent producers) means most or all
  of them are likely to get built eventually. Picking one and discarding the rest would throw
  away a working, guaranteed-correct fallback (generate-from-solution, or catalog-based
  approaches) for no real benefit; the actual decision is build order and composition, not
  selection.
- **Adopt or adapt an existing zebra-puzzle generator instead of building one.** Rejected:
  existing generators typically only cover the strict/explicit tier (5.1) and don't obviously
  extend to the vague/contextual or subjective/preference tiers this RFC treats as first-class,
  nor to the catalog-as-growing-dataset goal (3) — adapting one to all of that is likely as much
  work as building against this RFC's strategy spectrum (5.2, 9) directly, without the benefit
  of having evaluated the trade-offs ourselves.
- **Recognize and extract an implicit CSP from arbitrary prose about a real-world domain**
  (e.g. a loan-increase approval decision shaped by the immediate scenario, applicable business
  rules, and the regulatory environment), rather than generating zebra-style puzzles from
  parameters. Rejected for this RFC — this inverts the direction of every strategy in 5.2
  (extracting structure *from* unstructured prose, rather than rendering structure *as* prose),
  and generalizes far beyond puzzle generation into arbitrary business/regulatory domains that
  have nothing to do with zebra puzzles specifically. Genuinely interesting and likely valuable
  on its own terms, but different enough in kind, and large enough in scope, to deserve its own
  RFC rather than being folded into this one as a fifth generation strategy.

## 7. Open Questions

- Where exactly is the boundary between "expressible as a classic CSP" and "needs a dynamic/
  flexible CSP" — is it per-clue-tier, or can a single puzzle mix tiers?
- Given the generation strategies in 5.2 are complementary rather than exclusive, what order
  should they be built in, and how should their output actually compose through the shared
  catalog (9.1) — e.g. does 3/4's validated output get folded into the catalog automatically, or
  via a separate curation step before it's trusted as a benchmark entry?
- Should vague/contextual and subjective/preference clues be modeled as increasingly relaxed
  constraint types within one puzzle representation, or as distinct puzzle "modes"?
- What must a catalog entry capture, beyond the puzzle itself, to support solver evaluation and
  human success/fail tracking (9.1) — e.g. generating strategy/provenance, clue-strictness tier,
  known difficulty, solve/attempt history?
- How should regression testing (did a known puzzle still get solved correctly?) and
  generalization testing (is the solver actually reasoning, or recalling?) be kept distinct,
  given that catalog selection is suited to the former and catalog modification/generate-from-
  solution/scenario generation are suited to the latter (9.1–9.4)? Does a solve/attempt history
  entry (previous open question) need to record *which* kind of test it was?

## 8. ADRs

_(populated automatically as `/adr-create` links ADRs to this RFC)_

## 9. Appendix: Strategy Evaluations

Qualitative, research-level evaluation of each generation strategy from 5.2 — comparative
reasoning about trade-offs, not a design. Deciding which strategy(ies) to actually build, and in
what order, is deferred to a child ADR informed by this comparison; nothing here commits to an
implementation.

### 9.1 Catalog selection

- **Implementation effort**: Lowest of the four — needs only an initial catalog of pre-authored
  puzzles, no generation logic at all.
- **Correctness guarantee**: Strong, but only as strong as the catalog's own curation — whatever
  care went into authoring each entry.
- **Novelty/variety**: Lowest per selection — bounded by the catalog's current size; repeated use
  exhausts it. This is a property of any single selection event, not of the catalog over time
  (see Dataset value, below).
- **Fit with clue-strictness tiers (5.1)**: Works for any tier, since a cataloged entry can be
  authored at any strictness level — but doesn't itself produce *new* vague/subjective puzzles,
  it only surfaces ones someone already wrote.
- **Dataset value — the catalog's most important property**: A well-structured catalog is not
  just a lookup table to draw from — it's a growing synthetic dataset, especially once the other
  strategies (9.2–9.4) contribute validated entries back into it over time rather than producing
  one-off, disposable puzzles. That growing, structured collection is what enables:
  - **Solver evaluation** — a fixed, known-property benchmark set to measure a solver's
    correctness and performance against as the solver evolves.
  - **Analysis** — studying what makes puzzles harder or easier across clue-strictness tiers,
    once enough entries with known structure (clue mix, size, tier) exist to compare.
  - **Human success/fail metrics** — tracking which puzzles people actually solve, abandon, or
    get wrong, tied back to each entry's known structure rather than treated as anonymous trials.
- **Testing/evaluation value — with a memorization caveat**: A fixed catalog entry is a clean
  *regression* test (did this solver — computational, human, or AI — still get this one right
  after a change?), but a weak *generalization* test: any solver (especially a human, or an AI
  with the catalog in its context/training) can degenerate into recalling a previously-seen
  answer ("oh, I remember this, it's the green house") rather than re-deriving it. A fixed
  catalog alone can't distinguish "solved it" from "remembered it" — that distinction is exactly
  what 9.2's variation, and 9.3/9.4's novelty, are good for (see below).
- **Where it fits**: Given the dataset value above, the catalog isn't only a day-one fallback —
  it's long-term shared infrastructure. The other generation strategies (9.2–9.4) should be
  designed to feed validated output back into the catalog, not only to produce puzzles for
  immediate one-off use.

### 9.2 Catalog modification

- **Implementation effort**: Low-to-moderate — needs a way to vary entities/attributes/size while
  preserving solvability, which is more than selection but far less than generating from nothing.
- **Correctness guarantee**: Conditional — naive substitution risks breaking uniqueness, so this
  strategy implicitly depends on some validation step (see 5.3's solver-in-the-loop idea) rather
  than guaranteeing correctness by construction.
- **Novelty/variety**: Moderate — more variety than pure selection, but still anchored to the
  shape of whatever catalog entry it started from.
- **Fit with clue-strictness tiers (5.1)**: Strongest for strict/explicit clues, where
  substitution is mechanical; harder to apply safely to vague/subjective clues, whose meaning
  isn't a simple find-and-replace.
- **Testing/evaluation value**: This is where catalog modification earns its extra implementation
  effort over plain selection (9.1) — varying the surface details (which house is red, which
  animal goes where) while preserving the underlying constraint shape defeats rote answer
  recall. A solver has to actually pattern-match the puzzle's structure again, not just recognize
  it, which makes catalog modification a genuine (if partial) test of generalization rather than
  memory — partial because a solver could still learn to recognize the underlying *shape* itself
  if the same shape recurs often enough across modifications.

### 9.3 Generate-from-solution

- **Implementation effort**: Moderate — needs logic to derive clues from a solution grid per
  clue family, plus a minimization step to find the smallest sufficient clue set.
- **Correctness guarantee**: Strongest of the four — uniqueness is guaranteed by construction,
  not discovered by a separate check afterward.
- **Novelty/variety**: High — a new random solution grid yields a structurally new puzzle each
  time.
- **Fit with clue-strictness tiers (5.1)**: Naturally fits the strict/explicit tier, where "the
  clue that proves this fact" is a well-defined operation. Extending it to the vague/contextual
  or subjective/preference tiers is not obvious — those clues don't "prove" a fact the same way —
  and is left as an open question (see 7) rather than assumed to work.
- **Testing/evaluation value**: Strongest of the four — because every solution grid (and thus
  every clue set) is freshly derived, memorization is structurally impossible, not just made
  harder. Combined with its correctness guarantee, a solver's failure on a generate-from-solution
  puzzle can be attributed cleanly to the solver, not to a stale memory or a malformed puzzle.

### 9.4 Scenario generation

Covers both sub-mechanisms from 5.2 together, since they share the same correctness profile
(generation and correctness-checking are decoupled steps, unlike 9.3) and differ mainly in *how*
the puzzle content is produced.

- **Implementation effort**: Highest of the four. Symbolic generation needs a full set of
  procedural constraint-generation rules; LLM-native authoring needs a validation harness around
  an LLM call, plus reliable handling of malformed or unsolvable output.
- **Correctness guarantee**: Weakest — both sub-mechanisms need a separate solver pass afterward
  to confirm solvability/uniqueness, since nothing here derives clues from a known-correct
  solution the way 9.3 does.
- **Novelty/variety**: Highest — full freedom over entities, attributes, and theme, unanchored
  to any catalog or fixed solution-derivation process.
- **Fit with clue-strictness tiers (5.1)**: LLM-native authoring is the most natural fit for the
  vague/contextual and subjective/preference tiers (as noted in 5.2) — natural-language ambiguity
  and preference are exactly what an LLM is suited to author, where symbolic generation is most
  natural for the strict/explicit tier.
- **Testing/evaluation value**: High in principle — freshly-authored puzzles resist memorization
  much like 9.3 — but muddier in practice, because correctness isn't guaranteed by construction
  (see above). A solver's failure on a scenario-generated puzzle could mean the solver is wrong,
  *or* the puzzle itself is malformed/unsolvable — the two are only distinguishable if the
  post-hoc solver check (already required for correctness) is treated as part of the puzzle's
  own validation, not skipped once a puzzle merely "looks plausible."

### 9.5 Comparison summary

| Strategy | Implementation effort | Correctness guarantee | Novelty/variety | Testing/evaluation value | Best-fit clue tier |
|---|---|---|---|---|---|
| Catalog selection | Low | Strong (pre-curated) | Low per selection (grows over time — see 9.1) | Regression-only — recall risk (memorization caveat, 9.1) | Any (bounded by catalog) |
| Catalog modification | Low–Moderate | Conditional (needs validation) | Moderate | Partial generalization test — defeats answer recall, not shape recognition | Strict/explicit |
| Generate-from-solution | Moderate | Strong (by construction) | High | Strongest — memorization structurally impossible, clean failure attribution | Strict/explicit — extending further is open (7) |
| Scenario generation — symbolic | High | Weak (needs post-hoc solver check) | High | High but muddied — failure could be solver or malformed puzzle | Strict/explicit |
| Scenario generation — LLM-native | High | Weakest (needs post-hoc solver check + output reliability) | Highest | High but muddied — same caveat as symbolic | Vague/contextual, subjective/preference |

This comparison proposes *criteria* for evaluating the strategies (effort, correctness
guarantee, novelty/variety, testing/evaluation value, tier fit) — it does not resolve which
criteria should be weighted most heavily, which remains open (see 7). It also doesn't score
"contributes to the shared catalog dataset" as its own criterion (9.1) — every strategy above is
a potential *source* for the catalog, not just an alternative to it. Note the general pattern:
testing/evaluation value and correctness guarantee track together for 9.3, but *diverge* for
9.4 — high novelty with an unresolved correctness guarantee is a weaker testing tool than the
table's "Novelty/variety" column alone would suggest, which is why testing/evaluation value is
kept as its own column rather than assumed to follow from novelty.
