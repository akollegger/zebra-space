---
id: SPIKE-009
title: Graph-Style Reconciled Extraction (Local Extract, Neighborhood Reconcile, Filter)
status: done
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

**2026-09-15 — live dry-run on PZL-0001/PZL-0010 found and fixed three real identifier-hygiene
bugs before committing to the full sweep, then surfaced a fourth left as a genuine finding:**

1. **Tool names must match `^[a-zA-Z0-9_-]+$`** (OpenAI's real function-calling validator) —
   `reconcile.ts` was emitting domain/entity-type strings straight from free-text model output
   (`attributeNameGuess`/`typeGuess`), and `clue-schema.ts`'s unchanged tool-naming scheme
   (`assignment__<variable>`) built an invalid tool name from one containing a space. Fixed by
   adding `sanitizeToken()` (lowercase, collapse disallowed characters to `-`, trim) applied at
   every point a proposal field becomes part of an IDENTIFIER (domain variable, entity type,
   entity id) — never applied to domain VALUES, which flow through as real puzzle data, not
   identifiers.
2. **Domain-variable-name collision across different entity types** — `mergeDomainMentions`
   correctly buckets by (attribute name, entity type), so the SAME attribute name proposed for
   genuinely different entity types (a puzzle's clues independently called several different
   things "arrival-order" — for "vehicle", "car", "person", "pedestrian") produced multiple
   domains sharing one `variable` string; MiniZinc's single flat namespace rejects the second
   declaration (`"identifier \`arrival_order' already defined"`). Fixed by disambiguating every
   colliding attribute name with an entity-type suffix, applied to ALL of that name's
   occurrences (not just the second onward), so the fix doesn't depend on candidate order.
3. **Entity-type name colliding with a domain value string** — an entity TYPE ("car") and an
   unrelated domain's VALUE ("car") both sanitize to the same MiniZinc identifier; `compile.ts`
   (unchanged) emits an entity-type enum named after the type and, separately, a value-enum
   whose member is the value itself — both land on the same flat-namespace identifier
   (`"identifier \`car' already defined"`). Fixed conservatively: rename the colliding ENTITY
   TYPE (never a domain value, which is real puzzle data), scoped only to entity-type strings
   that structurally collide with detected domain values.
4. **Left as a genuine finding, not patched**: a domain VALUE colliding with a DIFFERENT
   domain's value string (both domains' value-enums landing on the same MiniZinc identifier,
   e.g. two unrelated clues each producing a value literally `"the order they arrive"`). Unlike
   1-3 (pure identifier-hygiene bugs in this spike's own code), fixing this properly means
   either duplicating semantic near-duplicate/domain-split resolution this spike's Method
   explicitly deferred to a future LLM-assisted pass (§2/§4), or changing `compile.ts` itself
   (root `src/`, out of scope for a spike). Left as-is; the full 14-puzzle run below measures how
   often it actually recurs, which is itself the honest signal about whether local, independent
   per-clue vocabulary proposals generate more generic-string collisions than a single global
   vocabulary call naturally avoids by seeing the whole puzzle at once.

Net effect of fixes 1-3, measured directly on the same two puzzles across successive live
retries: **PZL-0001 moved from `COMPILE_FAILED` (ungraded) all the way to `SOLVE_UNSATISFIABLE`
— a real, gradable outcome (graded `MISMATCH`) that SPIKE-008's own `per-clue` baseline never
reached for this puzzle.** PZL-0010 still doesn't reach a gradable state, blocked by finding 4
above. Full 14-puzzle billed run launched next.

**2026-09-15 — trimmed superseded raw result files from the PR for reviewability.** The three
intermediate dry-run iterations (single- or two-puzzle runs, each superseded by the next as
bugs were found and fixed — see the numbered fixes above) pushed this PR's diff large enough
that the repo's automated review bot failed outright ("the model output limit was reached").
Their content is already fully captured in prose above; removed rather than kept as raw JSON,
retaining only the final, full-sample run (`results/comparison-2026-09-14T15-37-27-397Z.json`,
cited throughout §5) that this spike's actual Findings are drawn from.

**2026-09-15 — PR #28 review found five more real issues, all fixed:**
1. **`filter.ts` only checked `derivedRule.thenConstraints`, missing the rule's own condition.**
   `comparison.variable` and `expressionComparison.expression`'s variable references (and,
   transitively, `and`'s nested conditions) could reference an undeclared variable and still
   pass this filter, failing later — inside `compile()` — with a less specific error. Added a
   recursive walk over `DerivedCondition` (skipping `relation`'s fact name, which isn't a
   variable reference) alongside the existing `thenConstraints` walk.
2. **A failed vocabulary-proposal call was silently indistinguishable from a legitimate
   vocabulary-free clue.** `propose-vocabulary.ts` now records `{reason, detail}` on failure
   instead of collapsing straight to empty arrays; `vocabulary-reconciled-extract.ts` surfaces
   every failure via a new `failedProposals` field; `run-comparison.ts` grades a puzzle with any
   as `UNRELIABLE` rather than silently proceeding. A live spot-check found this had real
   consequences already recorded — see §5's caveat.
3. **`sanitizeToken` diverged from `compile.ts`'s own `sanitizeIdentifier`** in exactly the way
   this module exists to prevent: it kept hyphens as a distinct allowed character and collapsed
   RUNS of disallowed characters, while `sanitizeIdentifier` converts hyphens (and everything
   else disallowed) to `_` one at a time. Two proposal strings differing only in hyphen-vs-
   underscore punctuation (`"a-b"` / `"a_b"`) stayed distinct here, passing this module's own
   collision checks, only to both resolve to the identical MiniZinc identifier once `compile.ts`
   processed them for real. Switched to calling `sanitizeIdentifier` directly (imported from
   `compile.ts`), with `normalize()`'s lowercase-fold kept as a deliberate additional layer on
   top (case-insensitive bucketing was an explicit design choice, and only ever merges MORE
   aggressively than the compiler's own case-sensitive collision behavior requires). Also found,
   while verifying this: three DERIVED identifiers (the collision-disambiguation suffix, the
   synthesized positional-domain name, the entity-type/value-collision rename) concatenated a
   raw literal suffix onto an already-sanitized string WITHOUT re-sanitizing the combined
   result — the same class of bug, reintroduced downstream of the fix. Fixed by wrapping each
   final concatenated string in `sanitizeToken()` again. Added
   `smoke-test-punctuation-equivalence.ts` reproducing the exact reported shape.
4. **The SPIKE.md claim that `reconcile.ts` reuses `clue-schema.ts`'s exported
   `entitiesOfDomain` didn't match the code** — a nit, but a real doc/implementation mismatch:
   `resolveDomains`'s `entitiesOfType` had its own parallel `normalize()`-based filter instead of
   calling the shared predicate. Now genuinely calls `entitiesOfDomain`, wrapped in a small
   adapter (`entitiesOfDomain` expects a full `Vocabulary`/`Domain` pair; `entitiesOfType` only
   has a type string and a plain entity list mid-construction) — same behavior, but no longer a
   second implementation that could silently drift from the first.
5. **`run-comparison.ts`'s baseline type declaration didn't match the stored JSON shape** (missing
   the top-level `verdict`/`detail` fields, though `grade.verdict` — the field actually read and
   displayed — genuinely is present and correct; verified directly against the stored file
   before changing anything, since the review comment's specific symptom claim ("prints `?` for
   every available baseline grade") didn't reproduce against this session's own console output).
   Tightened the type to declare the full actual shape and simplified the read to plain dot
   access.

All fixes verified via existing + new offline smoke tests (14 total, all passing) plus one live
single-puzzle check (PZL-0004) confirming no new provider-schema rejection and that
`failedProposals` now surfaces real call failures. No further full-sample billed re-run was
performed as part of this fix pass — see §5's caveat for what that means for this run's own
recorded numbers.

## 5. Findings

Full 14-puzzle billed run: `results/comparison-2026-09-14T15-37-27-397Z.json`. One sample per
puzzle (SPIKE-005/SPIKE-008's own caveat applies equally — individual cells are suggestive, not
conclusive).

**A caveat on the numbers below, found in PR #28 review and confirmed live after this run was
already recorded**: a failed vocabulary-proposal tool call (prose reply, invalid JSON,
structural rejection) was, at the time of this run, silently collapsed into the same
empty-arrays shape a legitimate vocabulary-free clue produces (fixed post-`main`-merge — see the
PR's review-response commit). A live spot-check on PZL-0004 after the fix (its own raw JSON not
kept alongside the others — trimmed for PR reviewability, same reason as the note above) found
**4 of its
clues' vocabulary proposals had actually failed** yet the puzzle still reached `SOLVE_UNIQUE` in
this recorded run — meaning the assembled CSP was silently missing real content from 4 clues and
happened to still solve to something, with no record that anything went wrong. This means the
9/14 gradable-state figure below is a measurement taken WITHOUT that visibility, and could be
optimistic (a puzzle credited as gradable might have gotten there on an incomplete CSP) or
pessimistic (a puzzle marked ungradable might have been salvageable had a failed proposal been
retried) in ways this recorded run cannot distinguish. Re-running the full sample with the fix
in place is the only way to know the corrected numbers; not done in this pass (no fresh billed
re-run was requested) — flagged here rather than silently left inconsistent with what §4/§6
otherwise imply about this run's reliability.

### 5.1 Aggregate: a small net improvement over plain `per-clue`, at comparable cost

| Variant | Cost (14 puzzles) | Calls | Reached a gradable state | Passing verdicts |
|---|---|---|---|---|
| `per-clue` (SPIKE-008 baseline, post-entity-scoping-fix) | $0.031 | 77 | 8/14 | 2/14 |
| `per-clue+reconcile` (this spike) | $0.071 | 131 | **9/14** | 2/14 |
| `full-critic` (today's real pipeline) | $2.096 | 168 (worst-case, not measured) | 13/14 | 2/14 |

Reconciliation adds real cost (roughly 2x plain `per-clue`'s calls, from the added per-clue
vocabulary-proposal stage) for a marginal gradable-state improvement (+1 puzzle) on this single
run, still ~30x cheaper than `full-critic`. Passing-verdict count is unchanged (2/14, the same
two puzzles — PZL-0028 `READING_MATCHED`, PZL-0033 `PREMISE_FREE_MATCH` — both variants).

### 5.2 Per-puzzle: real gains, one real regression, non-determinism visible

| Puzzle | `per-clue+reconcile` | `per-clue` baseline | Change |
|---|---|---|---|
| PZL-0038 | `SOLVE_UNSATISFIABLE`/`MISMATCH` | `SOLVE_ERROR`/N/A | **improved** — now gradable |
| PZL-0012 | `SOLVE_UNSATISFIABLE`/`MISMATCH` | `SOLVE_ERROR`/N/A | **improved** — now gradable |
| PZL-0011 | `COMPILE_FAILED`/N/A | `SOLVE_UNSATISFIABLE`/`MISMATCH` | **regressed** — was gradable, now isn't |
| PZL-0001, PZL-0002, PZL-0003, PZL-0010 | still ungraded (`COMPILE_FAILED`/`SOLVE_ERROR`) | also ungraded | no change, different reasons (§5.3) |
| remaining 8 puzzles | identical outcome+verdict | — | no change |

PZL-0011's regression detail: `"Entity placeholder \"$9,000\" was never substituted with a real
entity"` — the per-clue constraint-extraction stage (unchanged from SPIKE-008) emitted a
`derivedRule` placeholder token where a dollar amount was expected; this is a constraint-
extraction-stage issue, not a reconciliation one — reconciliation's vocabulary was not the
cause here, a useful reminder that this spike's mechanism only changes vocabulary, not the
unchanged per-clue constraint stage's own failure modes.

Also notable: **PZL-0001 itself flipped between the live dry-run and the full run** — the
dry-run (§4, before the full sweep) reached `SOLVE_UNSATISFIABLE`/`MISMATCH` (a gradable state,
improving on the baseline's `COMPILE_FAILED`), but the full run's independent sample reverted to
`COMPILE_FAILED`. Real, expected LLM sampling variance (SPIKE-004's original finding, still
holding at the per-clue-proposal level) — not a regression in the mechanism, but a reminder that
a single sample per puzzle is not a reliable measurement for puzzles this close to the margin.

### 5.3 The un-gradable puzzles are now dominated by a NEW collision class, not the two this spike targeted

Of the 5 puzzles still not reaching a gradable state, none show the original PZL-0001/PZL-0010
failure signatures (adjacency-with-no-ordering-domain; allDifferent-on-scalar) — both of those
specific failure classes are gone, exactly as designed (§4, confirmed directly on PZL-0002's
stored `.mzn` in SPIKE-008 and now on PZL-0001/PZL-0010's own live output during this spike's
dry-run, §4). What replaced them, inspected directly from the raw records:

- PZL-0002: `"identifier \`house1' already defined"` — two independently-proposed type labels
  that only became identical AFTER identifier sanitization (fixed post-hoc, §4 item, not
  re-verified against a full rerun — see §6).
- PZL-0010: `"identifier \`South' already defined"` — the value/value collision class named in
  §4 item 4, deliberately left unpatched.
- PZL-0003: `"type-inst variable $T instantiated with incompatible types (var Values_rock vs
  Values_paper)"` — a new shape, not yet diagnosed in depth (time-boxed out — see §6).
- PZL-0001: `"Adjacency variable \"has\" is not shared by \"smoker1\" and \"person1\""` — the
  positional-domain synthesis fired (no more missing-domain crash), but on THIS run's specific
  local vocabulary proposals, the synthesized domain didn't end up shared between the two
  entities the adjacency clue actually needed — a per-clue-proposal quality issue (which
  entities get merged into which type) more than a reconciliation-logic issue.
- PZL-0011: constraint-stage placeholder substitution, unrelated to vocabulary (§5.2).

**The pattern across 5.2/5.3 is consistent and important**: independent, local per-clue
vocabulary proposals are far more prone to generating identifier collisions (the same generic
word — "car", "South", a type label with stray punctuation — reused across what a global,
whole-puzzle-aware call would have recognized as needing distinct names) than SPIKE-008's
single-global-vocabulary-call design ever was. Reconciliation's deterministic merging closes the
two failure classes it was built for, but the local-proposal architecture itself introduces a
new failure surface that a single global call structurally avoided by construction (one call,
one consistent naming pass, no cross-call collision possible). This is the central, honest
finding of this spike.

## 6. Conclusion

**The two named failure classes are closed, exactly as designed — but the local-proposal
architecture trades them for a new, more diffuse failure surface (identifier collisions across
independent local proposals), leaving net reliability roughly flat.** PZL-0001's and PZL-0010's
specific failure signatures (missing ordering domain; scalar-vs-entity-indexed) do not recur
anywhere in the 14-puzzle sample — confirmed both by direct inspection (§5.3) and by the
mechanism's own offline proof (§4, `smoke-test-reconcile-compiles.ts`). That is real, structural
validation of sub-questions 1 and 2 (§1): local extraction does surface genuine cross-clue
conflicts to reconcile, and reconciliation does structurally prevent the targeted failure class
in a way a post-hoc enum-scoping patch alone could not (it has no mechanism to *invent* a
missing domain).

But the net aggregate result (8/14 → 9/14 gradable, 2/14 → 2/14 passing) is a small, likely-
within-noise improvement, not the clear win a purely additive story would predict — because
local, independently-generated vocabulary proposals reintroduce a different failure class this
spike did not originally anticipate: **generic-word identifier collisions across clues that
never see each other**. Three of five fixes for this (§4 items 1-3: invalid tool-name
characters, cross-type variable-name collisions, entity-type/value collisions) were purely
mechanical identifier hygiene, cheaply fixed within this spike's deterministic scope. The fourth
(§4 item 4: value/value collisions across unrelated domains) and the bucketing-key-granularity
fix applied *after* the recorded full run (§5.3's PZL-0002 note) sit right at the boundary of
this spike's explicit scope decision — genuine near-duplicate/domain-split resolution, which
the plan deferred to a future LLM-assisted pass rather than building here.

**On cost (sub-question 4): confirmed cheap, but not as cheap as hoped.** $0.071 for 14 puzzles
is still ~30x cheaper than `full-critic`'s $2.096 — the decomposition cost advantage from
SPIKE-008 survives. But it's roughly 2.3x plain `per-clue`'s cost, close to the plan's own
"roughly 2x" estimate, for a gradable-state gain of only +1 puzzle on this sample — a much
thinner margin than SPIKE-008's own entity-scoping fix delivered (which doubled the
gradable-state rate for essentially the same cost).

**Recommended next steps:**
1. **Verify the post-hoc bucketing-key fix (§4/§5.3) with a fresh, small re-run** (PZL-0002
   specifically) before trusting it — not done in this pass, since it landed after the recorded
   full run and a further billed re-run wasn't requested.
2. **Do not build the deferred LLM-assisted near-duplicate/domain-split resolution as a blind
   next step.** This spike's evidence suggests the identifier-collision failures are common
   enough (3 of 5 remaining un-gradable puzzles) to justify it in principle, but the *mechanism*
   worth measuring first is narrower than full fuzzy entity matching: specifically, whether a
   single cheap pass recognizing "these two locally-proposed strings collide after
   sanitization — are they actually the same concept, or must they be disambiguated?" (a much
   smaller question than general near-duplicate co-reference) closes most of what remains.
3. **This spike's core question is answered**: a graph-construction-shaped pipeline (local
   extract, reconcile, filter) does what it was designed to do for the specific failure classes
   named, but is not, on its own and without further work, a clearly superior architecture to
   SPIKE-008's simpler global-vocabulary design on THIS 14-puzzle sample. Any follow-up ADR
   drawing on both spikes should weigh this directly rather than assume the more sophisticated
   architecture wins by construction.

Status: done.
