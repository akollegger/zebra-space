# TODO

High-level work units, each tackled separately. Every entry declares how it will be pursued:

- **RFC/ADR** — needs design discovery and/or a recorded decision first (`/rfc-create`, `/adr-create`), then usually a speckit feature.
- **speckit** — well-enough understood to go straight to a spec-driven implementation (still requires a parent ADR per the gate).
- **plan+execute** — a less formal plan discussed in-session, then executed directly.
- **collaborative iteration** — ongoing, incremental work done together over many sessions (no single spec or end state), e.g. growing the catalog.

Entries are removed (or moved to a "Done" section if we want history) when the work unit is complete or superseded.

Numbering is stable, not an ordering — items are cited by number from RFC-004 §2/§7, RFC-005 §5.7,
and `catalog/TODO.md`, so existing numbers never get reused or renumbered. Current *priority* lives
in the section below.

---

## Priority: the RFC-005 critical path

[RFC-005](design/rfc/RFC-005-progressive-puzzle-game-mechanics.md) proposes a card-based deduction
game built on this pipeline. It is still `draft` with no child ADRs, so nothing here is committed
to building a game — but reviewing it surfaced something worth acting on regardless: **RFC-005 adds
almost no new obligations. It makes existing unmet ones urgent.**

Two of its hardest prerequisites are commitments the project already made and never kept:

- **Graph representation** is item 3 of the project's stated purpose and a MUST in the
  constitution's Principle III — and `@relateby/pattern` is a declared dependency imported by
  nothing (item 6 below).
- **A solving contract richer than the trichotomy** is implied by RFC-002 but never built:
  `SolveResult` stops at two assignments by design, so no caller can ask "how many are left?"
  (item 7 below).

The two are reached by different parts of the game, and the tiering below turns on that
difference. The **core loop** consumes the second: every swipe recomputes the count, so there is
no loop at all without it. The **Cartographer** — one advisor of three — consumes the first, which
disables a named feature rather than the loop, and is why a two-advisor prototype is still a real
prototype. That the game reaches both is the strongest argument for doing them: not the game
itself, but that it shows they were load-bearing all along.

Sequenced by what blocks what, if the game direction is pursued:

| Tier | Work | Blocks | State |
|---|---|---|---|
| **1** | **7.** Solution counting + per-call latency | The entire turn loop — every swipe recomputes the remaining-solution count | Not started; `SolveResult` caps at 2 assignments |
| **2** | **6.** Graph representation | Graph/constraint search, the pre-flight retrieval audit's graph check (RFC-005 §5.4) | Not started; dependency present, unused |
| **2** | **0** + **2.** Expected-outcome vocabulary (RFC-004 §7.3) | The ill-posed stage — no way to record "correctly returned the file" as a pass | RFC-004 `draft`; vocabulary is an open question |
| **3** | **8.** Generate-from-solution + per-clue tier labels | Decks at scale; hand-authoring can bootstrap a prototype | RFC-001 §5.2 strategy 3, never built; `tier:` is `unknown` in all 39 puzzles |
| **3** | **4.** Premise linting / the "color linter" | Deck verification (RFC-005 §5.7); manual review can bootstrap | Noted, unscoped |
| — | **3.** Expressiveness gaps | Which catalog puzzles can become decks at all | Ongoing |
| — | **1.** Catalog growth, **5.** Advisory backlog | Nothing on this path | Ongoing / deferred |

Tier 1 is the honest gate: without a solution count there is no turn loop, no hint economy, and no
endgame trigger, so a prototype cannot be faked around it. Tiers 2 and 3 each disable a named
feature but not the core loop — a prototype with two advisors and hand-authored decks is a real
prototype. RFC-005 §5.7 marks the ill-posed stage as sequence-last for the same reason: it is the
only requirement blocked on design work that has not started.

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

Now gates a third consumer: RFC-005's ill-posed stage, whose winning move is returning a case file
as unanswerable with the defect named, needs both the §5.1 ladder as running code and §7.3's
vocabulary for recording that verdict as a pass. Two independent consumers wanting the same
unbuilt vocabulary — the eval and the game — is the clearest signal yet that §7.3 should be the
next ADR rather than a standing open question.

