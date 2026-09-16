---
id: SPIKE-012
title: Graph-Shaped Per-Clue Pipeline (Inventory → Group → Shape → Template-Typed Clues → Oracle Repair)
status: done
rfcs: [RFC-003]
created: 2026-09-15
---

# SPIKE-012: Graph-Shaped Per-Clue Pipeline (Inventory → Group → Shape → Template-Typed Clues → Oracle Repair)

## 1. Question

[SPIKE-011](../SPIKE-011-per-clue-pipeline-retrospective/SPIKE.md) §5.3 synthesized (but
explicitly did not build) a pipeline design from SPIKE-008/009/010's own diagnosed root causes,
reasoning that every remaining failure reduces to the same shape: a call was asked to
**construct** something (a vocabulary, an identifier, a nested constraint tree) instead of
**choose** from a small enumerated/closed set, or the call that could have fixed a problem ran
*before* the information needed to fix it existed (SPIKE-010's "frozen vocabulary" finding).
SPIKE-011's own live re-run (§5.7) confirmed two narrow fixes to the EXISTING staged design
(entity-scoped enums, ordering-domain synthesis, identifier-collision detection) still left every
per-clue variant at 0/14 `SOLVE_UNIQUE`/`MATCH`, even after both fixes demonstrably worked on
the exact bugs they targeted — evidence that the remaining gap is architectural, not a
collection of independently-patchable bugs.

Does the redesigned pipeline SPIKE-011 §5.3 proposes — **inventory** (literal-span entity
mentions, no typing yet), **group** (categorization answered as indices into the inventory, never
re-typed strings — closing SPIKE-009's entire identifier-collision failure surface by
construction rather than by detection), **shape** (a small, fixed set of multiple-choice
questions deciding entity-indexing/`allDifferent`/ordering — the exact modeling decisions
SPIKE-011's fix 1 showed a single global vocabulary call gets wrong or overreaches on), **per-clue
two-step typing** (classify which of a handful of plain-English clue templates a clue
instantiates, THEN fill only that template's slots as enums over inventory indices — never a
single call offering all nine `ExtractedConstraint` kinds at once, per SPIKE-008's own
"per-clue call offers all nine tools" finding), and **compile/solve as a repair oracle** (a
compile error or an unexpected `SOLVE_UNSATISFIABLE`/`SOLVE_MULTIPLY_SATISFIABLE` on a puzzle the
catalog declares determinate names the specific clue(s) to re-ask, reusing SPIKE-008's own
grounded-critic drop-one-clue/diff-solutions mechanics rather than a whole-document critique) —
**actually raise `SOLVE_UNIQUE`/`MATCH` above the 0/14 every per-clue variant has scored across
four spikes**, at a cost still far below `full-critic`'s $2.06-2.10/14-puzzle figure?

A secondary question, direct enough to answer from the same run: does forcing every
LLM-facing identifier to be either a literal prose span or an inventory index (never a
model-typed string) close SPIKE-009's identifier-collision failure class **by construction**,
without the collision-DETECTION safety net SPIKE-011's fix 2 added, or is that detection still
worth keeping as defense in depth even under this design?

## 2. Method

New code lives entirely under this directory's own `scripts/lib/`, reusing SPIKE-008's existing
modules directly via relative cross-spike imports (the same pattern SPIKE-009/010 already used):
`../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/{puzzles,tool-call,grade}.ts` for
clue-splitting, the forced-tool-call wrapper, and answer-key grading; `grounded-critic.ts` and
`back-translation.ts`/`back-translation-critic.ts` for the oracle-repair and selective
back-translation stages (adapted, not copied verbatim, to target a NAMED clue rather than every
clue). The real, unmodified `src/compiler/compile.ts` and `src/solver/solve.ts` are the compiler/
solver throughout — this spike changes only what precedes them.

**1. `lib/segment.ts`** — reuses `puzzles.ts`'s existing `splitClues` numbered-list heuristic
unchanged (SPIKE-008 Notes: covers 11/14 of this sample); for the 3 non-decomposable puzzles,
falls back to one call, same degenerate-case handling SPIKE-008 already established.

**2. `lib/inventory.ts`** — one forced-tool-call per puzzle (not per clue — the whole prose at
once, since this is span-copying, not modeling): `list_mentions(spans: string[])`, validated
synchronously against the source prose (every returned span must be a literal substring; a
non-substring span is rejected and re-asked once). No types, no ids, no grouping — the single
most reliably-executable operation this design offers a model, per SPIKE-011 §5.3 step 2.

**3. `lib/group.ts`** — one forced-tool-call: given the numbered inventory,
`group_mentions([{label: string, member_indices: number[]}])` — labels are free text (a
human-readable category name), but MEMBERSHIP is always by index, never by re-typed string. Code
validates every index is in range and each inventory item belongs to at most one group, then
assigns canonical, code-generated ids (`e1`, `e2`, ... or sanitized-from-first-mention, code's
choice, never the model's). This is the direct, constructive fix for SPIKE-009's entire
identifier-collision failure surface (§1's secondary question) — group LABELS may still collide
after sanitization (two groups' human-readable names), which is deliberately still routed through
SPIKE-011's fix-2 collision detector rather than assumed safe, since group-label collision is a
real remaining possibility this design doesn't structurally foreclose.

**4. `lib/shape.ts`** — one forced-tool-call per detected group (small, fixed schema): `answer_shape_questions({group_index, is_grid: boolean, has_ordering: boolean, ordering_uses_existing_group: number | null})`. Code turns these answers into `Domain`/`Entity` declarations
deterministically: `is_grid` true → entity-indexed with `allDifferent` available; `has_ordering`
true with `ordering_uses_existing_group` null → code SYNTHESIZES a positional domain sized to
that group's member count (values `"1".."N"`) — the direct, general-purpose fix for PZL-0001's
class of bug, built as a deterministic code path fed by a yes/no answer instead of hoping a
prose-reading vocabulary call notices the implicit ordering unprompted (SPIKE-011 fix 1's own
demonstrated failure mode: overreach on PZL-0004, which has no real ordering).

**5. `lib/clue-templates.ts`** — a small, fixed set of plain-English clue templates (assignment,
negation, positional/adjacency, linked-attributes, arithmetic/threshold, rule-table fact, no
constraint) distinct from `clue-schema.ts`'s per-`ExtractedConstraint`-kind generation — each
template's slot schema is generated fresh from the canonical vocabulary §2 steps 2-4 produced
(entity/value enums scoped per-domain, mirroring SPIKE-008's own post-fix entity-scoping, since
that fix's lesson transfers regardless of pipeline shape).

**6. `lib/per-clue-typed.ts`** — two forced-tool-calls per clue: `classify_clue(clue_index,
template_id)` (the closed template enum from step 5, plus a "no constraint" choice — SPIKE-008
PR #27's fix 3 finding, that a real setup-only clue needs a legitimate zero-constraint path, is
carried forward here as a first-class template rather than an afterthought), then
`fill_slots(clue_index, ...)` against ONLY that template's generated schema. Provenance
(clueIndex → constraint) is tracked throughout, the same tagging SPIKE-008/009 already used.

**7. `lib/oracle-repair.ts`** — after assembly: `compile()` failure → the `CompileError`'s own
detail (already specific and clue-attributable per SPIKE-011 fix 2) re-asks ONLY the implicated
clue's step-6 pair, with the error attached; `SOLVE_UNSATISFIABLE` → adapt SPIKE-008's
`grounded-critic.ts` drop-one-clue search to re-ask the implicated clue(s) directly rather than
issue a generic revision; `SOLVE_MULTIPLY_SATISFIABLE` on a puzzle the answer key declares
determinate → adapt the same module's diff-solutions logic to name the under-constrained
variable(s) and re-ask the clue(s) referencing them. Bounded to at most 2 repair rounds per
puzzle (mirrors SPIKE-008's own back-translation-critic bound), to keep cost predictable.

**8. `lib/selective-back-translation.ts`** — invoked ONLY on the clue(s) step 7 named, not on
every clue (SPIKE-008 §5.1's own finding: universal back-translation cost ~2.4x for no
compensating correctness gain) — reuses `back-translation.ts`'s renderer and
`back-translation-critic.ts`'s judging call unchanged.

**9. `run-comparison.ts`** — reads SPIKE-011's already-committed, already-paid-for `full-critic`
baseline directly from
`design/spikes/SPIKE-008-per-clue-tool-call-decomposition/results/comparison-2026-09-15T11-24-35-879Z.json`
(the post-both-fixes run) rather than re-running it — only this spike's new variant runs and
costs money. Same 14-puzzle sample (`STRATIFIED_SUBSET` + the 6 never-reliably-solved puzzles,
per SPIKE-008 §2), same `grade.ts` grading (imported cross-spike, unchanged). **Runs each puzzle
n=3 times** (not the single sample every prior spike in this line used) specifically so this
spike's own numbers can distinguish a real effect from the run-to-run LLM sampling variance
SPIKE-004/005/008/009/010/011 all flagged as a standing limitation of their own single-sample
cells — reports the per-puzzle pass RATE (0/3, 1/3, 2/3, 3/3), not just one outcome tag.

**Verification order** (mirrors SPIKE-008/009's own staged-spend discipline): (1) offline-only
synthetic fixtures reproducing PZL-0001 (ordering), PZL-0002/PZL-0010 (entity-indexed grid vs
scalar), and PZL-0003 (rock-paper-scissors' single-entity-type asymmetric-move shape) end-to-end
through the real `compile()`/`solve()` — zero cost; (2) stop and report a cost estimate for the
n=3×14-puzzle sweep, wait for explicit go-ahead before any billed call; (3) one live dry-run on
2-3 puzzles spanning different shapes to catch runtime bugs against real model responses; (4) the
full billed sweep.

## 3. Time-box

**Two days (~16 hours)**: ~2h inventory + group (steps 2-3, offline-tested against synthetic
fixtures); ~2h shape (step 4, including the deterministic positional-domain synthesis); ~3h
clue templates + two-step per-clue typing (steps 5-6, the bulk of new schema-generation work);
~2h oracle-repair adaptation (step 7, adapting rather than rebuilding SPIKE-008's existing
grounded-critic mechanics); ~1h selective back-translation wiring (step 8, thin reuse); ~2h
comparison runner + full offline smoke-test pass (step 9's offline half); ~1h live dry-run +
fixes; ~3h the full n=3×14-puzzle billed sweep and write-up. Hard stop at the time-box regardless
of completeness — write up whatever findings exist and mark `status: abandoned` with a note on
what was still open, rather than extending scope, per this skill's own convention.

## 4. Notes

_(dated log, appended as work proceeds)_

**2026-09-15 — steps 1-7 built, all offline-verified, zero cost so far.** Built
`lib/inventory.ts` (literal-span mentions + substring validation), `lib/group.ts`
(index-referenced categorization + `assignCanonicalIds`, code-only identifier assignment,
mirroring `compile.ts`'s own `computeEntityTypeEnumNames` disambiguation-loop pattern),
`lib/shape.ts` (the pivotal multiple-choice classification + `buildVocabulary`'s deterministic
entity/domain construction, including per-axis-scoped positional-domain synthesis — named
`${axisType}_position`, never a single bare `position`, the direct fix for the SPIKE-011 §4/§5.7
PZL-0004 regression), `lib/clue-templates.ts` (reuses `clue-schema.ts`'s `generateClueTools`
UNCHANGED — the per-domain-scoped, entity-scoped schema-generation SPIKE-008's own fix already
solved — only restructuring how tools are OFFERED, filtered by a chosen template rather than all
nine with `tool_choice: "auto"`), `lib/per-clue-typed.ts` (the two-step classify-then-fill call
pair + repair-round, mirroring SPIKE-008's own per-clue repair pattern), `lib/oracle-repair.ts`
(reuses SPIKE-008's `groundedFinding` UNCHANGED for the drop-one-clue/diff-solutions search; adds
a new heuristic, `clueIndicesTouchingError`, to localize a COMPILE failure to a clue by matching
quoted tokens in the `CompileError` message against each clue's own emitted constraint), and
`lib/graph-pipeline-extract.ts` (the orchestrator, exposing `extractGraphPipeline` — steps 1-6,
no repair — and `extractGraphPipelineWithRepair` — adds step 7).

Verified in three stages, all zero-cost:
- `smoke-test-shape.ts`: `assignCanonicalIds`/`buildVocabulary` reproduce three real puzzle
  shapes by hand (PZL-0002's grid, PZL-0001's implied-ordering, PZL-0004's no-entity-axis
  scalar-scenario-fallback) and compile/solve each via the REAL `compile()`/`solve()` — all
  three pass, including a direct check that the synthesized positional domain is
  entityType-scoped (`house_position`, not a bare `position`).
- `smoke-test-e2e.ts`: a synthetic 2-clue puzzle driven through a stub HTTP server exercises
  EVERY stage in sequence (inventory → group → shape → per-clue classify+fill ×2) — 7 total
  calls as expected, producing a compilable, solvable model through the real compiler/solver.
- `smoke-test-oracle-repair.ts`: a synthetic 3-clue puzzle with a deliberately-planted conflict
  (two clues directly contradicting each other) proves `repairAndSolve` detects the conflict via
  the real solver, correctly localizes it to one of the two actually-conflicting clues (not the
  unrelated third), and converges to a satisfiable state within the 2-round bound. One iteration
  needed: the test's own diagnostic (tracking only the LAST server call) initially mis-flagged a
  real, correct two-round repair sequence as a failure — fixed by tracking every call's target
  across all rounds, not the pipeline logic itself, which worked correctly on the first attempt.

**Deferred within the time-box**: step 8 (selective back-translation) is NOT built in this pass.
Per RFC-003 §7.3/SPIKE-008 §5.4, compile/solve-oracle repair (step 7) cannot catch a
semantically-wrong-but-solvable extraction — back-translation is the mechanism for exactly that
gap, so its absence here is a known scope limit, not an oversight. Given the time-box, this
spike's core comparison (does the inventory→group→shape→per-clue-typing architecture itself beat
`full-critic`/prior per-clue variants on `SOLVE_UNIQUE`/`MATCH`) is answerable from the two
variants already built (`graph-pipeline` alone, `graph-pipeline+oracle-repair`) — adding
selective back-translation as a third variant is named as a follow-up in the Conclusion rather
than built here.

`pnpm test` (196 pass, 1 skipped, 0 fail) and `pnpm lint` stay clean on the root project
throughout — this spike's new code lives entirely under its own `scripts/lib/`, touching no
shipped `src/` file.

**2026-09-15 — cost estimate ($1.00-$1.50 for n=3×14×2-variant) reported, user approved
proceeding.**

**2026-09-15 — live dry-run (3 puzzles spanning grid/scalar/ordering shapes), first pass: 2 real
bugs found, one fixed.** `REPS=1` on PZL-0002/PZL-0004/PZL-0001 ($0.0119 total):

1. **PZL-0004 (no natural entity axis) — a real, structurally-important bug, fixed.** `shape`
   classified EVERY group `entityAxis`, leaving zero domains — which cascades into
   `clue-schema.ts`'s own zero-domain fallback (an UNSCOPED free-string schema for `variable`/
   `entity`, documented there as "this shouldn't happen" for the ORIGINAL single-global-
   vocabulary caller it was written for). The result: `variable: "Rope"` and
   `entity: "weapon"` — a domain VALUE typed as a variable name, a GROUP LABEL typed as an
   entity id — the exact "model types a free-text identifier" failure this whole design exists
   to foreclose, reintroduced through an edge case in code this spike reuses unchanged. Fixed
   two ways: (a) `shape.ts`'s system prompt now explicitly names the "narrowing down one
   unstated scenario, no real entity axis at all" case and says every-group-domainValues is a
   legitimate answer, not a default to avoid; (b) `extractShape` now retries ONCE with a
   specific nudge whenever the first classification yields zero domains, and marks the result
   `degenerate` if a second attempt still does. Confirmed live: after the fix, PZL-0004 reaches
   `SOLVE_MULTIPLY_SATISFIABLE` on both variants instead of `COMPILE_FAILED`/an unscoped
   `"Rope"` reference.
2. **PZL-0001 (the hardest, largest catalog puzzle) — a genuine hard-puzzle finding, NOT
   chased.** `shape`/`group` produced a fragmented vocabulary (13 entities, domains split across
   mismatched entityTypes like `"suspect"` for a puzzle with no suspects at all, a
   `house_position` domain sized 9 instead of 5) — a live recurrence of SPIKE-004's original
   vocabulary-modeling non-determinism finding, now distributed across three separate calls
   (inventory/group/shape) instead of one. This is a real, honest limitation of the design on
   this specific puzzle, not a code bug — left as a finding for the full sweep to quantify
   rather than patched, consistent with this session's own SPIKE-011 caution against chasing
   every new failure discovered mid-verification.
3. **A separate, real gap in `oracle-repair.ts`'s clue-localization heuristic, found but NOT
   fixed.** PZL-0001 also hit `"linkedAttributes needs at least 2 attributes to link; got 1."` —
   a `checkStructural` gap in SPIKE-008's own (unchanged, reused) `tool-call.ts`: it never
   validates JSON Schema's `minItems`, so a fill call emitting only 1 attribute for a
   `linkedAttributes` template passes structural validation and is only caught later, at
   compile time. `graph-pipeline+oracle-repair`'s `repairRounds: 0` on this puzzle shows why the
   oracle didn't help: `clueIndicesTouchingError` only matches QUOTED tokens in the error
   message, and this particular `CompileError` quotes none (an arity complaint, not an
   identifier complaint) — a real, documented blind spot in the repair heuristic, not fixed in
   this pass (named in the Conclusion as a follow-up, not chased further per the time-box).

Re-ran the same dry-run after the shape.ts fix: PZL-0004 now reaches `SOLVE_MULTIPLY_SATISFIABLE`
on both variants (was `COMPILE_FAILED`); PZL-0001 unchanged (the two findings above stand, both
already understood and explicitly deferred). `pnpm test`/lint/offline smoke tests all re-verified
clean after the fix. Proceeding to the full `n=3×14-puzzle×2-variant` billed sweep next.

**2026-09-15 — full sweep complete.** `n=3` reps × 14 puzzles × 2 variants (`graph-pipeline`,
`graph-pipeline+oracle-repair`), `openai/gpt-4o-mini`. Total spend: **$0.1227** — well under the
$1.00-$1.50 estimate. Raw:
`results/comparison-2026-09-15T12-29-30-944Z.json`. See §5/§6.

## 5. Findings

### 5.1 Headline: `SOLVE_UNIQUE` moved off zero for the first time in four spikes — `MATCH` did not

> **Correction (2026-09-16):** re-checked as part of scoping the blast radius of a grader
> token-normalization gap found and fixed in SPIKE-014 (see that spike's §5.7). PZL-0003's own
> `SOLVE_UNIQUE` rep (both variants, discussed in §5.2 below) was actually a correct extraction —
> the *extraction* step itself wrote `"paper"` where the answer key spells it `"Paper"`, and the
> grader's case-sensitive comparison graded it `MISMATCH` before the fix. **`MATCH` is 1/42 for
> each variant, not 0/42** — a small but real correction to this section's headline and to §5.2/§6
> below, which otherwise stand as originally written (the fix does not change PZL-0007's
> genuinely-broken-extraction case, or any other puzzle in this table).

| Variant | `SOLVE_UNIQUE` | `MATCH` | Gradable (not `COMPILE_FAILED`/`SOLVE_ERROR`) | Cost (14×3) | Calls |
|---|---|---|---|---|---|
| `full-critic` (baseline, single sample, reused from SPIKE-011) | 11/14 (79%) | 2/14 (14%) | 13/14 | ~$2.06 (1 rep) | 168 |
| `graph-pipeline` | **6/42 (14%)** | 0/42 (0%) → corrected **1/42 (2%)** | 28/42 (67%) | $0.0564 | 530 |
| `graph-pipeline+oracle-repair` | **6/42 (14%)** | 0/42 (0%) → corrected **1/42 (2%)** | 32/42 (76%) | $0.0663 | 586 |

This is the first per-clue-style architecture across SPIKE-008/009/010/011/012 to reach
`SOLVE_UNIQUE` at all — every prior per-clue variant, in every prior spike, scored exactly 0/14.
Gradable rate (67-76%) is also the highest yet for a per-clue variant, exceeding SPIKE-011's
post-fix `per-clue`'s 8/14 (57%) and `per-clue+reconcile`'s 9/14 (64%). Cost stays two orders of
magnitude below `full-critic` even at 3x the sampling (n=3 here vs. n=1 for the baseline).

**`MATCH` is 1/42 per variant (corrected above), not exactly 0/42** — a single genuinely correct
extraction (PZL-0003, §5.2), out of 84 total attempts (both variants combined). SPIKE-011 §5.1's
own warning about conflating "gradable" with "correct" still applies with almost full force to
this spike's own `SOLVE_UNIQUE` number: reaching a uniquely-solvable model is necessary but not
sufficient, and this design's `SOLVE_UNIQUE` gains convert into a `MATCH` gain in exactly one case
in this sample, not zero.

### 5.2 Every `SOLVE_UNIQUE` lands on the SAME non-MATCH class `full-critic` also gets — never a puzzle `full-critic` gets wrong

Per-puzzle detail (raw JSON has all 3 reps per cell):

| Puzzle | `graph-pipeline` `SOLVE_UNIQUE` rate | Grade when unique | `full-critic` baseline |
|---|---|---|---|
| PZL-0022 (COP) | 2/3 | `FEASIBLE_ONLY` (same class as baseline) | `SOLVE_MULTIPLY_SATISFIABLE`/`FEASIBLE_ONLY` |
| PZL-0015 (non-problem, no decline mechanism) | 3/3 | `UNDECLINED` (same class as baseline) | `SOLVE_UNIQUE`/`UNDECLINED` |
| PZL-0003 (Rock Paper Scissors) | 1/3 | `MISMATCH` → corrected **`MATCH`** (grader fix, see §5.1's correction note) | `SOLVE_UNIQUE`/`MISMATCH` |
| PZL-0007 (SEND+MORE=MONEY, oracle-repair only) | 0/3 → 1/3 with repair | `MISMATCH` (genuinely broken extraction — empty `domains`/`constraints` — confirmed unaffected by the grader fix) | `SOLVE_UNIQUE`/`MISMATCH` |

Every single `SOLVE_UNIQUE` this design reaches lands on the exact same outcome class
`full-critic` already reaches for that same puzzle, **except PZL-0003 (corrected above), where
this design now grades `MATCH`** — `FEASIBLE_ONLY` for the one COP puzzle, `UNDECLINED` for the
one non-problem puzzle with no decline mechanism, `MISMATCH` for the one still-genuinely-wrong
determinate puzzle (PZL-0007). Whether this is a case where the design gets right something
`full-critic` gets wrong is unclear, not confirmed: re-checking `full-critic`'s own PZL-0003
baseline against the fixed grader, it's STILL `MISMATCH` ("missing tokens: Paper") — but for a
reason the case-fold fix doesn't touch. `full-critic`'s extraction models PZL-0003 with two
entities (`you`/`opponent`), so `recoverEntityKeyedArrays` turns the solved `move` array into a
two-key entity-keyed object; `gradeFlatRecord`'s token collection only unwraps a SINGLE-key
nested record, so a two-key one is silently skipped entirely and neither value is ever compared.
(This design's own extraction uses one synthetic entity for the whole scenario, so the same
recovery step produces a single-key object that unwraps fine — incidentally avoiding the bug,
not fixing it.) This is a second, distinct grader/recovery-interaction defect, not yet fixed —
noted here rather than fixed in this pass, and NOT something the case-fold fix (SPIKE-014 §5.7)
addresses. Worse, on the two puzzles where `full-critic` achieves a genuine `MATCH`
(PZL-0004, PZL-0011), this design scores **0/3 `SOLVE_UNIQUE` on both, across both variants** —
strictly regressing on exactly the puzzles that matter most for this comparison. PZL-0004's
failure is the shape-misclassification family already documented in §4 (partially mitigated, not
eliminated, by the retry fix — 0/3 `SOLVE_UNIQUE` even after it); PZL-0011 (Loan Review, the
chained-derived-rule puzzle RFC-003 §7.6 already flagged as a boundary case) fails with
`COMPILE_FAILED`/`SOLVE_UNSATISFIABLE`/`SOLVE_ERROR` across its 6 attempts, never gradable at all.

### 5.3 PZL-0001 (the hardest, largest catalog puzzle) never once reached a gradable state — 0/6 across both variants, all 6 attempts `COMPILE_FAILED`

Confirms §4's dry-run finding was not a one-off: all three `graph-pipeline` reps and all three
`graph-pipeline+oracle-repair` reps failed to compile, `oracle-repair`'s 0 repair rounds on every
attempt confirming the same `linkedAttributes`-arity blind spot named in §4 recurs consistently
on this specific puzzle, not just once.

### 5.4 `oracle-repair` raises gradable rate but not `SOLVE_UNIQUE`/`MATCH`

`graph-pipeline+oracle-repair`'s gradable rate (76%) exceeds plain `graph-pipeline`'s (67%) — repair
rounds fired most heavily on PZL-0002, PZL-0018, PZL-0010 (2 rounds each, every rep) — but
`SOLVE_UNIQUE` stayed identical (6/42 both) and `MATCH` stayed at 1/42 for both (corrected, §5.1).
This mirrors
SPIKE-008 §5.4's own finding about the grounded-revision critic (recovers some puzzles from an
ungraded failure into a graded-but-still-wrong state, without moving genuine correctness) —
the SAME critic module (`groundedFinding`, reused unchanged here), doing the same thing, on a
structurally different pipeline.

## 6. Conclusion

> **Correction (2026-09-16):** a grader token-normalization gap, found and fixed in SPIKE-014
> (§5.7 there), was regraded across this spike's own results too. `MATCH` moved from an exact
> 0/42 to **1/42 for both variants** (§5.1) — real, but small: the headline "zero progress on
> `MATCH`" below is now "near-zero, not exactly zero," and does not change this section's overall
> conclusion. Whether this design also out-performs `full-critic` on that one puzzle is genuinely
> unclear, not confirmed — see §5.2's own correction note for a second, distinct, still-open
> grader/recovery-interaction defect found while checking this.

**Real, first-of-its-kind progress on one axis (`SOLVE_UNIQUE`, 0/14 → 6/42), near-zero progress
on the axis that actually matters (`MATCH`, 0/14 → 1/42, corrected above).** This spike's central
question (§1) was whether the inventory→group→shape→per-clue-typing→oracle-repair redesign —
never letting a model type a free-text identifier, splitting "which kind" from "fill the slots"
into two calls — would raise `SOLVE_UNIQUE`/`MATCH` above the 0/14 every prior per-clue variant
scored. It partially does (§5.1): this is the first per-clue-shaped architecture across five
spikes to reach `SOLVE_UNIQUE` at all, and its gradable rate is the highest yet measured for this
architecture family. `MATCH` moved only marginally (0/14 → 1/42, corrected), and every
`SOLVE_UNIQUE` this design reaches except one (§5.2) lands on a puzzle and outcome class
`full-critic` already reaches — this design has not clearly demonstrated it can get RIGHT
anything `full-critic` gets wrong (its one apparent win, PZL-0003, is confounded by a second,
unfixed grading defect on `full-critic`'s own side — §5.2), and it demonstrably regresses on
the two puzzles `full-critic` gets right in this exact sample.

**On the secondary question (§1): the "never type an identifier" design closed the specific
collision class it targeted, cleanly, at the cost of a new failure surface at the boundary
(shape misclassification cascading into a pre-existing, unrelated fallback gap in reused code) —
found live, fixed within the same pass, and confirmed by re-running the dry-run.** No SPIKE-009-
style identifier-collision failures (casing, cross-domain reference, duplicate-name collisions)
appeared anywhere in the full sweep's raw records — a genuine, structural win consistent with
this design's own premise, distinct from and not contradicted by §5.1/§5.2's flat `MATCH` result.

**What this means for RFC-003's decision**: neither `full-critic` (expensive, no per-clue
decomposition benefit) nor any per-clue variant across five spikes (cheap, but zero `MATCH`
wins independent of `full-critic`) is currently a complete answer. The honest reading of all five
spikes together is that **vocabulary-stage non-determinism (SPIKE-004's original finding) remains
the dominant unsolved problem**, now confirmed to persist even when vocabulary construction is
split across three separate, more constrained calls (inventory/group/shape) rather than one
(§5.3's PZL-0001 fragmentation, §5.2's PZL-0004 near-miss) — narrowing what each call is ASKED
does not, on its own, make the ANSWER more reliable across repeated sampling.

**Recommended next steps, in order**:
1. **Do not draft an RFC-003-superseding ADR yet** — same conclusion SPIKE-011 reached, now
   doubly confirmed: zero `MATCH` wins from this architecture either, despite real investment in
   its most promising redesign.
2. **The `full-critic` vs. per-clue-architecture question may be the wrong frame.** Every spike
   in this line (008-012) has varied HOW constraints are extracted per clue while inheriting
   whatever vocabulary-construction approach came before it. Given vocabulary-stage
   non-determinism is now confirmed as the common thread across every variant regardless of
   downstream architecture, a more promising next spike would isolate vocabulary construction
   ITSELF as the sole independent variable — e.g., n≥5 repeated samples of JUST the
   inventory→group→shape stages (no constraint extraction at all) against a fixed answer-key
   vocabulary shape, to directly measure how often shape's entity-axis/domain-values
   classification is actually correct, independent of everything downstream that depends on it.
3. **Fix the two named, narrow gaps before any further measurement build on this pipeline**:
   `oracle-repair.ts`'s clue-localization blind spot for non-quoted `CompileError`s (§4/§5.3),
   and SPIKE-008's own `tool-call.ts` never validating `minItems` client-side (the root cause
   PZL-0001's `linkedAttributes` failures trace to) — both are small, mechanical fixes with a
   clear specification, unlike the harder vocabulary-modeling question above.
4. **Step 8 (selective back-translation), deferred in §4, is not worth building next** on this
   evidence — a critic downstream of an unreliable vocabulary can only ask for a redo against
   that same vocabulary (SPIKE-009 §5.4's own finding, still standing), and §5.4 shows the
   already-built oracle-repair critic doesn't move `MATCH` either.

Status: done.
