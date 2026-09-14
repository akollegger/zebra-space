---
id: SPIKE-009
title: Graph-Style Reconciled Extraction (Local Extract, Neighborhood Reconcile, Filter)
status: planned
rfcs: [RFC-003]
created: 2026-09-15
---

# SPIKE-009: Graph-Style Reconciled Extraction (Local Extract, Neighborhood Reconcile, Filter)

## 1. Question

[SPIKE-008](../SPIKE-008-per-clue-tool-call-decomposition/SPIKE.md) built and measured a
per-clue extraction pipeline shaped as: **one global vocabulary call over the whole prose**,
then **per-clue constraint calls that trust that vocabulary unconditionally**, then naive
concatenation. Its billed run found this shape less reliable than today's monolithic
`full-critic` (4/14 vs 13/14 puzzles reaching any gradable state at all), and traced the
dominant cause to a concrete bug: `entity` enums in the generated per-clue tool schemas are
scoped globally rather than per-domain, so a model can validly reference one domain's entity id
while indexing a different domain's array (e.g. `house_animal[animal_cat]` when `animal_cat`
was never declared as a member of the `house`-typed domain).

SPIKE-008's own Conclusion proposed a narrow fix (scope each field's entity enum to its
domain's `entityType`) and recommended re-running to see if that closes the gap. This spike
asks a different, broader question surfaced in review of that fix: **is a global,
one-shot vocabulary decision the right architecture at all**, or does the failure class
SPIKE-008 found call for a structurally different pipeline shape — one where vocabulary itself
is built the same way constraints are (locally, per clue), then explicitly **reconciled** across
clues (merging/typing candidate entities and domains against each other) before any constraint
is trusted, with a final **filtering** pass dropping constraints whose referenced entities/
domains didn't survive reconciliation?

This is the shape a knowledge-graph construction pipeline already uses for the same underlying
problem (per-sentence candidate entities/relations must be resolved against each other before
the graph is coherent — is "house 1" in clue 5 the same node "the red house" in clue 3 refers
to? does "color" mentioned in three different clues denote one domain or accidentally two?).
Concretely:

1. Does per-clue **local** vocabulary extraction (candidate entities/domains proposed clue-by-
   clue, not decided in one global call before any clue is examined) produce evidence that
   actually needs reconciling — i.e. do different clues propose genuinely conflicting or
   redundant candidates on the same puzzles SPIKE-008 tested, or does global vocabulary
   extraction already get this right often enough that local-then-reconcile is solving a problem
   that mostly doesn't occur in practice?
2. Does an explicit reconciliation pass (merge candidate entities, canonicalize domain names,
   resolve entity-type membership) structurally prevent the entity-scoping failure class SPIKE-
   008 found, in a way that generalizes better than narrowly scoping enums post-hoc — e.g. does
   it also catch cases the enum-scoping fix wouldn't (a domain split into two by different
   clues using different names for the same attribute; an entity mentioned under two different
   surface forms)?
3. Does a filtering pass (drop constraints referencing anything that didn't survive
   reconciliation) meaningfully change outcomes on puzzles where a clue turned out to be pure
   scenario setup rather than a real constraint, or where two clues produced redundant/
   contradictory constraints?
4. Net cost/complexity: how many additional LLM calls (or is reconciliation purely deterministic
   code, no LLM needed?) does this add relative to SPIKE-008's per-clue design, and does it
   still beat `full-critic`'s cost by a wide enough margin to be worth the added architecture?

## 2. Method

Not yet designed in detail — this is a stub opened per the user's explicit request to track the
idea while SPIKE-008's narrower entity-scoping fix is tried first (see SPIKE-008 §6 Conclusion's
recommended next step, which this spike is a follow-up to, not a replacement for). When picked
up, the method should build on SPIKE-008's existing scripts
(`design/spikes/SPIKE-008-per-clue-tool-call-decomposition/scripts/`) rather than starting over
— `lib/puzzles.ts`'s clue-splitting, `lib/tool-call.ts`'s forced-tool-call wrapper, and
`lib/grade.ts`'s answer-key grading dispatch are all reusable as-is. The new work is: (a) a
per-clue *vocabulary* proposal call (parallel in shape to the existing per-clue *constraint*
call), (b) a reconciliation step — likely deterministic code for straightforward cases (exact
string match merging) plus an LLM call only where local candidates conflict or look like
plausible duplicates, and (c) a filtering step applied after reconciliation, before assembly.
Compare against SPIKE-008's own per-clue results (already measured) on the same 14-puzzle
sample, not just against `full-critic`, so the comparison isolates what reconciliation adds.

## 3. Time-box

Not yet set — to be scoped when this spike is actually picked up, after SPIKE-008's narrower
entity-scoping fix has been tried and re-measured (its result may change how much appetite there
is for this larger architecture change).

## 5. Findings

_(filled in once the spike concludes)_

## 6. Conclusion

_(filled in once the spike concludes)_
