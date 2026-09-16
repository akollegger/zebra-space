---
id: SPIKE-014
title: Informal Reasoning, Then Formalize the Whole CSP
status: planned
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

## 2. Method

1. **Stage 1 (free solve)** — identical to `direct-solve` (ADR-008): puzzle prose, no schema, no
   forced tool call, "show your reasoning, then state the final answer clearly." Reuse the
   already-collected traces (`eval/results/2026-09-15T14-59-37-368Z.json` for `gpt-4o-mini`,
   `...15T15-02-32-354Z.json` for `claude-sonnet-4.5`) for the first pass at zero re-solve cost,
   the same bootstrap SPIKE-013's `post-hoc`/`post-hoc-shaped` used.
2. **Stage 2 (formalize)** — a new forced-tool-call step, reusing SPIKE-012's per-clue tool-call
   conventions and `src/extraction/types.ts`'s `ExtractedCsp` shape (entities, domains,
   constraints), given the puzzle prose *and* the Stage-1 trace, asked to formalize the CSP that
   solve already worked out — a transcription task analogous to `post-hoc-vocabulary.ts`, but
   covering constraints too, not just entities/domains. Whether this is one call or decomposed
   (e.g. vocabulary formalized first, then constraints per-clue against the now-known solution)
   is an open implementation question this spike resolves empirically, not a decision made here.
3. **Verify** — run the resulting `ExtractedCsp` through the existing, unmodified
   `compile()`/`solve()` pipeline (`src/compiler/compile.ts`, `src/solver/solve.ts`) and grade
   with the existing outcome taxonomy (ADR-007), the same grading every prior extraction
   architecture in this line has been measured against — no new scoring code, so this compares
   directly against `full-critic`'s and the per-clue variants' already-recorded numbers.
4. **Compare** MATCH rate, cost, and failure modes against: `full-critic` (2/14, ~$2.10),
   the per-clue/graph-pipeline variants (0/14, $0.03-$0.12), and `direct-solve`'s own free-prose
   judge-graded rate (9/14 / 13/14) as the ceiling this architecture is trying to approach without
   losing the independent-verification property `direct-solve` itself lacks (its judge grades
   prose directly; it has no compilable artifact at all).
5. **Diagnose failures concretely** — per this session's own failure-mode analysis (silent
   abandonment of rigor, faithfully-propagated misinterpretation, silent premise promotion) and
   SPIKE-013's finding that closed classification can regress when fed noisier input: inspect
   actual COMPILE_FAILED/solve-mismatch cases, not just the aggregate rate, the same discipline
   every prior spike in this line has followed.

## 3. Time-box

**One day (~8 hours)**: ~1h reuse/adapt Stage 1 (already-collected traces, zero new code beyond
a loader); ~2-3h build Stage 2's formalization call(s) and get the `ExtractedCsp` shape right
against `compile()`'s existing expectations; ~1h offline smoke tests (a hand-constructed
already-known-good trace should compile and solve correctly, zero cost); ~1h live dry-run on 2-3
puzzles + fixes; ~2h full sweep (n=3 x 14 puzzles x 1-2 tiers, cost-estimated before running,
matching this session's own cost-then-go-ahead discipline) and write-up. Hard stop at the
time-box regardless of completeness — if Stage 2's formalization call needs materially more
prompt-engineering than this budget allows, that itself is a finding worth recording, not a
reason to blow through the box.

## 4. Notes

## 5. Findings

## 6. Conclusion
