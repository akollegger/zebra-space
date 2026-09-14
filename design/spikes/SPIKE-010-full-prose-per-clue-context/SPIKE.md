---
id: SPIKE-010
title: Full-Prose Context for Per-Clue Extraction
status: done
rfcs: [RFC-003]
created: 2026-09-14
---

# SPIKE-010: Full-Prose Context for Per-Clue Extraction

## 1. Question

RFC-003: SPIKE-008 and SPIKE-009 both extract constraints via one forced-tool-call per clue, but
each call sees only that clue's own text. Both spikes' remaining failures trace to the same
cross-clue-blindness root cause: a per-clue call can't tell when a fact needs information from
OTHER clues to resolve correctly (SPIKE-008: `adjacency` constraints needing a shared ordering
domain never declared from a single clue's text; a domain modeled scalar when it needed to be
entity-indexed). SPIKE-009 tested fixing this via deterministic cross-clue vocabulary
reconciliation — it closed the two originally-targeted cases but introduced a new, diffuse
identifier-collision failure surface, netting roughly flat overall.

Does giving per-clue constraint-extraction calls the FULL PUZZLE PROSE as context (instead of
only their own clue's text), while keeping SPIKE-008's proven granular/enum-scoped
forced-tool-call mechanism otherwise unchanged (one global vocabulary call, no reconciliation
step), close the cross-clue-blindness failures more robustly than SPIKE-009's reconciliation
approach — and without introducing an identifier-collision regression, since there's no separate
per-clue vocabulary-proposal/merge step to collide?

## 2. Method

Reuse `design/spikes/SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/`'s existing
`extractPerClue` mechanism (stage-1 whole-prose vocabulary call, `generateClueTools`,
`requestClueConstraints` with a structural-repair round) unchanged, except for exactly one
thing: each per-clue call's user prompt carries the full puzzle prose (every clue's text) with
the target clue called out, instead of only that clue's own text. New code lives under
`design/spikes/SPIKE-010-full-prose-per-clue-context/scripts/lib/full-prose-extract.ts`. Compare
only against SPIKE-008's already-recorded `per-clue` baseline (same 14-puzzle sample, same
`gradeSolved`/`recoverEntityKeyedArrays` grading, reused unchanged) — not also SPIKE-009's
reconcile variant, to keep this a clean single-variable diff.

## 3. Time-box

1 day.

## 4. Notes

_(dated log, appended as work proceeds)_

- **2026-09-14**: Built `scripts/lib/full-prose-extract.ts` — a copy of SPIKE-008's
  `extractPerClue` with exactly one change: `fullProseClueSystemPrompt` shows the full numbered
  clue list (target clue marked `<-- TARGET`) instead of only the target clue's own text; the
  user prompt collapses to `"Extract the constraint(s) asserted by clue [N]."` since the puzzle
  content now lives in the system prompt. Confirmed offline (zero cost) via
  `smoke-test-full-prose-prompt.ts`: the assembled prompt contains every clue's text plus an
  unambiguous, correctly-placed target marker. `run-comparison.ts` mirrors SPIKE-009's shape —
  reads SPIKE-008's `per-clue` baseline JSON directly, runs only this variant live.
- **2026-09-14**: Ran the full 14-puzzle billed comparison (no separate dry-run subset — went
  straight to the full sample per the user's instruction). Result:
  `results/comparison-2026-09-14T16-52-28-634Z.json`. Total: 83 calls / $0.0491, vs. the
  `per-clue` baseline's 77 calls / $0.0312 for the same 14 puzzles (~1.08x the calls, ~1.57x the
  cost — consistent with the estimate: same call count, longer per-call prompts). Gradable rate
  8/14 → 9/14, but **passes stayed flat at 2/14** — every newly-gradable puzzle graded
  `MISMATCH` (wrong answer), not a match. The two puzzles SPIKE-008 originally targeted did
  **not** close: PZL-0001 still `COMPILE_FAILED` with the identical missing-shared-ordering-
  domain message; PZL-0010 still fails, though its failure mode changed from `COMPILE_FAILED`
  (entity-indexing complaint) to `SOLVE_ERROR` (a MiniZinc "identifier already defined" type
  error) — inconclusive on whether the entity-indexing question itself is fixed, since stage 1's
  vocabulary call is non-deterministic across runs and this run's failure is a different shape.
  Three puzzles regressed from gradable to `N/A` (PZL-0007, PZL-0018, PZL-0022), all via the
  same "identifier already defined" MiniZinc type error — this is stage-1 vocabulary
  occasionally emitting two domains whose sanitized names collide, a pre-existing `compile.ts`-
  level risk unrelated to this spike's actual change (stage 1 is byte-identical code to
  SPIKE-008's), just newly exposed by a different random vocabulary sample this run happened to
  draw.
