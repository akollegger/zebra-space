---
id: SPIKE-009
title: Graph-Style Reconciled Extraction (Local Extract, Neighborhood Reconcile, Filter)
status: in-progress
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

SPIKE-008's narrower entity-scoping fix has since landed and been measured (gradable-state rate
4/14 → 8/14 puzzles) — this spike now proceeds against the two named failure classes that fix
*didn't* close: **PZL-0001** (`"Adjacency variable \"nationality\" is not shared by
\"Chesterfields\" and \"fox\"."` — no shared ordering domain was ever declared) and **PZL-0010**
(`"allDifferent requires an entity-indexed variable; \"arrival-order\" has only one entity."` —
a domain wrongly modeled as scalar). Both trace to the same root cause: vocabulary is decided in
one global call, before any clue is examined, then trusted unconditionally by every per-clue
constraint call.

**Reconciliation is deterministic-only for this pass** (explicit scope decision) — exact-match
merging on *normalized* (lowercased, trimmed) surface forms/attribute names, no LLM-assisted
fuzzy matching. All new code lives under
`design/spikes/SPIKE-009-graph-style-reconciled-extraction/scripts/lib/`, reusing SPIKE-008's
existing modules directly via relative cross-spike imports:
`../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/{puzzles,tool-call,clue-schema,grade}.ts`.

**1. `lib/propose-vocabulary.ts`** — one new tool, `proposeVocabulary`, called per clue through
the existing single-forced-tool `requestClueTool` wrapper (`tool-call.ts` — already used by
`back-translation-critic.ts`, reused here for a second purpose); both arrays may be empty, which
is how a pure scenario-setup clue expresses "nothing here" without needing a separate zero-
tool-call path. Deliberately unscoped/free-text otherwise (there's no global vocabulary yet to
scope against):

```jsonc
{
  "entityMentions": [{ "surfaceForm": string, "typeGuess": string, "canonicalIdGuess"?: string }],
  "domainMentions": [{
    "attributeNameGuess": string, "entityTypeGuess": string, "valueMentioned": string,
    "isOrderingHint": boolean  // true for adjacency/positional clues — the PZL-0001 signal
  }]
}
```

**2. `lib/reconcile.ts`** — pure, deterministic, offline-testable. Given every clue's
`VocabularyProposal`, produces a canonical `ExtractedVocabulary` (`clue-schema.ts`'s existing
`Vocabulary` shape) plus a provenance map (clueIndex -> contributed entity/domain ids):

1. Normalize every `surfaceForm`/`typeGuess`/`attributeNameGuess` (lowercase + trim) before any
   comparison.
2. Bucket entity mentions by normalized `typeGuess`; merge exact matches on normalized
   `canonicalIdGuess` OR normalized `surfaceForm` within a bucket.
3. Bucket domain mentions by (normalized `attributeNameGuess`, normalized `entityTypeGuess`);
   merge exact matches; a domain's `values` is the union of every merged mention's
   `valueMentioned`.
4. **Entity-indexed vs. scalar, decided AFTER merging**: count distinct merged entities of each
   domain's `entityTypeGuess` actually referenced by a contributing clue — reuse `clue-schema.ts`'s
   `entitiesOfDomain` (exported for this reuse — a one-line change to that file) rather than a
   second, potentially-drifting copy of the same predicate `compile.ts`'s real `isScalar` uses.
5. **Synthesize a positional domain when needed (the PZL-0001 fix)**: for any domain mention
   flagged `isOrderingHint: true` whose `entityTypeGuess` has no existing ordered/numeric domain,
   synthesize one entity-indexed domain (values `"1".."N"`, N = the entity count from step 4).
6. Emit canonical `{entities, domains}` + provenance map. Domain-split / near-duplicate cases
   that don't exact-match stay separate, unmerged, in v1 — the deferred LLM-assisted path.

**3. `lib/filter.ts`** — after reconciliation, re-run the existing, unchanged
`generateClueTools` + `requestClueConstraints` per-clue constraint loop against the canonical
vocabulary, then before assembly: drop any constraint whose fields don't resolve against the
canonical vocabulary (defensive — synthesized domains are new territory worth double-checking);
drop constraints from a clue whose only vocabulary contribution never survived reconciliation
(the "pure scenario setup" case). No constraint-content deduplication (redundant-but-consistent
constraints are harmless to MiniZinc, per SPIKE-008's own scoping precedent).

**4. `lib/vocabulary-reconciled-extract.ts`** — orchestrates 1→2→3 into one function parallel to
SPIKE-008's `extractPerClue`, same result shape.

**5. `run-comparison.ts`** (this spike's own) — reads SPIKE-008's already-committed, already-
paid-for baseline directly from
`design/spikes/SPIKE-008-per-clue-tool-call-decomposition/results/comparison-2026-09-14T14-05-07-883Z.json`
(the post-entity-scoping-fix run) rather than re-running `full-critic` or plain `per-clue` —
only the new `per-clue+reconcile` variant runs and costs money. Same 14-puzzle sample, same
`lib/grade.ts` grading (imported cross-spike, unchanged).

**Verification order**: (1) offline-only synthetic fixtures reproducing PZL-0001/PZL-0010's
exact shapes, confirming reconciliation's output compiles via the real `compile()`/`solve()` —
zero cost; (2) stop and report a cost estimate, wait for explicit go-ahead; (3) one live dry-run
on PZL-0001 and PZL-0010 specifically; (4) full 14-puzzle billed run of `per-clue+reconcile`
only, compared against the read-only baseline above.

## 3. Time-box

**One day (~8 hours)**: ~1h `propose-vocabulary.ts` (mirrors existing `clueSystemPrompt`/
`requestClueTool` patterns closely); ~3h `reconcile.ts` (the only genuinely new logic, unit-
testable offline against synthetic PZL-0001/PZL-0010 fixtures before any billed call); ~1h
`filter.ts` + assembly glue; ~1h the comparison runner (reading SPIKE-008's committed baseline
rather than re-running it); ~1h one live dry-run on the two named puzzles; ~1h full billed run
plus write-up. Hard stop at the time-box — write up whatever's found and mark `status:
abandoned` with open items noted, rather than extending into the deferred LLM-assisted path.

## 4. Notes

**2026-09-15 — built and proved the mechanism entirely offline, zero cost.** Exported
`entitiesOfDomain` from SPIKE-008's `clue-schema.ts` (one-line change, still spike-owned code)
so `reconcile.ts` reuses the exact same entity-counting predicate `compile.ts`'s real `isScalar`
rule uses, rather than a second copy. Built `lib/propose-vocabulary.ts` (per-clue vocabulary
proposal via the existing single-forced-tool `requestClueTool`; both arrays may be empty, which
is how a pure setup clue expresses "nothing here" without needing a separate zero-tool-call
path), `lib/reconcile.ts` (deterministic, normalized-lowercase exact-match merging, entity-
indexing decided post-merge, positional-domain synthesis for an ordering hint with no backing
domain), `lib/filter.ts` (drops constraints referencing anything that didn't survive
reconciliation), and `lib/vocabulary-reconciled-extract.ts` (orchestrates all of it, parallel in
shape to SPIKE-008's `extractPerClue`).

Verified in stages, each against the exact named failure shapes:
- `smoke-test-reconcile.ts`: synthetic PZL-0010-shaped input (an ordering attribute with no
  independently-proposed entities) correctly synthesizes 3 entities + a sized positional
  domain; synthetic PZL-0001-shaped input (entities already named, but no shared ordering
  domain declared) correctly synthesizes a positional domain sized to the already-named
  entities, rather than inventing new ones.
- `smoke-test-reconcile-compiles.ts`: the PZL-0010-shaped reconciled vocabulary, with an
  `allDifferent` over the synthesized positional domain, compiles and solves via the REAL
  `compile()`/`solve()` — the exact construct that previously failed
  (`"allDifferent requires an entity-indexed variable; ... has only one entity"`).
- `smoke-test-filter.ts`: confirms both drop rules (unknown-entity reference; clue whose only
  contribution never survived reconciliation) fire correctly and independently.
- `smoke-test-e2e.ts`: the full orchestration end to end against a stub server — a synthetic
  3-clue puzzle whose third clue is an adjacency clue with no independently-declared ordering
  domain (the PZL-0001 shape) — produces a compilable, solvable model, 6 total calls (3
  vocabulary proposals + 3 constraint calls, no reconciliation LLM call as designed).

All of the above is zero real API cost (stub server + local `minizinc` only). `pnpm lint`/
`typecheck`/`test` all pass unchanged on the root project.

**Per the plan's spend gate: stopping here to report a cost estimate before any live call.**
See the session's own report for the estimate and to request a go-ahead — not duplicated in
this file since it's a one-time checkpoint, not a durable finding.

## 5. Findings

_(filled in once the spike concludes)_

## 6. Conclusion

_(filled in once the spike concludes)_
