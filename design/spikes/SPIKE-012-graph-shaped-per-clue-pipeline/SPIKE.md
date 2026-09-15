---
id: SPIKE-012
title: Graph-Shaped Per-Clue Pipeline (Inventory → Group → Shape → Template-Typed Clues → Oracle Repair)
status: in-progress
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
