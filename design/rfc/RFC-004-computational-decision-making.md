---
id: RFC-004
title: Computational Decision Making
status: draft
created: 2026-08-21
adrs: []
---

# RFC-004: Computational Decision Making

## 1. Summary

This project is named for a space it has never mapped. Zebra Space's stated purpose spans
generating prose puzzles, modeling them as constraint problems, representing them as graphs, and
solving them — but nothing on record says what kind of thing is being generated, modeled, or
solved, nor where that space ends. Each existing RFC defined its own slice
([RFC-001](RFC-001-parameterizable-puzzle-generation.md) generation,
[RFC-002](RFC-002-constraint-solver-selection.md) solving,
[RFC-003](RFC-003-natural-language-csp-extraction.md) extraction) while assuming a well-posed
problem as its input. This RFC defines the space itself: what makes prose a solvable problem at
all, which classes of problem are in scope, and what a correct *non*-answer is. Its organizing
claim is that a problem with exactly one valid solution is the degenerate corner of that space
rather than its center — which is why the space is named for decision making rather than problem
solving (§6), and why the project's direction runs from zebra puzzles outward toward decision
support — as the callable tool such a system is built on, not as the system itself (§5.5).

## 2. Problem / Motivation

The project has worked from reasonable assumptions, well-known definitions, and a reference
solver — none of them written down. That was economical rather than careless: while every puzzle
in view was a determinate constraint problem with exactly one answer, an implicit vocabulary was
sufficient because nothing tested it. But the four verbs in the project's mission — generate,
model, represent, solve — all quietly presuppose the same three unstated things: that the input
poses a problem, that the problem has an answer, and that the answer is unique. None of those is
true across the space this project actually intends to work in.

The omission is now load-bearing, and it shows up from several independent directions rather than
at any single point:

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

**An expected non-answer is currently inexpressible.** `eval/answer-keys.json` entries hold
`{title, answer, notes}`, which can only say "here is the right answer," and
`scripts/eval-extraction.ts` collapses every pre-solve failure into
`EXTRACT_FAILED`/`COMPILE_FAILED` while treating `SOLVE_UNSATISFIABLE` and
`SOLVE_MULTIPLY_SATISFIABLE` as unconditional failures. So for any problem whose correct result is
*not* a unique assignment — a contradiction, a question with no determinate answer-space, a
preference with no privileged weighting — the project can neither state the expectation nor score
it as met. Correct behavior and a bug are indistinguishable.

Every active workstream runs into this from its own angle. Growing the catalog (root `TODO.md`
item 1) means authoring non-problems, optimization problems, and subjective/ambiguous problems —
categories the current vocabulary cannot name, so each one's expected outcome gets decided ad hoc.
Hardening the eval (item 2) requires deciding whether multiple solutions constitute a pass, which
is unanswerable without first knowing what class of problem is being scored. Closing
expressiveness gaps (item 3) requires distinguishing a genuinely missing constraint-language
feature from prose that was never a constraint problem in the first place. Any one of these would
have surfaced the gap; that they all do is the argument for defining the space once, centrally,
rather than three times in passing.

Underneath the immediate blockages is a framing point the project's own name already commits to. A
problem with exactly one valid solution is the **degenerate** case, not the paradigm case: the
constraints have removed every choice, so nothing remains to decide and the only work left is
computation. The determinate zebra puzzle is the easy corner of this space, and it is the only
corner currently described.

Every direction out of that corner *widens* the set of valid answers rather than narrowing it.
Optimization admits many feasible points and asks which is best. Ambiguous language admits several
faithful readings of the same text. Common sense and subjective judgment admit answers that depend
on who is judging. And moving the constraints, variables, or domains changes what is possible at
all. Once more than one answer is admissible, the useful output stops being "the solution" and
becomes the trade-offs among candidates, the nuance in how each was reached, and the risk of
acting on any of them — which is a decision-making framework rather than a solving one. The
trajectory this RFC serves runs from the determinate corner outward toward decision support, and
naming the space accordingly is deliberate rather than stylistic (§6).

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
- Establish the **unique solution as the degenerate case** rather than the target, so that
  optimization, ambiguity, and subjectivity register as the space opening up — the direction the
  project is heading — instead of as defects to be engineered away.
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
  boundary appears below (§5.6) as a well-posedness condition, not as threat modeling.
- Difficulty calibration and tiering. Well-posedness is orthogonal to difficulty: a puzzle can
  clear every condition and still be trivial, or fail the first one and look hard.