- **2026-09-14 (PR #29 review)**: Kilo Code Review flagged a real prompt-clarity issue —
  `fullProseClueSystemPrompt` marked the target clue with a bracketed `[0]`/`[1]`/`[2]` index, a
  SECOND, 0-based numbering scheme shown alongside each clue's own pre-existing 1-based
  `"1. "`/`"2. "` prefix (from `splitClues`), risking the model conflating the two. Fixed by
  dropping the separate index scheme entirely — the target is now marked inline, right after its
  own existing clue text (`"...  <-- TARGET"`), with no second numbering introduced. This is a
  prompt-formatting clarity fix only, not a mechanism or vocabulary-stage change; not re-run
  live, since the recorded findings (§5/§6) concern the vocabulary-stage/per-clue-call boundary
  the fix doesn't touch, not target-identification ambiguity (the smoke test already confirmed
  the model-facing marker was structurally unambiguous before this fix, just needlessly noisy).
  Two other Kilo suggestions (hardcoded baseline path, `unknown[]` record typing in
  `run-comparison.ts`) were left as-is — both match SPIKE-009's own precedent for this
  deliberately small, disposable spike-code convention; see PR #29's review-comment replies.

## 5. Findings

Full run: `results/comparison-2026-09-14T16-52-28-634Z.json`, 14 puzzles, model
`openai/gpt-4o-mini`, compared against SPIKE-008's already-recorded `per-clue` baseline
(`design/spikes/SPIKE-008-per-clue-tool-call-decomposition/results/comparison-2026-09-14T14-05-07-883Z.json`).

**Cost**: 83 calls / $0.0491 total, vs. baseline's 77 calls / $0.0312 — ~1.08x the call count
(occasional extra repair rounds), ~1.57x the cost (longer per-call prompts from carrying the
full prose instead of one clue). Both remain two orders of magnitude cheaper than `full-critic`
(~$2.10/14 puzzles, worst-case call count).

**Outcome-class transitions, per-clue baseline → per-clue+full-prose**:

| Puzzle | Baseline outcome (grade) | Full-prose outcome (grade) | Direction |
|---|---|---|---|
| PZL-0002 | COMPILE_FAILED (N/A) | SOLVE_UNSATISFIABLE (MISMATCH) | → gradable, wrong |
| PZL-0004 | SOLVE_UNSATISFIABLE (MISMATCH) | SOLVE_MULTIPLY_SATISFIABLE (MISMATCH) | unchanged (wrong) |
| PZL-0022 | SOLVE_MULTIPLY_SATISFIABLE (FEASIBLE_ONLY) | SOLVE_ERROR (N/A) | regressed |
| PZL-0028 | SOLVE_MULTIPLY_SATISFIABLE (READING_MATCHED) | SOLVE_MULTIPLY_SATISFIABLE (READING_MATCHED) | unchanged (pass) |
| PZL-0033 | SOLVE_MULTIPLY_SATISFIABLE (PREMISE_FREE_MATCH) | SOLVE_MULTIPLY_SATISFIABLE (PREMISE_FREE_MATCH) | unchanged (pass) |
| PZL-0038 | SOLVE_ERROR (N/A) | SOLVE_MULTIPLY_SATISFIABLE (MISMATCH) | → gradable, wrong |
| PZL-0015 | SOLVE_MULTIPLY_SATISFIABLE (UNDECLINED) | SOLVE_MULTIPLY_SATISFIABLE (UNDECLINED) | unchanged |
| PZL-0018 | SOLVE_MULTIPLY_SATISFIABLE (UNDECLINED) | SOLVE_ERROR (N/A) | regressed |
| PZL-0001 | COMPILE_FAILED (N/A) | COMPILE_FAILED (N/A) | **unchanged — not fixed** |
| PZL-0003 | SOLVE_ERROR (N/A) | SOLVE_UNSATISFIABLE (MISMATCH) | → gradable, wrong |
| PZL-0007 | SOLVE_UNSATISFIABLE (MISMATCH) | SOLVE_ERROR (N/A) | regressed |
| PZL-0010 | COMPILE_FAILED (N/A) | SOLVE_ERROR (N/A) | **unchanged — not fixed** (different crash shape) |
| PZL-0011 | SOLVE_UNSATISFIABLE (MISMATCH) | SOLVE_UNSATISFIABLE (MISMATCH) | unchanged (wrong) |
| PZL-0012 | SOLVE_ERROR (N/A) | SOLVE_UNSATISFIABLE (MISMATCH) | → gradable, wrong |