## 1. Grow the puzzle catalog in size, complexity, and variety

**Approach: collaborative iteration**

Expand `catalog/puzzles/` beyond the initial 14 relatively simple puzzles, mixing:

- deterministic constraint problems (harder zebra-style, larger domains)
- non-problems (prose that looks like a puzzle but has nothing to solve — the system should say so)
- optimization problems (an objective, not just satisfaction)
- subjective/ambiguous problems (where multiple solutions is the *correct* outcome)

Tag each puzzle with its category and rough difficulty. Treat new puzzles as a **held-out set**: score them in the eval but don't tune extraction prompts or critic rules against them directly — the current 14 remain the "dev set" we're allowed to debug against. Divergence between dev and held-out pass rates is the overfitting alarm.

Growing the catalog will surface schema/architecture requirements early (a "this isn't a CSP" outcome, objective functions in the extraction schema, multiply-satisfiable-as-pass) — feed those into workstreams 2 and 3 rather than patching ad hoc.

RFC-005 would make the catalog a **deck library** (§5.6: cards are constraints in costume, so a new domain is a reskin rather than a rebuild). Two consequences if that direction is pursued, neither urgent: the `tier:` frontmatter placeholder becomes load-bearing and needs per-*clue* granularity, not just per-puzzle (item 8); and the non-problem puzzles (PZL-0015–0021) turn out to be the most reusable material in the catalog, since RFC-005 §5.1 step 3 makes "text with no problem in it" into gameplay rather than an edge case. Worth keeping in mind while authoring, not worth restructuring for yet.

## 2. Harden the eval: grader fidelity, outcome taxonomy, and run stability

**Approach: RFC/ADR → speckit** (the outcome taxonomy is a real design decision; the grader and stability work then falls out of it)

The current pass rate overstates and understates at the same time:

