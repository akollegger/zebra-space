---
id: SPIKE-015
title: Domain Substitution as a Cheaper, Verifiable Generation Task
status: planned
rfcs: [RFC-001]
created: 2026-09-18
---

# SPIKE-015: Domain Substitution as a Cheaper, Verifiable Generation Task

## 1. Question

RFC-001 §9.2 ("Catalog modification") names this strategy's central open risk: "naive
substitution risks breaking uniqueness, so this strategy implicitly depends on some validation
step... rather than guaranteeing correctness by construction" — never actually measured, only
asserted. RFC-001 §7.5 separately asks how regression testing ("did a known puzzle still get
solved correctly?") should be kept distinct from generalization testing ("is the solver actually
reasoning, or recalling?"), and names catalog modification as suited to the latter — also
unmeasured. **This spike answers both at once**: given an existing, already-verified-correct
puzzle, can an LLM reliably substitute its domain values (e.g. colors → drinks, nationalities →
professions) while preserving the constraint structure and unique solvability, cheaply enough
and reliably enough to serve as (a) a validated way to grow the catalog per RFC-001 §9.1's
"dataset value" framing, and (b) a memorization-probe mechanism per §7.5?

**Motivating context from a sibling problem (RFC-003, not a parent of this spike)**: SPIKE-014
found LLMs are much better at *solving* a zebra puzzle in free prose (64-93% MATCH) than at
*formalizing* one into MiniZinc (26-48% MATCH), and that gap is mostly not explained by whether a
prior solve trace is available (SPIKE-014 §5.10). That motivates asking a different question here
— not "how do we get an LLM to formalize better," but "is there an easier, more mechanical task
an LLM is good at that still produces verified content?" Domain substitution is a candidate:
a bijective relabeling (swap every occurrence of one closed set of values for another,
same-arity set) rather than a multi-step deduction task, so it's plausibly cheaper and more
reliable than either solving or formalizing — but it inherits a known risk this project has
already fought once: SPIKE-011/012 found that letting a model freely retype an identifier (color
name, entity id, ...) rather than choose/copy an existing span is exactly where consistency
breaks (typos, missed occurrences, accidental collisions). This spike's method (§2) is designed
specifically to avoid that failure mode rather than repeat it.

## 2. Method

1. **Select seed puzzles with an already-known-correct MiniZinc model** — reuse
   SPIKE-014's own `formalize-mzn` `MATCH` results (e.g. PZL-0002, PZL-0004, PZL-0007's
   `results/*.json` records) rather than authoring anything new. Having a verified `.mzn` for the
   ORIGINAL puzzle is what makes near-free ground truth possible for the SUBSTITUTED puzzle (see
   step 3).
2. **Ask the model for a substitution MAPPING, not a free rewrite** — a forced, structured
   output: one `{domain, oldValue, newValue}` entry per domain value actually used in the puzzle
   (e.g. `{domain: "color", oldValue: "Red", newValue: "Coffee"}`), covering every value in every
   domain the puzzle uses. The model never retypes puzzle prose directly; code applies the
   mapping. This is the deliberate fix for the SPIKE-011/012 failure class named in §1 — the
   model chooses *values*, code performs the *substitution*.
3. **Apply the SAME mapping mechanically, in code, to two independent targets**:
   - The puzzle prose (find-and-replace every occurrence of each `oldValue` with its `newValue`).
   - The already-known-correct `.mzn` model's enum members (same find-and-replace, on the
     `enum ... = { ... };` declarations only).
   Solving the mechanically-substituted `.mzn` (via `src/solver/solve.ts`, already exists, no new
   code) yields the substituted puzzle's TRUE answer — at **zero additional LLM cost**, since
   nothing had to solve or formalize the new puzzle to get it.
4. **Verify independently**: run `direct-solve` (already exists, ADR-008) and/or `direct-mzn`
   (SPIKE-014 §5.10, already exists) on the NEW, substituted prose — with NO knowledge of the
   mapping or the mechanically-derived answer — and grade its result against that mechanically-
   derived true answer using the existing grader (`src/eval/grader.ts`). Repeat n reps per seed
   puzzle to measure how consistently the *substitution* step itself produces a well-formed,
   equally-determinate puzzle (mapping covers every value exactly once, no accidental collision,
   substituted prose remains grammatical and unambiguous) versus how often re-solving the result
   fails for reasons unrelated to substitution at all.
5. **Cost/reliability comparison**: record cost per rep for the substitution call alone (expected
   cheap — a short structured mapping, not a full puzzle solve or formalization) against
   SPIKE-014's own recorded `direct-solve`/`formalize-mzn`/`direct-mzn` costs, to test the "easier
   and cheaper than formalizing" hypothesis directly rather than assume it.

## 3. Time-box

**Half a day (~4 hours)** for the first pass: ~1h build the mapping-request prompt + mechanical
apply/verify harness (reusing `solve()`, `direct-solve`, `direct-mzn`, and the existing grader —
no new solving/formalizing code, only the substitution+apply step is new); ~30min offline smoke
test (hand-constructed mapping applied to a known `.mzn`, verify it still solves to the expected
substituted answer, zero LLM cost); ~1h live dry run on 1-2 seed puzzles (n=2-3) to confirm the
mechanism end-to-end and catch prompt issues before spending on a full sweep; ~1.5h full sweep
(cost-estimated before running, matching this project's standing cost-then-go-ahead discipline)
and write-up. Hard stop regardless of completeness — a specific failure mode needing more
prompt-engineering than this budget allows is itself a finding, not a reason to blow through the
box.

## 4. Notes

_(kept during the work — see SPIKE-014's Notes section for the convention this follows: one
dated entry per decision or observation worth keeping, written at the time, not reconstructed
afterward)_

**2026-09-18 — scoped as the first of an expected family of variants.** The user anticipates
several variations on this core idea (analogous to how SPIKE-014 accumulated 10 variants over
its lifetime) — e.g. substituting more than one domain at once, substituting on puzzles WITHOUT
an already-known-correct `.mzn` (removing the free-ground-truth shortcut), or using repeated
samples of the same substitution request to separate "signal" (structurally-required renamings)
from "noise" (incidental phrasing variance) in a diffusion-like way, per the user's own framing.
This spike's §1-§3 scope the CORE mapping-based mechanism only; later variants should be folded
into this same document (new `##2` method sub-points, dated `##4` notes, numbered `##5` findings
subsections) rather than spawning new spike IDs, matching SPIKE-014's own established pattern —
see that spike's own `Did you suggest SPIKE-015 to test me?` exchange for why this project treats
"a new angle on the same underlying question" as a variant, not automatically a new spike. (This
spike itself IS a new spike, not a SPIKE-014 variant, because it answers a genuinely different
RFC's open question — RFC-001 §9.2/§7.5, not RFC-003's formalization-representation question —
not because a new idea always warrants one.)

## 5. Findings

_(to be filled in once the spike runs)_

## 6. Conclusion

_(to be filled in once the spike runs)_