- Building the decision support system. §5.5 fixes the boundary: this project produces a callable
  tool such a system can be built on. Resolving conflicts, retrieving missing context, eliciting
  preferences, and holding any interactive dialogue with a human all sit on the far side of that
  line. Designing the tool's *own* diagnostic capabilities (sensitivity analysis, counterfactual
  queries, explanation) is legitimate future territory but is not designed here either — §5.4 only
  argues the vocabulary must leave room for them.

## 5. Proposed Approach (high-level)

### 5.1 A well-posedness ladder

Six conditions, each of which prose must satisfy for its demand to have a determinate referent.
They are ordered so that a failure can be attributed to the lowest condition that fails.

The ladder maps where a framing sits; it is not a quality ranking, and clearing every condition is
not the objective (§5.4). A well-posed problem may admit many valid answers, because condition 6
checks the answer count against what was actually *asked* — not against one.

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
   prose with a demand at the wrong *level* — an imperative like "extract a solvable CSP from this
   prose," which does request resolution, but of the modeling act rather than of any scenario. The
   second is the adversarial one, because a system that treats the last imperative sentence as the
   query will simply follow it.
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

### 5.4 From answers to decisions

The classification in §5.3 has a consequence for what the pipeline is ultimately *for*. In the
determinate class the deliverable is an assignment and the modeling is the whole job. In the other
three the admissible set is larger than one, and an assignment by itself withholds most of what a
decision actually needs:

- **Trade-offs.** With several admissible answers, the useful output is how they differ and along
  which dimensions — not one of them presented as though the others did not exist. For an
  optimization problem that means the shape of the frontier, not only the argmax.
- **Levers.** Constraints, variables, and domains are inputs the asker may control, not immutable
  facts. Which constraint is binding, how much slack the others carry, and what minimal change
  would make a different answer win are all questions about the *model* rather than about any one
  assignment, and none of them is answerable from a single assignment.
- **Provenance.** Where a reading was chosen (class 3) or a valuation supplied (class 4), the
  answer holds only conditional on that choice. Reporting the answer without its condition is
  false precision, and the condition is frequently the most decision-relevant part of the result.
- **Risk.** An answer resting on judgment-laden predicates or a contested reading carries
  uncertainty that a bare assignment cannot express. Confidence belongs in the answer, not in a
  footnote about it.

This is not an argument for building those capabilities now — §4 explicitly excludes that. It is an
argument that the vocabulary established here must leave room for them, so that "solve" does not
get fixed as the only verb the pipeline knows. A representation whose sole output shape is one
assignment forecloses all four bullets above at the representation layer, which is the most
expensive place to undo such a choice later. The four are also why these must be *exposed* rather
than consumed: under §5.5's boundary the caller is the decision maker, so anything resolved
internally and then discarded is information the actual decision never gets to see.

### 5.5 System boundary: a closed-world tool in an open world

This project produces a *tool that facilitates* decision support; it does not implement a decision
support system. Drawing that line settles several things that would otherwise drift.

**Closed world inside, open world assumed outside.** Everything the tool reasons over is exactly
what it was handed: the entities, domains, and constraints recoverable from the prose in front of
it, and nothing more. Within that boundary the closed-world assumption holds, and condition 2's
determinate answer-space (§5.1) is precisely the requirement that the world be closed enough to
enumerate. But the tool must assume it is being *called* from an open world in which the caller
knows things it cannot: further constraints, current data, the authority to relax a requirement,
which stakeholder's preference prevails. So the tool may never treat its own closed world as
complete evidence about the caller's.

**Report, do not resolve.** This is the operative consequence. Handed an unsatisfiable problem,
the tool can and should say what is in conflict; handed an underdetermined one, what is missing
that would pin it down. Both are diagnostics computed entirely within the closed world. Actually
resolving the conflict — deciding which constraint yields — or retrieving the absent context is
the calling system's work, because both require exactly the open-world knowledge the tool does not
have. The same line runs through §5.4's four bullets: surface trade-offs, levers, provenance, and
risk because the caller decides; do not decide among them.

