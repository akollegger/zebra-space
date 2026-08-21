---
id: RFC-004
title: Computational Decision Making
status: draft
created: 2026-08-21
adrs: []
---

# RFC-004: Computational Decision Making

## 1. Summary

Every capability this project has built so far — generation
([RFC-001](RFC-001-parameterizable-puzzle-generation.md)), solving
([RFC-002](RFC-002-constraint-solver-selection.md)), extraction
([RFC-003](RFC-003-natural-language-csp-extraction.md)) — assumes its input prose *is* a
well-posed constraint problem. That assumption was safe while the catalog was uniformly
determinate and is now demonstrably false. This RFC defines the problem space those RFCs
presupposed: what makes prose a solvable problem at all, which classes of problem are in scope,
and what a correct *non*-answer is.

## 2. Problem / Motivation

The project has worked from reasonable assumptions, well-known definitions, and a reference
solver — none of them written down. Three concrete symptoms show that the implicit vocabulary has
run out:

**The solver contract and the generation roadmap already disagree, and nothing records it.**
[RFC-002](RFC-002-constraint-solver-selection.md) §3 set out to "establish a shared definition of
what 'solved' means for this project's puzzles (e.g. unsatisfiable, uniquely satisfiable, or
multiply satisfiable)" — a purely satisfaction-shaped, three-way taxonomy, now implemented as
`SolveResult` in `src/solver/types.ts`. RFC-002 does not mention optimization anywhere. But
[RFC-001](RFC-001-parameterizable-puzzle-generation.md) §2 states that satisfying
subjective/preference clues "is a matter of optimization, not binary satisfaction," and its §5.1
makes that tier a planned axis of the work rather than a speculative aside. One RFC's roadmap
therefore requires a solving regime the other RFC's selected contract cannot express, and the
conflict has never been stated as such.

**Well-posedness has already been discovered once, and filed as a local detail.**
[RFC-003](RFC-003-natural-language-csp-extraction.md) §7.3 concluded that "solvability and
translation correctness are orthogonal," because "a faithful extraction of a genuinely
unsatisfiable or under-constrained prose should legitimately fail to solve uniquely." That is a
claim about the well-posedness of the *problem*, not about extraction — but it was resolved as an
extraction-validation question, so the concept it depends on was never named or reused.

**The catalog can now hold puzzles whose expected result is inexpressible.**
`catalog/puzzles/PZL-0015-extract-a-solvable-csp.md` was authored deliberately as a non-problem:
its entire body is the sentence "Extract a solvable CSP from this prose." There is nothing to
solve, and the correct behavior is a specific diagnosis — no scenario, therefore nothing to model
— rather than an answer. Nothing in the project can currently record that expectation:
`eval/answer-keys.json` entries hold `{title, answer, notes}`, which can only express "here is
the right answer," and `scripts/eval-extraction.ts` collapses every pre-solve failure into
`EXTRACT_FAILED`/`COMPILE_FAILED` while treating `SOLVE_UNSATISFIABLE` and
`SOLVE_MULTIPLY_SATISFIABLE` as unconditional failures. A puzzle that is *supposed* to have no
unique answer cannot pass.

This matters now because the catalog is about to grow deliberately into non-problems,
optimization problems, and subjective/ambiguous problems (root `TODO.md` item 1). Each is a
category the current vocabulary cannot name. Authoring them without a shared definition means
every puzzle's expected outcome is decided ad hoc, and — the real cost — a system failing for the
*right* reason becomes indistinguishable from a bug.

There is also a motivation beyond the catalog. Solving a determinate zebra puzzle is the easy
corner of computational decision making; the project's interest is the wider space. Being
explicit about where the boundaries are beats assuming them, and the boundary cases are not
tricks: an imperative sentence appearing where a question belongs (PZL-0015) is a thing
legitimate prose does.

## 3. Goals

- Define **well-posedness** for this project: conditions prose must satisfy to pose a solvable
  problem, structured so that a failure is attributable to a specific named condition rather than
  to a generic "extraction failed."
- Establish shared vocabulary for the **classes of problem** in scope — determinate, ambiguous
  natural language, subjective — and for **non-problems** as a first-class class rather than an
  error state.