Gradable rate: 8/14 → 9/14 (four puzzles newly gradable — PZL-0002/0003/0012/0038 — against
three regressions to `N/A` — PZL-0007/0018/0022). **Passes: flat at 2/14** (PZL-0028, PZL-0033,
both unchanged) — every newly-gradable puzzle graded `MISMATCH`, not a match against the answer
key.

**The two originally-targeted failures did not close.** PZL-0001 fails with the identical
message as SPIKE-008's baseline: `"Could not find a single numeric positional domain shared by
... for adjacency relation ..."`. PZL-0010 still fails, though its failure mode shifted from a
`compile.ts`-level entity-indexing complaint to a MiniZinc `"identifier ... already defined"`
type error — inconclusive on whether the original entity-indexing defect is actually fixed,
since stage-1 vocabulary generation is non-deterministic across runs and this run drew a
different vocabulary shape than the recorded baseline run.

**A collision failure mode also appears here** (PZL-0007, PZL-0010, PZL-0018, PZL-0022, all
`"identifier ... already defined"`), superficially resembling SPIKE-009's identifier-collision
regression — but the mechanism is different: SPIKE-009's collisions came from concatenating
disambiguation suffixes across independently-reconciled per-clue vocabulary proposals (code this
spike doesn't have at all). Here, stage 1 is byte-identical to SPIKE-008's single one-shot
vocabulary call — the collision is the LLM occasionally naming two distinct domains such that
their sanitized identifiers coincide, a latent `compile.ts`-adjacent risk in the underlying
mechanism itself (present in SPIKE-008 too, just not triggered by that particular run's
vocabulary sample) rather than something this spike's full-prose change introduced.

## 6. Conclusion

Giving per-clue constraint-extraction calls the full puzzle prose, while leaving vocabulary
decided by the same single one-shot global call SPIKE-008 uses, **does not close the
cross-clue-blindness failures** SPIKE-008 and SPIKE-009 both targeted. The reason is structural,
not a tuning problem: both PZL-0001 (a missing shared ordering domain) and PZL-0010 (a domain
that needs to be entity-indexed rather than scalar) are *vocabulary*-level decisions, and stage 1
still commits to a vocabulary **before any clue-level call — full-prose or not — ever runs**.
Showing the full prose to the per-clue constraint call lets that call reference other clues'
*content*, but it cannot retroactively add a domain stage 1 never declared, or reclassify a
domain stage 1 already called scalar — the per-clue call only picks a tool and fills its
already-fixed enum-scoped arguments; it has no mechanism to revise the vocabulary itself. This is
a genuinely informative negative result: it rules out "just add more context to the existing
call shape" as a fix, and narrows the real fix to one that lets vocabulary itself be revised
using cross-clue evidence — which is exactly what SPIKE-009's reconciliation pass attempted (and
found roughly-flat-but-not-worse results for, via a different failure surface).

Net effect vs. SPIKE-008's baseline: gradable rate improved marginally (8/14 → 9/14) at ~1.6x
the cost, but with **zero improvement in actual correctness** (passes flat at 2/14) — the
gradable-rate gain is fully explained by puzzles moving from a hard crash to a wrong-but-gradable
answer, not by anything being solved correctly that wasn't before. Combined with SPIKE-009's
similarly-flat result, this sample's two originally-targeted failures (PZL-0001, PZL-0010) have
now resisted two structurally different fixes — full-prose-context (this spike) and
deterministic-reconciliation (SPIKE-009) — without closing. Recommended before an ADR commits to
either direction:

1. Treat "vocabulary must be revisable using cross-clue evidence, not just decided once
   up-front" as the confirmed root cause requiring a fix, since both a context-widening approach
   and a reconciliation approach were tried and both left it unresolved.
2. A more promising next candidate, not yet tried: let the per-clue constraint call (with full
   prose, as built here) *propose a vocabulary revision* when it can't express what a clue needs
   within the existing enum-scoped tools, rather than either trusting the original vocabulary
   unconditionally (SPIKE-008/010) or reconciling independently-proposed local guesses ex ante
   (SPIKE-009) — i.e., push the revision decision to the point where a clue's actual failure to
   fit the vocabulary is directly observed, not before.
3. The recurring `compile.ts`-adjacent "identifier already defined" collision (seen independently
   in this spike's stage-1 vocabulary and in SPIKE-009's reconciled vocabulary) suggests
   `compile.ts` itself should defensively detect and rename colliding sanitized identifiers at
   compile time, regardless of which extraction architecture produced them — a fix at that layer
   would harden every candidate approach simultaneously rather than being re-solved per spike.
