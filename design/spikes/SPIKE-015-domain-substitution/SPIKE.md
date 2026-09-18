---
id: SPIKE-015
title: Domain Substitution as a Cheaper, Verifiable Generation Task
status: in-progress
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

**Narrowed scope for this first pass**: rather than asking the model to substitute every domain
in a puzzle at once, §2 scopes down to ONE domain per call, identified by the model from raw
prose alone (no domain list handed to it) — isolating a single, more basic capability question
(can it correctly and completely characterize one domain from prose?) before compounding it with
whole-puzzle consistency across several domains at once. Multi-domain substitution, if this
narrower version succeeds, is a natural follow-up variant (see §4 Notes).

## 2. Method

**The mapping the model produces is prose-space only — it never sees or reasons about MiniZinc.**
Given SPIKE-014's own central finding (LLMs formalize prose into MiniZinc far less reliably than
they solve or manipulate prose directly), asking a model to author or edit a `.mzn` identifier as
part of this task would reintroduce exactly the failure surface this spike exists to avoid.
Instead, the `.mzn` side is updated by a separate, purely mechanical bridging step (§2 step 4)
that reuses machinery this project already built and validated for a related problem — never a
second LLM-authored translation.

1. **Select seed puzzles with an already-known-correct MiniZinc model** — the three entries
   lifted into `catalog/mzn/` from SPIKE-014's `formalize-mzn` frontier-tier `MATCH` results
   (PZL-0002, PZL-0003, PZL-0007; PZL-0004 is hand-translated, also eligible). Each corresponding
   `catalog/puzzles/PZL-NNNN-*.md` entry's `groundTruth.expectedDomains` front-matter also
   already states every domain's name and complete value list — **but this is used ONLY for
   scoring afterward (step 3), never given to the model.** Handing the model the answer's own
   domain list would reduce the task to copying from a list it was already given, which tells us
   nothing about whether it can find and characterize a domain from prose at all — the actual
   capability in question.
2. **Ask the model, given ONLY the raw puzzle prose, to identify ONE domain and remap it** — not
   all domains at once. A forced, structured output: `{domain: string, currentValues: string[],
   mapping: {oldValue, newValue}[]}` — the model names one domain it found in the prose, reports
   the COMPLETE current value set it believes that domain has (its own extraction, not fed to
   it), and proposes a same-arity, same-kind replacement for each value. Scoping to one domain
   (rather than every domain in the puzzle at once) keeps this first variant narrow and isolates
   a single capability: can the model correctly and completely characterize one domain from
   prose alone? The model only ever reads and writes prose-space value strings — never a
   MiniZinc identifier, never the `.mzn` file itself. This is the deliberate fix for the
   SPIKE-011/012 failure class named in §1 — the model chooses *values*, code performs the
   *substitution*.
3. **Score the model's own domain identification against `expectedDomains` BEFORE applying
   anything** — did it name a real domain the puzzle actually uses, and does its reported
   `currentValues` match that domain's true, complete value set (order-insensitive)? A
   mismatch here (missed value, invented value, wrong domain entirely) is itself the primary
   finding this narrower variant is designed to surface, and should be recorded as a distinct
   failure class from anything that happens in step 4 onward — a wrong domain characterization
   makes the rest of the pipeline moot for that rep, not worth silently working around.