- Make "no answer" **classifiable**: distinguish the absence of a demand, an open answer-space, an
  irrelevant query, absent constraints, judgment-dependent predicates, contradiction, and
  underdetermination, all of which read as the same failure today.
- Reconcile **satisfaction and optimization** as two solving regimes the project needs, rather
  than leaving optimization as an unacknowledged bolt-on.
- Give the catalog and the eval a common frame in which a puzzle's expected outcome is expressible
  for *every* class, including classes that correctly have no unique answer.
- Describe what RFC-001/002/003 already assumed and name where they conflict — this RFC is meant
  to make existing work explicit, not to invalidate it.

## 4. Non-Goals

- Designing the eval's outcome taxonomy, the answer-key format, or the catalog's frontmatter
  schema. This RFC defines what has to be expressible; a child ADR and the eval-hardening
  workstream (root `TODO.md` item 2) decide how.
- Selecting or changing the solver. [RFC-002](RFC-002-constraint-solver-selection.md) stands; this
  RFC only observes that its scope was satisfaction-only.
- Redesigning extraction. [RFC-003](RFC-003-natural-language-csp-extraction.md) stands; this RFC
  supplies vocabulary its §7.3 needed and lacked.
- Deciding how the system should *behave* on an ill-posed problem (refuse, report the failing
  condition, offer a partial model, ask for clarification). Classification here; behavior in an ADR.
- A general theory of decision making, formal epistemology, or question semantics. Scope is
  bounded by what the catalog, extraction, and eval need in order to classify their own material.
- Adversarial-input or prompt-injection defense as a security concern. The instruction-vs-data
  boundary appears below (§5.4) as a well-posedness condition, not as threat modeling.
- Difficulty calibration and tiering. Well-posedness is orthogonal to difficulty: a puzzle can
  clear every condition and still be trivial, or fail the first one and look hard.

## 5. Proposed Approach (high-level)

### 5.1 A well-posedness ladder

Six conditions, each of which prose must satisfy for "the solution" to have a referent. They are
ordered so that a failure can be attributed to the lowest condition that fails.

| # | Condition | Requires | Characteristic failure |
|---|---|---|---|
| 1 | **Demand** | An illocutionary act requesting resolution, *about entities in a scenario* | Descriptive prose with no question; or a demand about the modeling act rather than the scenario |
| 2 | **Determinate answer-space** | The demand ranges over identifiable candidates, and membership in that range is itself determinate | "Why did the bridge collapse?" — quantifies over an open class of explanations |
| 3 | **Relevance** | The demanded unknown is a projection of what the constraints act on | A solvable model that answers a different question than the one asked |
| 4 | **Constitutive constraints** | Propositions that eliminate candidates, categorical rather than defeasible | "Marta is often late" — narrows nothing definitively |
| 5 | **Determinate atoms** | Predicates evaluable without a valuer: lookup, arithmetic, structural check | "excessive relative to circumstances" in place of "exceeds 43%" |
| 6 | **Sufficiency** | The model's answer count matches the demand type declared at condition 1 | Seventeen constraints, one model (passes); a definite question with three models (fails) |

Two features of this structure are worth stating explicitly, because "ladder" is a useful mnemonic
that misdescribes the topology:

- **Conditions 1 and 6 are a matched pair, not opposite ends of a climb.** Sufficiency is not a
  property of the constraint set; it is a *match* between the demand's expected answer cardinality
  and the number of models. So condition 1 must record the demand's **type** — find-any, find-all,
  find-unique, find-best, or decide — and condition 6 checks the model against that declared type.
  A definite description ("who drinks water?") presupposes exactly one; "list every valid seating"
  tolerates many; an optimization demand wants a unique *optimum*, which is a different success
  condition than a unique feasible point. Read this way the structure is a bracket: 1 declares
  what shape of answer counts, 2–5 build the model, 6 checks the model answers in that shape.
- **Conditions 4 and 5 are orthogonal, not stacked.** They vary along different dimensions — modal
  force (categorical versus defeasible) and predicate determinacy (bright-line versus standard) —
  and all four combinations occur. "The guilty party is whoever had motive" is categorical and
  exception-free, so it clears 4 cleanly, yet "had motive" needs a valuer and fails 5. "The
  debt-to-income ratio is usually under 43%" is the opposite cell. See §7.1.