**A callable tool, not a conversation.** The interface is a command invoked with input that returns
output — not a chat, not a copilot, not an interactive agent that asks follow-up questions to fill
its own gaps. Gaps are reported, not negotiated. Internally the tool may be as agentic as the work
requires — [ADR-004](../adr/ADR-004-llm-extraction-critic-loop.md)'s extraction-and-critic loop
already is — and that stays invisible from outside; what is fixed is the shape at the boundary.
[ADR-003](../adr/ADR-003-cli-interface.md) already chose that shape in practice (subcommands,
output pipeable between them, `--json` for machine consumers, explicit flags for "reproducible,
non-interactive/scripted use") without ever stating it as a stance. This subsection states it, and
the constitution's Principle VI (v1.3.0) makes it binding on every future capability rather than
advisory to this RFC alone.

### 5.6 Cross-cutting concerns

- **Failure attribution.** A correct system fails at the right condition with the right diagnosis.
  Failing for the wrong reason is still a failure: prose carrying no object-level demand should be
  reported as such, and judged *wrong* if it is reported as "no unique solution" instead — that
  misdiagnoses input which never got past condition 1 as though it had reached condition 6.
- **Silent promotion is the characteristic failure mode.** The danger with ill-posed input is not a
  crash but a system quietly making the problem well-posed — inventing a domain, hardening a
  defeasible clue into a constraint, choosing one reading of an ambiguous phrase, or supplying its
  own valuation for a judgment-laden predicate. Each produces a confident, schema-valid,
  plausible-looking answer. RFC-003 §9.4 already documented the empirical version of this: an
  identical extraction call returning a correct result once and a schema-valid-but-wrong result on
  a second run. Without condition-level attribution, promotion is invisible.
- **Prose is data, not instruction.** Condition 1's object-level requirement implies a standing
  boundary: puzzle text is material to be modeled, never a directive to execute. This is what makes
  a misdirected imperative diagnosable rather than merely confusing, and it needs to hold even when
  a legitimate puzzle contains an imperative in place of a question (§7.7).
- **Expected outcomes must be recordable per class.** For determinate problems the expectation is
  an answer; for the other three it is a diagnosis, a set of readings, or an answer conditional on
  a valuation. The catalog and eval need to express all four (§7.3) — today they can express only
  the first.

## 6. Alternatives Considered

- **Frame the space as computational *problem solving*.** The obvious alternative title, and
  rejected deliberately rather than by preference. "Problem solving" presupposes that a solution
  exists and is unique enough to be called *the* solution — which is precisely the assumption §2
  identifies as this project's blind spot, so adopting it would encode the degenerate case directly
  into the project's vocabulary and make the wider space the exception rather than the rule.
  "Decision making" puts the emphasis where the space actually leads: trade-offs among admissible
  answers, the nuance in how each was reached, and the risk of acting on any of them (§5.4). The
  determinate corner stays fully in scope — as the easy case, not as the definition.
- **Leave it implicit** — continue deciding each problem's expected outcome case by case. This is
  the status quo, and it worked precisely because everything in view was determinate, which is why
  the gap stayed invisible. Rejected because the vocabulary is already contradicting itself between
  RFCs (§2) and the ambiguity compounds with every non-determinate problem the project takes on.
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

7.7. Does the prose-is-data boundary (§5.6) need to hold as a hard pipeline invariant, or is it
sufficient to classify a misdirected imperative correctly when one appears? Related to but
distinct from the adversarial-input handling §4 excludes.

7.8. Where does answer *shape* belong — in the extracted representation, the catalog frontmatter,
the answer key, or all three? Condition 1's demand type (find-any/all/unique/best/decide) has to
be recorded somewhere for condition 6 to be checkable, and PZL-0014's subset-versus-assignment
mismatch suggests answer shape is currently an unowned concern.

7.9. Does this RFC's classification imply that `SolveResult`'s satisfaction-only taxonomy
(§5.2) should be extended, or that optimization belongs behind a separate solving entry point
altogether? Either way it is an ADR decision under
[RFC-002](RFC-002-constraint-solver-selection.md) or this RFC, not a change this RFC makes.

7.10. Does the project need first-class support for the model-as-lever questions in §5.4 — which
constraint is binding, how much slack the others carry, what minimal change flips the answer? A
solver can answer several of these; nothing in the current representation or CLI asks. Whether
this is a solving-layer concern, a representation concern, or both is unresolved.

7.11. Should an answer carry its own provenance and confidence in band — the reading chosen, the
valuation supplied, the threshold applied — rather than alongside it? §5.4 argues the condition is
often the most decision-relevant part of the result, which points toward in-band; the current
pipeline has nowhere to put it either way.

7.12. How far along the trajectory from determinate puzzle to decision support is *this* project
meant to travel, versus a successor that consumes its output? **Resolved: this project builds the
tool, not the system.** It produces a callable capability a decision support system can be built
on, and stops at the boundary §5.5 draws — closed world inside, open world assumed outside, report
conflicts and gaps but resolve neither. That settles the generality question the rest of this
item raised: the representation needs enough expressiveness to *state* trade-offs, levers,
provenance, and risk (§5.4), and no machinery whatsoever for negotiating them.

7.13. What concretely belongs in the diagnostic payload §5.5 commits to? For an unsatisfiable
problem the natural candidate is a minimal conflicting subset of constraints; for an
underdetermined one, which additional facts would most reduce the model count. Both are computable
in principle, neither is specified, and "be informative about what's missing" is not yet a
testable requirement.

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