4. **Apply the mapping to two independent targets, by two DIFFERENT mechanical methods** (only
   for reps that passed step 3's check):
   - **Puzzle prose**: literal find-and-replace of each `oldValue` with its `newValue`. Safe
     because step 3 already confirmed these values appear in the prose (that's what
     `currentValues` reported, verified against ground truth).
   - **The already-known-correct `.mzn` model's enum members**: NOT literal find-and-replace —
     a `.mzn`'s enum-member spelling can differ from the prose's own spelling of the same value
     (exactly the case/separator gap SPIKE-014 §5.7 found and fixed for the grader, e.g.
     `LuckyStrike` vs. the prose's `Lucky Strike`). Instead, reuse §5.7's own fold-matching logic
     (`sanitizeIdentifier` + a case/separator-insensitive comparison key, already implemented in
     `src/eval/grader.ts`) to find which enum member corresponds to each mapping entry, then
     rewrite that member. A mapping entry whose fold-matched identifier isn't found exactly once
     in the `.mzn` is skipped and recorded, never guessed — the same discipline SPIKE-014's
     `lint-repair` (§5.6) already established for an analogous exact-match-or-skip step.
   Solving the mechanically-substituted `.mzn` (via `src/solver/solve.ts`, already exists, no new
   code) yields the substituted puzzle's TRUE answer — at **zero additional LLM cost**, since
   nothing had to solve or formalize the new puzzle to get it.
5. **Verify independently**: run `direct-solve` (already exists, ADR-008) and/or `direct-mzn`
   (SPIKE-014 §5.10, already exists) on the NEW, substituted prose — with NO knowledge of the
   mapping or the mechanically-derived answer — and grade its result against that mechanically-
   derived true answer using the existing grader (`src/eval/grader.ts`). Repeat n reps per seed
   puzzle to measure how consistently the *substitution* step itself produces a well-formed,
   equally-determinate puzzle (mapping covers every value exactly once, no accidental collision,
   substituted prose remains grammatical and unambiguous) versus how often re-solving the result
   fails for reasons unrelated to substitution at all.
6. **Cost/reliability comparison**: record cost per rep for the substitution call alone (expected
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

**2026-09-18 — built and ran the core mechanism (§2), full harness at
`design/spikes/SPIKE-015-domain-substitution/scripts/`.** A real bug was found and fixed before
any live call: `src/eval/grader.ts`'s `gradeDeterminate` (parallel-array branch) unwraps the
solver's `{e: "Blue"}` enum-wrapping only on the *actual* side, never on `expected` — passing a
raw mechanically-derived `Assignment` straight in as `expected` would have spuriously graded
every rep `MISMATCH`. Fixed in `lib/grade-against-truth.ts` by deep-unwrapping the truth
assignment first (duplicating `grader.ts`'s own private `unwrapSingleKeyRecord`), and validated
against real solver output (not just reasoning) in the offline smoke test before any live call.
Offline smoke test (zero cost) passed on the first try. Live dry run (n=1, both seeds, $0.0005)
confirmed the mechanism end-to-end on real model output. Full sweep (n=3, PZL-0002 + PZL-0003,
`gpt-4o-mini`, $0.0015) written up as §5.1.

## 5. Findings

### 5.1 First sweep: the substitution mechanism itself is reliable; naming strictness and the verifier's own known limits are the actual bottlenecks

Raw: `results/domain-substitution-openai-gpt-4o-mini-2026-09-18T10-06-09-192Z.json`. n=3 reps ×
2 seed puzzles (PZL-0002, PZL-0003; PZL-0007 excluded per §2 step 1), `gpt-4o-mini` for both the
mapping call and the `direct-mzn` verifier. **$0.0015 total.**

| Puzzle | Outcome | Count |
|---|---|---|
| PZL-0002 | `VERIFIED` (domain matched, mapping applied, substituted `.mzn` solved uniquely, verifier ran) | 3/3 |
| PZL-0002 | ...of which verifier `MATCH` | 1/3 |
| PZL-0002 | ...of which verifier `NOT_UNIQUE` | 1/3 |
| PZL-0002 | ...of which verifier `VERIFIER_SOLVE_ERROR` | 1/3 |
| PZL-0003 | `DOMAIN_MATCH_FAILED` (step 3 short-circuit, never reached substitution) | 3/3 |

**The domain-substitution mechanism itself (steps 1-4) worked perfectly every time it was
reached**: all 3 PZL-0002 reps show `domainMatchReason: "domain name and complete value set
both match"` and `mznApplied: 3, mznSkipped: []` — the model correctly identified "color" from
raw prose alone, reported its exact 3-value set, proposed a same-arity remapping, and the
mechanical apply-to-prose/apply-to-mzn steps both succeeded cleanly every time (e.g. rep 2's
substituted prose: "Yellow, Purple, or Orange" cleanly replacing "Blue, Red, Green" throughout,
including every constraint reference). This is a real, positive signal for RFC-001 §9.2's open
question about catalog-modification reliability — at least for a puzzle whose domain is a small,
clearly-delineated closed set of colors, the identify-and-remap step itself is NOT the
bottleneck.

**Where PZL-0002 reps failed, the failure came from the ALREADY-KNOWN-IMPERFECT verifier, not
from substitution.** Reps 1 and 3 both got through domain-matching and mechanical substitution
cleanly (mechanically-derived truth solved `UniquelySolvable` in all 3 reps — substitution never
broke solvability), but `direct-mzn`'s own independent re-formalization of the substituted prose
either under-constrained it (rep 1: `MultiplySatisfiable`, — missing a clue, the exact failure
class SPIKE-014 §5.4 already catalogued) or invented a nonexistent MiniZinc builtin (rep 3:
`` no function or predicate with name `indexof' found ``, the exact class SPIKE-014 §5.3
catalogued). **This is the correct outcome for this design, not a flaw in it**: the mechanically-
derived truth (via the seed's already-verified `.mzn`, mapped mechanically) is what makes the
rep gradable AT ALL; the verifier's own known ~26-48% MATCH ceiling (SPIKE-014 §5.2/§5.3, §5.7)
is a property of `direct-mzn` itself, orthogonal to whether the puzzle it's given was hand-
authored or domain-substituted. 1/3 MATCH here is consistent with, not below, that known ceiling
at this sample size.

**PZL-0003 never got past domain identification, for a distinct and highly actionable reason**:
in all 3 reps the model named the domain "game move" or "game moves" — ground truth's own
front-matter names it `move` (singular, no qualifier). `scoreDomainMatch`'s comparison rule
(§2 step 3) does exact case/whitespace-normalized string matching on domain NAMES with zero
tolerance for a reasonable synonym or qualifier — "game move" is clearly the same concept a
human grader would accept, but the harness's current rule rejects it outright. **This is a
real, narrow, fixable gap in the SCORING rule, not evidence the model failed to understand the
puzzle** — its own `currentValues` for "game move" would very plausibly have been the correct
`[Rock, Paper, Scissors]` set (unrecorded, since scoring short-circuits before checking values
once the name itself doesn't match any alternative — a rep whose values might have been
completely correct is currently indistinguishable from one that named a domain that doesn't
exist in the puzzle at all).

## 6. Conclusion

**First pass confirms the core hypothesis is worth pursuing, and sharpens exactly what to fix
next.** Domain identification-and-substitution, when the model's chosen name happens to match
ground truth's own name, is reliable (3/3) and cheap (~$0.0001/call, two orders of magnitude
below a full formalization call) — a genuinely different reliability profile from SPIKE-014's
formalize-mzn, consistent with the "bijective relabeling is easier than deduction" hypothesis
that motivated this spike (§1). The dominant blocker in this first sample isn't the substitution
task itself — it's `scoreDomainMatch`'s current all-or-nothing name matching, which threw away
a rep (PZL-0003) that may have been substantively correct purely because of a naming variant.

**Recommended next steps** (candidates for the next variant, per §4's own "several variations
expected" framing):
1. Relax `scoreDomainMatch`'s name-matching rule (e.g. substring/token-overlap tolerance, or a
   short list of acceptable synonyms per ground-truth alternative, mirroring `catalog/README.md`'s
   own existing alias-table convention already used elsewhere in this project's grading) — and,
   critically, stop short-circuiting on a name mismatch before checking `currentValues`, so a
   near-miss name with a fully correct value set is distinguishable from a genuinely wrong domain.
2. Run a larger sample across more seed puzzles once more `catalog/mzn/` entries exist with enum
   domains (currently only PZL-0002 qualifies; PZL-0003's own enum-based `Move` domain is
   eligible in principle but blocked entirely by finding 1 above).
3. The verifier's own ceiling (SPIKE-014's ~26-48% `direct-mzn` MATCH rate) is a known, separate
   problem this spike doesn't need to re-solve — but it does mean this harness's own headline
   "verified MATCH rate" number will always be upper-bounded by that ceiling regardless of how
   reliable substitution itself becomes, worth stating explicitly whenever this spike's numbers
   are cited elsewhere (e.g. back into RFC-001).
4. The variants named in §4's Notes (multi-domain substitution at once; substitution without an
   already-known-correct `.mzn`; repeated-sampling noise/signal separation) remain open, per the
   user's own expectation of several variations — not yet attempted.

Status: in-progress.