Condition 4 requires constraints to be non-*defeasible*, which is narrower than exception-free: "the
clinic is open daily except Sunday" is an exception and formalizes cleanly as a conditional. What
has to be excluded is probabilistic or defeasible force ("often," "tends to," "as a rule"), not
scope conditions. Condition 5's distinction is the one legal theory draws between **rules** and
**standards** — bright-line rules are evaluable, standards require a valuer — and that analogy is
borrowed deliberately, since it is the closest existing articulation of the boundary.

Condition 3 (relevance) is the only condition whose failure is silent. Every other failure is
loud: no question, no domain, no constraints, an unevaluable predicate, the wrong number of
answers. An irrelevant query produces a well-formed model, a confident answer, and the wrong
question answered. PZL-0014's recorded mismatch — a subset-selection answer (3 tokens) compared
against a full assignment (12) — looks like a mild instance of exactly this.

### 5.2 Satisfaction and optimization

The project needs two solving regimes, and has so far named only one.

- A **constraint satisfaction problem (CSP)** asks for assignments satisfying all constraints. Its
  answer count *is* its outcome: zero (unsatisfiable), one (uniquely solvable), or many. This is
  what `src/solver/` implements and what RFC-002 selected for.
- A **constraint optimization problem (COP)** adds an objective over the feasible set. Its
  outcomes are different in kind: infeasible, a unique optimum, tied optima, or an unbounded
  objective. Critically, "multiply satisfiable" is *unremarkable* for a COP — many feasible points
  with one best is the normal case, not a defect. A taxonomy that treats multiplicity as failure
  cannot describe a COP at all.

Soft constraints are the bridge between the two, and the reason this belongs in a foundational RFC
rather than a solver ADR. RFC-001's subjective/preference clues ("cats are terrified of dogs",
§2) are not constraints that eliminate candidates; they are preference terms that rank them.
The same prose can therefore be a CSP or a COP depending on whether its clues are read as hard or
soft — and that reading is a *modeling decision* which nothing in the current pipeline can
represent, because the extracted representation has no notion of an objective and `SolveResult`
has no optimization outcome.

This is not a solver-selection problem. MiniZinc supports optimization natively, so
[RFC-002](RFC-002-constraint-solver-selection.md)'s choice does not need revisiting; the gap is in
the representation, the outcome vocabulary, and the well-posedness conditions that reference them
(§5.1 condition 6).

### 5.3 Problem classification

Four classes. They are not degrees of difficulty — they are distinguished by *where the
indeterminacy sits*.

1. **Non-problems** — indeterminacy in the demand. One or more conditions in §5.1 fail, and the
   correct output is a diagnosis rather than a solution. Subtypes follow the failing condition, and
   two that look alike are worth separating: prose with no demand at all ("Hello, world") versus
   prose with a demand at the wrong level (PZL-0015's "Extract a solvable CSP from this prose" —
   an imperative that requests resolution, but of the modeling act rather than of a scenario). The
   second is the adversarial one, because a system that treats the last imperative sentence as the
   query will follow it.
2. **Determinate problems** — no indeterminacy. All six conditions hold; there is one correct
   answer and it is checkable. Corresponds to RFC-001 §5.1's strict/explicit tier, and is what the
   seed catalog nominally consists of.
3. **Ambiguous natural language** — indeterminacy in the *text*, not the model. The prose admits
   more than one faithful reading, each of which may be perfectly determinate once fixed.
   RFC-001 §2's example is exact: "to the right of" may mean immediately adjacent or merely
   somewhere to the right. This is categorically distinct from underdetermination (a
   condition-6 failure): there, one model has many solutions; here, the text has many models. The
   distinction matters because RFC-003's fidelity critic judges an extraction against the prose,
   which presupposes that a single faithful reading exists (§7.4).
4. **Subjective problems** — indeterminacy in the *values*. Either the predicates require a valuer
   (a condition-5 failure) or the demand is find-best over preferences with no privileged
   weighting. These are not ill-posed as *decisions* — people make them constantly — they are
   ill-posed as CSPs. Supplying a valuation makes them well-posed, which reframes the question
   from "how do we model this" to "who decides" (§7.5). Corresponds to RFC-001 §5.1's
   subjective/preference tier, and becomes a COP (§5.2) once weights are fixed.

