---
id: SPIKE-014
title: Informal Reasoning, Then Formalize the Whole CSP
status: in-progress
rfcs: [RFC-003]
created: 2026-09-16
---

# SPIKE-014: Informal Reasoning, Then Formalize the Whole CSP

## 1. Question

RFC-003 §7.3 resolved that solvability and translation-fidelity are orthogonal, and settled on a
fidelity critic (ADR-004) rather than a solve-round-trip gate — but that resolution predates any
evidence about *decoupling* informal solving from formal emission entirely. SPIKE-013 (§5.7/§5.8)
found, for vocabulary construction specifically: having a model solve a puzzle freely in prose
first (no schema, ADR-008's `direct-solve`), then transcribe the vocabulary that solve already
used, beats every blind vocabulary-construction variant by roughly an order of magnitude (33% vs.
0-4% structurally correct) and survives a solve that later goes wrong (PZL-0001) — while a
naive-seeming refinement (feed that same solved trace into the existing closed-classification
pipeline) regressed almost back to baseline (SPIKE-013 §5.8), showing the win isn't free or
guaranteed to generalize by construction alone.

This spike asks the question SPIKE-013 explicitly deferred rather than answered: **does
decoupling informal reasoning from formal emission generalize from vocabulary alone to the
*whole* `ExtractedCsp` — entities, domains, AND constraints — measured the way this project
actually measures success (SOLVE_UNIQUE/MATCH via compile→solve, ADR-007's taxonomy), not just
vocabulary-shape scoring?**

Concretely: solve the puzzle freely in prose first (reusing `direct-solve`'s exact prompt/traces
where already collected, at zero re-solve cost), then have a separate call formalize that
completed solve into a full `ExtractedCsp` — constraints included, not just entities/domains —
and run the EXISTING `compile()`/`solve()` pipeline against it as a real correctness filter. This
is the load-bearing mechanism this session's own OpenAI Navier-Stokes discussion identified
(verification-as-filter over already-produced informal reasoning, not a one-shot translate), and
it's a genuine methodological upgrade over SPIKE-013: that spike could only score vocabulary
*structure*; this one produces an artifact that can actually be solved, giving a real
SOLVE_UNIQUE/MATCH signal instead of a proxy.

Direct-solve's own already-measured numbers are the reference point this has to clear to be
worth adopting: `gpt-4o-mini` 9/14 (64%) and `claude-sonnet-4.5` 13/14 (93%) MATCH in free prose
— against `full-critic`'s 2/14 (14%) and every per-clue/graph-pipeline variant's 0/14 using a
schema-constrained architecture. If formalization can preserve most of the free-prose solve rate
while producing a genuinely verifiable artifact, that's the strongest evidence yet for this
project's next architectural direction; if it collapses back toward the schema-constrained
numbers (as SPIKE-013's `post-hoc-shaped` did for vocabulary alone), that's an equally important,
concretely diagnosable negative result.

**A second, genuinely open sub-question (raised 2026-09-16, before any code was written)**: what
should Stage 2 formalize INTO? RFC-003 §7.1 has asked since this RFC's own origin whether the
intermediate representation needs to be "close enough to a MiniZinc AST to serialize directly" —
never actually measured, only asserted either way. `src/solver/solve.ts`'s `SolveRequest.model` is
a raw MiniZinc string with no dependency on `compile.ts`/`ExtractedCsp`, and `src/eval/grader.ts`'s
`gradeDeterminate` grades off the solved assignment record, equally representation-agnostic — so
a direct-to-MiniZinc path is a fully independent, equally-verifiable alternative to
`ExtractedCsp`, not a shortcut that skips verification. This spike tests BOTH as parallel
variants (`formalize-json` via the existing `compile()`→`solve()`, `formalize-mzn` straight into
`solve()`, same grader either way) rather than asserting an answer — the marginal build cost is
one more Stage-2 prompt, not a second pipeline.

## 2. Method

1. **Stage 1 (free solve)** — identical to `direct-solve` (ADR-008): puzzle prose, no schema, no
   forced tool call, "show your reasoning, then state the final answer clearly." Reuse the
   already-collected traces (`eval/results/2026-09-15T14-59-37-368Z.json` for `gpt-4o-mini`,
   `...15T15-02-32-354Z.json` for `claude-sonnet-4.5`) for the first pass at zero re-solve cost,
   the same bootstrap SPIKE-013's `post-hoc`/`post-hoc-shaped` used.
2. **Stage 2 (formalize) — two representation variants, each single-call for the first pass**:
   - **`formalize-json`**: a forced tool-call reusing SPIKE-012's per-clue tool-call conventions
     and `src/extraction/types.ts`'s `ExtractedCsp` shape (entities, domains, constraints), given
     the puzzle prose *and* the Stage-1 trace — a transcription task analogous to
     `post-hoc-vocabulary.ts`, extended to cover constraints too, not just entities/domains.
   - **`formalize-mzn`**: a prose completion (like `direct-solve`'s own `requestProseCompletion`,
     since MiniZinc is plain text, not JSON) asked to write the complete MiniZinc model the
     already-solved reasoning implies, given the same puzzle prose + Stage-1 trace.
   - **Single call for both, not decomposed, for this first pass**: SPIKE-013's
     `post-hoc-shaped` (§5.8) already tested "decompose, with the solved trace as context" for
     vocabulary alone and it regressed almost back to blind-guess numbers — direct evidence
     against decomposing by default here. Revisit only if single-call shows a specific,
     diagnosable failure decomposition would plausibly fix (e.g. long puzzles losing attention,
     late clues silently dropped) — and note the asymmetry if so: decomposition is a natural fit
     for `formalize-json` (its schema already separates vocabulary from a constraints list), but
     awkward for `formalize-mzn` (one coherent program, shared identifier scope) — an iterative
     "append this clue's constraint" loop, or a hybrid (fixed vocabulary once, then one call per
     clue emitting a raw MiniZinc constraint expression assembled by code) would be needed there.
3. **Verify** — `formalize-json` runs through the existing, unmodified `compile()`/`solve()`
   pipeline (`src/compiler/compile.ts`, `src/solver/solve.ts`); `formalize-mzn` skips `compile()`
   entirely and goes straight into `solve()` (`SolveRequest.model` is a raw MiniZinc string with
   no dependency on `ExtractedCsp`). Both grade with the SAME existing outcome taxonomy (ADR-007)
   and `src/eval/grader.ts` (which grades off the solved assignment record, equally
   representation-agnostic) — no new scoring code for either variant, so both compare directly
   against `full-critic`'s and the per-clue variants' already-recorded numbers.
4. **Compare** MATCH rate, cost, and failure modes against: `full-critic` (2/14, ~$2.10),
   the per-clue/graph-pipeline variants (0/14, $0.03-$0.12), and `direct-solve`'s own free-prose
   judge-graded rate (9/14 / 13/14) as the ceiling this architecture is trying to approach without
   losing the independent-verification property `direct-solve` itself lacks (its judge grades
   prose directly; it has no compilable artifact at all). Also compare `formalize-json` against
   `formalize-mzn` directly — this is this spike's own answer to RFC-003 §7.1, evidence instead
   of assertion.
5. **Diagnose failures concretely** — per this session's own failure-mode analysis (silent
   abandonment of rigor, faithfully-propagated misinterpretation, silent premise promotion) and
   SPIKE-013's finding that closed classification can regress when fed noisier input: inspect
   actual COMPILE_FAILED/solve-mismatch cases, not just the aggregate rate, the same discipline
   every prior spike in this line has followed.

## 3. Time-box

**One and a half days (~12 hours)**, given two Stage-2 variants instead of one: ~1h reuse/adapt
Stage 1 (already-collected traces, zero new code beyond a loader); ~2h `formalize-json` (closest
to already-proven `post-hoc-vocabulary.ts` machinery, extended to constraints); ~2h
`formalize-mzn` (a new prose-completion path, no forced-schema precedent to build from, though
`direct-solve`'s `requestProseCompletion` is a direct template); ~1.5h offline smoke tests for
both (a hand-constructed already-known-good trace should compile-or-parse and solve correctly
for each variant, zero cost); ~1.5h live dry-run on 2-3 puzzles per variant + fixes; ~3h full
sweep (n=3 x 14 puzzles x 2 variants x 1-2 tiers, cost-estimated before running, matching this
session's own cost-then-go-ahead discipline) and write-up. Hard stop at the time-box regardless
of completeness — if either variant needs materially more prompt-engineering than this budget
allows, that itself is a finding worth recording, not a reason to blow through the box.

## 4. Notes

**2026-09-16 — worth reviving once a gram representation is defined.** RFC-003 §5.1/§7.1 and
`CLAUDE.md`'s own architecture pointer (`@relateby/pattern`'s gram graphs, via `Gram.parse`/
`Gram.stringify`/`StandardGraph.fromPatterns`) both anticipate a THIRD representation this spike
doesn't test: puzzles as graphs, not just `ExtractedCsp` JSON or MiniZinc text. No gram schema
exists yet for this domain (entities/domains/constraints as a graph shape hasn't been designed),
so it's out of scope now — but once it is, this spike's exact method (solve first in free prose,
formalize the completed solve into a candidate representation, verify via a representation-
appropriate check) is a good way to evaluate that representation's coherence, expressiveness, and
equivalence to the other two: does a solved trace formalize into a gram pattern at least as
reliably as into `ExtractedCsp`/MiniZinc, and does the resulting graph express everything the
other two representations do (RFC-003 §7.1's own "or does it need to be independent... to also
serve the future graph representation" question, finally measurable rather than asserted)? Cite
this note back into RFC-003 §7.1 (or wherever the future gram-representation ADR lands) when that
representation exists, per this skill's own manual-citation convention.

## 5. Findings

## 6. Conclusion