- **Grader fidelity**: `MATCH` on parallel-array puzzles (PZL-0001/0002/0006/0008/0010) verifies vocabulary only, not pairing/ordering. Subset-shaped answers (PZL-0014: 3 expected tokens vs 12 actual) are compared against full assignments and read as false MISMATCHes. The grader needs pairing-aware and answer-shape-aware comparison.
- **Outcome taxonomy**: `SOLVE_MULTIPLY_SATISFIABLE` is currently always a failure; for subjective/ambiguous puzzles (workstream 1) it must be able to be the expected, passing outcome. Likewise non-problems need a passing "correctly declined to model" outcome. [Issue #11](https://github.com/akollegger/zebra-space/issues/11) has a sharp concrete case: PZL-0018 (a non-problem) is built on a uniquely-solvable house model on purpose, so a system that correctly refuses to answer scores as MISMATCH today — the *correct* behavior is indistinguishable from a wrong one.
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

[RFC-005](design/rfc/RFC-005-progressive-puzzle-game-mechanics.md) §5.7 arrives at the same check from the other direction, as a "linter for color": every authored card run through extraction to confirm it asserts exactly what it was designed to assert, catching the case where a joke smuggles in a claim. That gives this item the forcing function it has been missing — deck authoring needs the check to work at all, where the extraction pipeline merely benefits from it. Tier 3 on the RFC-005 path: careful manual review bootstraps a prototype deck, so this blocks scale rather than feasibility. Note that the two directions want different *outputs* from the same audit — extraction wants a warning attached to an answer, deck authoring wants a hard build-time failure — which is a design question for the eventual ADR, not a reason to split them.

## 5. Advisory hardening backlog (from issue #11)

**Approach: plan+execute** — each item is small and independent; no design decision required.

[Issue #11](https://github.com/akollegger/zebra-space/issues/11)'s significant findings (eval outcome taxonomy → item 2 above; stale `eval/README.md` gaps; `ProviderError` retry/escalation; per-tier timeouts) were fixed directly. Its advisory findings, deliberately left for later since none is urgent:

- **Triple home for constraint-kind semantics** — the extraction system prompt in `src/extraction/extract.ts`, the JSON Schema `description` fields in `src/extraction/types.ts`, and ADR-005 all separately re-teach the same constraint-kind rules (arithmetic vs. linkedAttributes vs. assignment, adjacency's `variable` rule, ruleTable vs. relation, token families). Three sources of truth that have already drifted once; collapsing the prompt to a thin layer over the schema descriptions (or generating one from the other) would shrink the surface.
- **`live.test.ts` samples only the original 14** — `pnpm test:live` still exercises zero of the 25 puzzles added by workstream 1 (non-problem/optimization/ambiguous/subjective). Rotate the stratified sample to cover the newer categories.
- **Worst-case eval cost is unbounded** — 2 tiers × 3 rounds × (extract + critique) ≈ up to 12 calls per puzzle, ~900+ per full `pnpm eval` run, with no budget guard. A `--max-calls` flag and per-run request counts in the raw JSON output would make cost visible before a run, not just after.
- **Small**: the extraction system prompt's "The examples below use placeholder names…" sentence no longer points at any real example block (removed in the de-overfitting rewrite); `eval/results.md` is append-only and committed, and will grow forever without a cap or trim policy.

## 6. Graphs as the constraint representation (unmet commitment)

**Approach: RFC/ADR → speckit** — the decision is *what a constraint looks like as a graph*, which
nothing has yet had to answer concretely.

Representing constraints as graphs is item 3 of the project's stated purpose in `CLAUDE.md`, and
the constitution's **Principle III** makes it a MUST: constraints "MUST be represented using
`@relateby/pattern`'s `Pattern`/`Subject`/`StandardGraph` primitives rather than bespoke, ad hoc
data structures." The package is a declared dependency in `package.json` and is imported by
nothing — `src/` holds `cli`, `compiler`, `extraction`, `solver`, and no graph module. `CLAUDE.md`'s
own Project state says as much: "There is otherwise still no puzzle generation or graph
representation."

This is the largest gap between what the project says it is and what it has built, and it has
persisted because no consumer demanded it: extraction produces `ExtractedCsp`, the compiler turns
that into `.mzn`, and the solver reads `.mzn` — a complete path from prose to answer that never
needs a graph. Principle III's own rationale anticipated this ("a single shared representation is
what lets puzzle generation, the solver, and graph rendering interoperate"), but interoperation
isn't yet load-bearing, so the ad-hoc path won.

RFC-005 §5.4's graph/constraint search is the first genuine consumer: multi-hop traversal over the
graph of facts a player has filed, surfacing **paths, never conclusions**. It needs traversal over
a real graph of established constraints, which is exactly what Principle III mandates and nothing
provides. Note the honest risk in leading with it: a pre-flight audit check is a *narrow* first
consumer, and designing the graph representation around it could produce something that serves
traversal well and generation or rendering badly. The ADR should treat this check as a forcing
function, not as the requirements document.

Worth doing on its own merits regardless of whether the game is built — an unimplemented MUST in
the constitution is either a real obligation or a principle that should be amended, and the project
should decide which.

## 7. Incremental solving and solution counting

**Approach: RFC/ADR → speckit** — extends ADR-002's solving contract; the counting-vs-deciding
trade-off is a genuine decision.

`SolveResult` is a three-way tag — `Unsatisfiable` / `UniquelySolvable` / `MultiplySatisfiable` —
and `MultiplySatisfiable` carries exactly two assignments, deliberately: the solver stops as soon
as a second solution proves non-uniqueness, which is all "is this puzzle well-formed?" ever needed.
No caller can ask **how many** solutions remain.

RFC-005's turn loop is that number. Every swipe files or dismisses a constraint and recomputes the
remaining solution count; it drives the hint economy, the advisors' honesty, the contradiction
alert (count → 0), and the endgame trigger (count → 1). RFC-005 §7.7 raises the open question
directly: is counting cheap enough at deck sizes (3–5 entities, 2–3 attribute categories), or does
the design need the trichotomy plus an approximation?

**Counting is a satisfaction measure and does not cover the subjective tier.** Subjective cards
file as weights, and a weight ranks grids rather than eliminating them (RFC-004 §5.2's CSP-versus-
COP distinction), so the count can sit still as cards are filed and never reach 1 even when a
unique optimum exists. That tier needs an optimization outcome — an optimum, and ideally a bound
on how much better anything unexplored could be — which is the same gap RFC-004 §5.2 records
against `ExtractedCsp` (no objective field) and `SolveResult` (no optimization outcome), and which
RFC-005 §7.6 leaves open on the game side. Completing this item makes the strict and ambiguous
tiers work; the subjective tier needs optimization support that is not scoped anywhere yet.

Two distinct pieces of work, and only the first is strictly required:

- **Counting.** Extend the solving contract to report a solution count, at least up to a bound
  (`count ≤ N`, saturating), since an exact count on a wide-open board is both expensive and
  useless — "more than 50" and "more than 5000" mean the same thing to a player.
- **Latency.** Today `solve()` writes a temp directory and spawns a `minizinc` process per call
  (~300–500ms in the current test suite). That is probably tolerable per swipe and definitely not
  tolerable for §5.1 step 5's deck verification, which re-solves across many reachable swipe
  sequences. Whether that needs a persistent solver process, a warm-start interface, or just
  parallelism at authoring time is the ADR's question.

Also relevant beyond the game: an approximate count is a better *difficulty* signal than the
current trichotomy, which item 1 has wanted since the `difficulty: unknown` placeholder was
introduced, and a bounded count would let the eval distinguish "underdetermined by a little" from
"barely constrained at all" (item 2).

## 8. Puzzle generation, starting with generate-from-solution

**Approach: RFC/ADR → speckit** — [RFC-001](design/rfc/RFC-001-parameterizable-puzzle-generation.md)
is still `draft`; its only child is ADR-001, which decided the *catalog format*, not generation.

The project's first stated purpose is generating prose puzzles. RFC-001 §5.2 lays out four
*complementary* strategies composing through a shared catalog — catalog selection, catalog
modification, generate-from-solution, scenario generation — and is explicit that "the real decision
isn't *which* to build, it's *what order* to build them in." Only the hub exists: ADR-001 built the
catalog that strategy 1 selects from, and none of the 39 puzzles in it came from a generator — 35
are hand-authored (`source: null`) and 4 are adapted from published sources. Strategies 2–4 were
deferred to a child ADR that was never written.

**RFC-005 needs strategy 3 specifically, and that is the most useful thing this review surfaced.**
Generate-from-solution — pick a valid answer grid, derive the clues that prove it, minimize to the
smallest subset that still determines it uniquely — is precisely RFC-005 §5.1's solution-first case
construction, arrived at independently from game-design reasoning. RFC-001 already noted the
property that makes it the right choice: it "gives a uniqueness guarantee by construction rather
than needing a separate solver pass to check it afterward." Two documents reaching the same
construction from opposite directions is good evidence it is the one to build first.

That guarantee covers less than it first appears, though, and item 7 stays on the critical path
because of it. Generate-from-solution establishes uniqueness for *one* complete, minimized clue
set. RFC-005 §5.1 step 5 has to verify something broader: that intermediate subsets behave, that
each reading of an ambiguous card leads somewhere recoverable, and that noise cards interact with
none of it. Those are per-state solver questions the construction does not answer, so this item
reduces deck verification's work without replacing it.

Two additions RFC-005 would require beyond RFC-001's original scope, both worth recording now:

- **Per-clue tier labels.** `tier:` is `unknown` in all 39 puzzles, and RFC-005 needs strictness at
  *clue* granularity (a card's tier determines its swipe grammar), not per-puzzle. The taxonomy
  itself is RFC-001's own open question, unresolved.
- **Noise generation.** RFC-005 §5.1 step 3 needs claims that are consistent with the solution but
  constrain nothing — RFC-004 §5.3's non-problem class at card granularity, plus *conditionally*
  relevant cards whose load-bearing status depends on how an earlier ambiguous card was filed. This
  one genuinely inverts RFC-001's premise: all four of its strategies aim at producing constraints,
  and strategy 3 in particular *minimizes away* everything that doesn't narrow the solution. Noise
  generation wants the discarded material back, written convincingly. Plausibly the minimization
  step can be made to emit what it drops rather than needing a separate generator.

Sequenced tier 3 because hand-authoring bootstraps a prototype fine — the catalog already proves
that. It becomes the bottleneck at content scale, not at feasibility.