For classes 3 and 4, correct behavior stops being "produce the answer" and becomes "produce the
right kind of non-answer." That is the capability the project currently has no way to specify or
score.

### 5.4 Cross-cutting concerns

- **Failure attribution.** A correct system fails at the right condition with the right diagnosis.
  Failing for the wrong reason is still a failure: PZL-0015 should report that there is no
  object-level demand, and should be judged *wrong* if it reports "no unique solution," because
  that misdiagnoses prose that never got past condition 1.
- **Silent promotion is the characteristic failure mode.** The danger with ill-posed input is not a
  crash but a system quietly making the problem well-posed — inventing a domain, hardening a
  defeasible clue into a constraint, choosing one reading of an ambiguous phrase, or supplying its
  own valuation for a judgment-laden predicate. Each produces a confident, schema-valid,
  plausible-looking answer. RFC-003 §9.4 already documented the empirical version of this: an
  identical extraction call returning a correct result once and a schema-valid-but-wrong result on
  a second run. Without condition-level attribution, promotion is invisible.
- **Prose is data, not instruction.** Condition 1's object-level requirement implies a standing
  boundary: puzzle text is material to be modeled, never a directive to execute. This is what
  makes PZL-0015 diagnosable rather than merely confusing, and it needs to hold even when a
  legitimate puzzle happens to contain an imperative (§7.7).
- **Expected outcomes must be recordable per class.** For determinate problems the expectation is
  an answer; for the other three it is a diagnosis, a set of readings, or an answer conditional on
  a valuation. The catalog and eval need to express all four (§7.3) — today they can express only
  the first.

## 6. Alternatives Considered

- **Leave it implicit** — continue deciding each puzzle's expected outcome case by case. This is
  the status quo and it worked while the catalog was uniformly determinate, which is precisely why
  the gap stayed invisible. Rejected because it has already produced concrete blockage (PZL-0015's
  expectation is unrecordable) and the ambiguity multiplies with every non-determinate puzzle
  added.
- **Fold this into RFC-003 (extraction)** — treat well-posedness as an extraction concern, since
  most condition failures surface during extraction. Rejected: condition 6 is a solver outcome,
  conditions 1–2 are properties of the prose independent of any extraction strategy, and the
  classification governs the catalog and eval as much as the extractor. Scoping it to extraction
  would reproduce the same implicit-assumption problem one layer down.
- **Fold this into the eval-hardening workstream** — define the outcome taxonomy directly and skip
  the conceptual layer. Rejected: a taxonomy derived from current failure modes would encode
  today's implementation accidents (`EXTRACT_FAILED` covers five distinct conditions because of how
  the pipeline is staged, not because they are one kind of thing). The taxonomy should follow from
  what can go wrong in principle.
- **Adopt an existing formalism wholesale.** Drawn on rather than adopted. Hadamard
  well-posedness concerns existence, uniqueness, and stability of solutions to an
  *already-posed* problem, and says nothing about whether prose poses one. The CSP/COP literature
  begins after the model exists. The rules-versus-standards distinction from legal theory fits
  condition 5 closely enough to borrow explicitly (§5.1). None of these covers the
  text → model → answer chain end to end, which is why this RFC defines its own vocabulary rather
  than citing one.
- **Declare subjective and ambiguous problems out of scope** — restrict the project to determinate
  CSPs, where the existing vocabulary is adequate. Rejected: RFC-001 §5.1 made clue strictness "a
  genuine axis of the problem" from the beginning and deliberately chose a foundation that
  "doesn't assume every clue is strict," so this would contradict an accepted direction rather
  than defer it.

## 7. Open Questions

7.1. Are conditions 4 and 5 genuinely orthogonal dimensions rather than sequential rungs, and if
so, should the model be presented as a ladder at all? The four-cell reading in §5.1 suggests a
2×2 (modal force × predicate determinacy) sitting inside an otherwise ordered sequence. A cleaner
formulation may exist.

7.2. Is relevance (condition 3) a distinct condition or a special case of sufficiency? A model
that does not bear on the demand arguably fails to pin down the *demanded* assignment. Keeping
them separate captures a real failure mode that sufficiency alone misses — a solvable model
answering the wrong question — but the boundary should be tested against real cases before it is
treated as settled.

7.3. What expected-outcome vocabulary should the catalog and eval share — one code per condition,
or a coarser grouping? Condition-level granularity is maximally diagnostic but risks baking this
RFC's exact taxonomy into a schema that must change if 7.1 or 7.2 resolve differently. Consumed
by the eval-hardening workstream (root `TODO.md` item 2).

7.4. For ambiguous-NL problems (§5.3 class 3), what is correct behavior — enumerate the readings,
commit to one and record the interpretation, or refuse? This interacts directly with
[RFC-003](RFC-003-natural-language-csp-extraction.md) §5.3's fidelity check, which judges an
extraction against the source prose and therefore presupposes one faithful reading exists.

7.5. Do subjective problems become well-posed by supplying a valuation, and if so where does the
valuation come from — a preference ordering stated in the puzzle text, a system default, or the
user at solve time? This determines whether the subjective tier is a class the project can
actually solve (as a COP) or only classify.

7.6. Should the 14 seed puzzles be re-audited against §5.1? PZL-0011's threshold cascade (already
flagged in [RFC-003](RFC-003-natural-language-csp-extraction.md) §7.6) and PZL-0013's restaurant
selection are candidates for sitting at the condition-5 boundary rather than cleanly above it. If
so, the nominally determinate dev set already contains the indeterminacy the catalog work was
planning to add — which would change what the current 9/14 eval pass rate actually measures.

7.7. Does the prose-is-data boundary (§5.4) need to hold as a hard pipeline invariant, or is it
sufficient to classify PZL-0015-style input correctly when it appears? Related to but distinct
from the adversarial-input handling §4 excludes.

7.8. Where does answer *shape* belong — in the extracted representation, the catalog frontmatter,
the answer key, or all three? Condition 1's demand type (find-any/all/unique/best/decide) has to
be recorded somewhere for condition 6 to be checkable, and PZL-0014's subset-versus-assignment
mismatch suggests answer shape is currently an unowned concern.

7.9. Does this RFC's classification imply that `SolveResult`'s satisfaction-only taxonomy
(§5.2) should be extended, or that optimization belongs behind a separate solving entry point
altogether? Either way it is an ADR decision under
[RFC-002](RFC-002-constraint-solver-selection.md) or this RFC, not a change this RFC makes.

## 8. ADRs

_(populated automatically as `/adr-create` links ADRs to this RFC)_

## 9. Appendix: Vocabulary Reconciliation

Where the three existing RFCs' implicit vocabularies align with §5.3's classes, and what each one
currently cannot express. This is the concrete form of the claim in §1 that the vocabulary was
assumed but never defined.

| §5.3 class | RFC-001 §5.1 clue tier | Regime (§5.2) | `SolveResult` outcome | Eval outcome today | Gap |
|---|---|---|---|---|---|
| Non-problem | — (no tier; not anticipated) | neither | none reachable | `EXTRACT_FAILED` / `COMPILE_FAILED` (always a failure) | No expected-outcome representation at all; correct diagnosis and wrong diagnosis are indistinguishable |
| Determinate | strict/explicit | CSP | `UniquelySolvable` | `MATCH` / `MISMATCH` | Answer shape unowned (§7.8); parallel-array puzzles verify vocabulary only, not pairing |
| Ambiguous NL | vague/contextual | CSP per reading | one reading's result, silently | whichever reading was extracted | No way to represent multiple readings; fidelity critic presupposes one (§7.4) |
| Subjective | subjective/preference | COP | no optimization outcome exists | `SOLVE_MULTIPLY_SATISFIABLE` (always a failure) | Neither an objective in the representation nor an optimum in the outcome taxonomy |

The pattern across the rows: RFC-001 anticipated three of the four classes as a *generation* axis
and chose a foundation intended not to foreclose them; RFC-002 then scoped the solving contract to
the first class only; RFC-003 built extraction against that contract and hit the resulting edge in
its own §7.3 without a vocabulary to name it. No decision in that sequence was wrong on its own
terms — the omission is that nothing recorded the narrowing.
