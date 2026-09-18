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

### 5.2 Relaxed name matching fixed the observed morphological near-misses, but exposed a distinct, deeper limit: true synonym variance

Implemented recommendation 1 from §6 (below, written before this fix): `scoreDomainMatch` now
checks VALUE-SET matches first, independent of name, and accepts a name match via substring
containment (either direction) rather than strict equality — so "game move"/"game moves" against
ground truth's "move" now matches, and a value-exact-match with an unrelated name is reported as
its own distinct, informative near-miss rather than silently indistinguishable from "nothing
matched at all" (both changes validated against real solver output in the smoke test, per this
project's own discipline, before any live call — see the new `near-miss name`/`values match but
name unrelated` smoke-test cases).

Re-ran the identical n=3 × 2-puzzle sweep. Raw:
`results/domain-substitution-openai-gpt-4o-mini-2026-09-18T10-13-27-460Z.json`, **$0.0014**.

| Puzzle | Outcome | This run | Previous run (§5.1) |
|---|---|---|---|
| PZL-0002 | `VERIFIED` (substitution mechanism itself) | 3/3 | 3/3 |
| PZL-0002 | ...verifier `MATCH` | 2/3 | 1/3 |
| PZL-0003 | `DOMAIN_MATCH_FAILED` | 3/3 | 3/3 |

**PZL-0002 is unchanged in the property that matters (substitution mechanism 3/3), with the
verifier's own MATCH count moving 1/3→2/3 — a difference well within noise for two independently-
sampled n=3 runs, not evidence the fix affected PZL-0002 at all** (it targets domain-name
matching, and PZL-0002's own name has always matched exactly). One new distinct verifier failure
shape appeared this run — rep 2's `MISMATCH` ("row mismatch: [cat|orange; dog|yellow; zebra|purple]
!= [cat|purple; dog|yellow; zebra|orange]") is a genuinely WRONG unique answer, not a syntax
error or under-constraint — direct-mzn's own formalization swapped which color went with which
animal. Consistent with SPIKE-014 §5.4's finding that `direct-mzn` can silently land on a
different, wrong, but still-unique answer; not a new problem this spike introduces.

**PZL-0003 is UNCHANGED (3/3 `DOMAIN_MATCH_FAILED`) — but for a genuinely different reason than
before, which is itself the real finding here.** This run's three reps named the domain "action"
(twice) and "game" (once) — neither resembles "move" by substring in either direction, unlike the
previous run's "game move"/"game moves" (where "move" IS a substring of both). The fix's own
reasoning message shows this clearly: `currentValues exactly match a real domain (name(s):
move), but proposed domain name "action" doesn't resemble it` — confirming (not merely assuming)
that the model's `currentValues` WAS correct (`[Rock, Paper, Scissors]`, matched exactly) in all
3 reps this run too; only the name varies.

**This sharpens the diagnosis precisely: there are two distinct kinds of name variance, and
substring containment only closes one of them.** Morphological variance (a qualifier word,
plain pluralization — "game move," "moves") is now handled. Genuine SYNONYM variance (a
different word for the same concept — "action," "game" for what the puzzle prose itself calls a
player's "move") is not, and cannot be, by a purely mechanical string-containment rule — "action"
and "move" share no substring relationship at all despite being reasonable descriptions of the
same domain in this context. Closing this second gap needs either a small hand-curated alias
list per ground-truth alternative (the `catalog/README.md` alias-table convention §6
recommendation 1 already named), or accepting that some fraction of otherwise-correct reps will
always be undercounted by a purely mechanical name check — a real, now precisely-characterized
limit, not an unexamined one.

### 5.3 Migrated to the shared string-equivalence matcher (ADR-011); the ad-hoc substring heuristic is gone, and the real gap needed curation, not more heuristic

§5.2's own recommendation 1 ("a small hand-curated alias list per ground-truth alternative,
mirroring `catalog/README.md`'s own existing alias-table convention") became [ADR-011](../../adr/ADR-011-shared-string-equivalence-matching.md)'s
actual decision, built and merged in a separate branch (`016-string-equivalence-matching`, PR #35).
`scoreDomainMatch`'s own `nameResembles`/`sameSet`/`missingFrom`/`inventedIn` — the local
case/whitespace-only `normalize` plus substring-containment heuristic §5.1/§5.2 built and
iterated on — are replaced with `src/eval/aliases.ts`'s `stringsMatch`, treating
`DomainAlternative.names` (already a curated list of acceptable names per domain) as exactly the
per-puzzle domain-name `AliasTable` ADR-011 §2.2 designed for. This is a straight consequence of
this project's own duplication-avoidance discipline, not new design work here.

Re-ran the identical n=3 × 2-puzzle sweep. Raw:
`results/domain-substitution-openai-gpt-4o-mini-2026-09-18T13-24-52-126Z.json` (before curating
PZL-0003's ground truth), then
`results/domain-substitution-openai-gpt-4o-mini-2026-09-18T13-26-54-252Z.json` (after), **$0.0014
+ $0.0018**.

| Puzzle | Outcome | Before curation | After curating "game move" | §5.2 (substring heuristic) |
|---|---|---|---|---|
| PZL-0002 | `VERIFIED` (substitution mechanism) | 3/3 | 3/3 | 3/3 |
| PZL-0002 | ...verifier `MATCH` | 2/3 | 3/3 | 2/3 |
| PZL-0003 | `DOMAIN_MATCH_FAILED` | 3/3 | 1/3 | 3/3 |

**The shared matcher, used with zero curation, is stricter than the old substring heuristic — by
design, not by regression.** All 3 PZL-0003 reps this run named the domain "game moves" (the
exact combined qualifier-plus-plural phrase ADR-011 §2.1 specifically fixed in
`comparisonKey` itself). But `comparisonKey`'s deterministic fold only closes morphological
variance (case, whitespace, plain pluralization) — a QUALIFIER word ("game") is not part of that
fold, by ADR-011's own explicit design (§2.1: "not a per-value fact that needs curating" applies
to pluralization specifically, not to arbitrary qualifiers). So "game moves" no longer
auto-matches "move" the way the old substring heuristic accepted it — confirmed directly against
the real model output above (`(currentValues exactly match a real domain (name(s): move), but
proposed domain name "game moves" doesn't resemble it)`), not merely predicted from reading the
code.

**Curating `catalog/puzzles/PZL-0003-rock-paper-scissors.md`'s `names: [move]` to
`names: [move, game move]` — the exact mechanism ADR-011 §2.2 designed for this case — closed
the gap for 2 of 3 reps.** Once curated, "game move" is a listed variant, so `comparisonKey`'s
existing pluralization fold makes "game moves" match it "for free" (no separate curation needed
per plural form). The one rep still `DOMAIN_MATCH_FAILED` after curation named the domain
"game" — genuine synonym variance, not morphological, the exact SECOND gap §5.2 already
identified and explicitly said a curated alias list would not close by itself (curating "game
move" doesn't help "game" alone resemble "move" any more than "action" did in §5.2's own second
run) . This is the correct, expected boundary of what curation fixes, not a new finding.

**One PZL-0003 rep that passed domain-matching failed verification for an unrelated reason worth
flagging separately**: rep 3's `direct-mzn` verifier scored `MISMATCH` reporting missing tokens
`lizard, spock` — the verifier appears to have formalized "Rock-Paper-Scissors-Lizard-Spock"
rather than the seed's actual 3-value domain, a `direct-mzn` formalization drift unrelated to
domain-name matching or this migration (SPIKE-014's own known verifier-limitation territory, not
re-litigated here).

**Net effect of this migration**: no case that the old substring heuristic correctly accepted
now regresses (PZL-0002 unaffected; morphological variance still folds, now via the shared
mechanism instead of a local one), one case it accepted only by accident of overlapping
substrings ("game move(s)" containing "move") now requires the explicit one-line curation the
mechanism is designed around, and the codebase gained one fewer independent string-comparison
implementation (ADR-011's own stated goal) at the cost of that one line of curation.

### 5.4 Dropped name-matching as a scoring gate entirely — the real fix, not another curation round

§5.3's curation fix (adding "game move" to PZL-0003's `names`) closed 2 of 3 lost reps but left
one genuine-synonym rep ("game" alone) still `DOMAIN_MATCH_FAILED`, and more curation would only
ever close the specific synonyms someone thought to list in advance. Stepping back: neither
`apply-to-prose.ts` (literal value replace) nor `apply-to-mzn.ts` (fold-matched enum rewrite by
VALUE spelling) ever reads the model's proposed domain NAME at all — both operate purely on the
proposed `currentValues`/`mapping`. Requiring the name to also resemble ground truth was
therefore scoring an artifact of how the model chose to describe its selection in one sentence,
not a property the downstream mechanism depends on. `scoreDomainMatch` now scores matched/not-
matched on value-set equality alone (already the reliable, primary signal per §5.1); the
proposed name is still reported in `reason` for human legibility, but a name that doesn't
resemble ground truth's own name is now informational only and never fails a rep.

Re-ran the identical n=3 × 2-puzzle sweep. Raw:
`results/domain-substitution-openai-gpt-4o-mini-2026-09-18T13-41-27-532Z.json`, **$0.0020**.

| Puzzle | Outcome | This run | §5.3 (curated, name still gated) |
|---|---|---|---|
| PZL-0002 | reaches verification (past domain-matching) | 3/3 | 3/3 |
| PZL-0003 | reaches verification (past domain-matching) | 3/3 | 2/3 |
| Both | `DOMAIN_MATCH_FAILED` | 0/6 | 1/6 |

**Every rep across both seed puzzles now clears domain-matching** — the one remaining
`DOMAIN_MATCH_FAILED` rep from §5.3 (the model named the domain "game" alone, a genuine synonym
no curation had anticipated) now matches on value-set alone, exactly as intended: its
`currentValues` was correct, so it should never have been thrown away over wording. This closes
the second gap §5.2/§5.3 both identified and said curation alone could not close — not by adding
more curated synonyms, but by recognizing the check didn't need to exist.

**The reps that still fail this run fail for reasons entirely unrelated to domain-name or value-
set identification** — all in `direct-mzn`'s own re-formalization of the substituted prose, the
same known-imperfect-verifier territory §5.1/§5.3 already catalogued: PZL-0002 rep 2 hit a
`ModelSyntaxError` (an invented enum member `Zebr`, a typo/truncation in the verifier's own
generated model); PZL-0003 reps 1 and 3 came back `Unsatisfiable`/`MultiplySatisfiable`
(under/over-constrained re-formalizations); rep 2 scored `MISMATCH` on unexpected tokens
`water, fire` — the verifier appears to have formalized a different rock-paper-scissors-style
variant than the seed's actual 3-value domain, distinct from §5.3's rep-3 `lizard, spock`
instance but the same underlying phenomenon (the verifier occasionally drifts to a related but
different value set when re-formalizing from prose alone, independent of anything this scoring
change touches).

### 5.5 Replaced the direct-mzn verifier with a well-formedness critic — and it immediately caught a real substitution bug

`direct-mzn` re-formalization was itself pure noise for this spike (§5.1–§5.4's every non-
domain-matching failure — `ModelSyntaxError`, `Unsatisfiable`, `MultiplySatisfiable`, invented
extra tokens like `lizard, spock`/`water, fire` — came from SPIKE-014's already-known ~26-48%
verifier ceiling, not from anything domain substitution did), and it tested the wrong downstream
capability (formalizing, not the well-posedness of the substitution itself — ADR-007/RFC-003
§7.3's own established distinction between the two). Replaced with `judge-substitution.ts`: a
critic call given the ORIGINAL prose, the SUBSTITUTED prose, AND the mapping, asked only whether
the substitution is well-formed (grammar/agreement, no leftover fragments, same logical
structure) — never asked to solve anything. Uniqueness of the substituted `.mzn` stays a free,
deterministic check (unaffected by this change); only the LLM-based verification step changed.

Re-ran the identical n=3 × 2-puzzle sweep. Raw:
`results/domain-substitution-openai-gpt-4o-mini-2026-09-18T14-00-31-342Z.json`, **$0.0013**.

| Puzzle | wellFormed=true | wellFormed=false |
|---|---|---|
| PZL-0002 | 2/3 | 1/3 |
| PZL-0003 | 0/3 | 3/3 |

**PZL-0003's 3/3 `wellFormed=false` is a real, confirmed bug the critic caught on its first
run — not critic noise.** `apply-to-prose.ts`'s literal `split().join()` replace is
case-SENSITIVE. The seed puzzle's intro sentence uses lowercase values ("paper-rock-scissors"),
but its numbered rules use the SAME words capitalized as sentence-initial subjects ("**Paper**
beats rock.", "**Rock** beats scissors."). When the model reports `currentValues` matching the
intro's lowercase casing, `applyMappingToProse` only replaces the lowercase occurrences
(inside "beats X") and silently leaves every capitalized sentence-initial occurrence
unsubstituted — confirmed directly in the written record: rep 1's substituted prose reads
"**Paper** beats fire. **Rock** beats air. **Scissors** beats water." — the object of each
sentence changed, the capitalized SUBJECT did not, and the critic named exactly this
("the values 'paper', 'rock', and 'scissors' should have been replaced... throughout"). This
contradicts `apply-to-prose.ts`'s own header comment ("Safe unconditionally") — it is only safe
when every occurrence of a reported value shares one casing, which this seed puzzle's real prose
does not. **This is precisely the value the recommendation to give the critic the mapping (not
just the before/after prose) was for**: with the mapping in hand, the critic could name which
specific values were inconsistently applied, not just that something looked off.

**PZL-0002's 1/3 `wellFormed=false` is critic noise, not a code bug.** Rep 3's substituted
prose is byte-identical to reps 1 and 2 (both `wellFormed=true`) — same mapping, same output —
yet the critic flagged "The Dog lives in the Yellow House." as an issue with no apparent
grammatical defect. Same-input-different-verdict is exactly the LLM non-determinism this project
has already catalogued as a real, expected risk of any single LLM-judge call (SPIKE-004's
finding, cited in RFC-003 §7.3) — worth knowing about this critic specifically, not a reason to
distrust the PZL-0003 finding above (which is corroborated by inspecting the actual substituted
text directly, not solely by the critic's say-so).

**Follow-up, not yet done**: `apply-to-prose.ts` needs a case-tolerant replace (e.g. matching
every case variant of `oldValue` that actually appears in the prose, preserving each match's own
casing) before this bug stops recurring on any seed puzzle whose rules capitalize a
sentence-initial domain value. Flagged here rather than fixed, since it's a substitution-mechanism
fix distinct from this section's own scope (replacing the verifier).

### 5.6 Fixed apply-to-prose.ts's case-sensitivity bug — and immediately found the fix itself was incomplete, live

§5.5's case-sensitivity fix (case-insensitive `RegExp`, matched-casing-preserving replacement)
was applied, smoke-tested, and re-run live. First re-run: **0/6 well-formed**, worse than before
the fix. Two DISTINCT new problems, both confirmed by inspecting the actual substituted text
rather than trusting the critic's verdict alone:

1. **A real regression this fix introduced**: matching case-insensitively without word
   boundaries makes a short old value match INSIDE an unrelated word — `"Red"` matched the
   `"red"` inside `"numbeRed"` (`"...numbered 1 to 3..."`), corrupting it to `"numbeOrange"`.
   The original case-SENSITIVE version never hit this (capitalized `"Red"` never matched
   lowercase `"red"` inside `"numbered"`), so relaxing case-sensitivity reintroduced a different
   failure mode. Fixed by adding `\b...\b` word boundaries to the same regex.
2. **A critic-prompt scope gap, not a mechanism bug**: PZL-0003's substitutions were now
   mechanically complete and internally consistent (`"Lizard beats spock. Spock beats water.
   Water beats lizard."` mirrors the original's own cyclic beats-relationship exactly), but the
   critic rejected them anyway, reasoning from REAL-WORLD rock-paper-scissors-lizard-spock rules
   ("lizard does not beat spock") rather than the puzzle's own self-consistent, arbitrary
   relationships — exactly the kind of judgment the system prompt was supposed to rule out
   ("do not judge whether the new values are a 'better' choice") but hadn't explicitly named.
   Fixed by adding an explicit instruction: judge relationship correspondence structurally
   (does clue N connect the same POSITIONS as before), never against real-world/common-sense
   meaning of the new names.

Re-ran again after both fixes. Raw: `results/domain-substitution-openai-gpt-4o-mini-2026-09-18T14-13-26-626Z.json`,
**$0.0013**. Well-formed: 3/6, up from 0/6.

**Both code-level bugs are confirmed fixed** — no `"numbeRed"`-style corruption in any rep this
run, and every substituted prose is fully and consistently replaced. **The remaining 3/6
failures are critic noise, not code defects**, confirmed by direct inspection: PZL-0002 reps 1
and 3 are byte-identical to rep 2 (which passed) yet flagged with the identical nonsensical
complaint ("The Dog lives in the Yellow House.") seen in §5.5's own noise case — same-input-
different-verdict, the known LLM non-determinism this project already catalogued (SPIKE-004).
PZL-0003 rep 2's "Lizard beats spock" is structurally identical to two PASSING reps (a
self-consistent 3-cycle, same shape as the original) — the critic model still leaned on its own
strong prior about that specific pop-culture name pair despite the explicit instruction not to,
an instruction-following limit for this particular trigger rather than a prompt design flaw
that generalizes (every other relationship in every other rep judged correctly).

**Net assessment**: the mechanical substitution pipeline (mapping -> apply-to-prose ->
apply-to-mzn) is now confirmed correct across both real bugs found this session; the critic's
own false-positive rate on well-formed input (~half this small sample) is a property of using a
single cheap LLM-judge call, consistent with this project's standing expectation that one judge
call is noisy — not a reason to distrust the well-formedness CONCEPT, but a reason any future
use of this critic's numbers should account for judge noise (e.g. majority-vote across repeated
judge calls) before treating a single `wellFormed: false` as ground truth.

### 5.7 Widened the seed set from 2 to 6 puzzles — surfaced two new failure categories, neither a mechanism bug

§5.1–§5.6 exercised only PZL-0002 and PZL-0003, both structurally similar (a small house/array
grid with one or two named domains). Added four more seeds, each hand-translated to `.mzn` and
independently re-verified (fresh `solve()` call against `eval/answer-keys.json`, not merely
assumed correct, per this project's own standing discipline):

- **PZL-0001** — the classic Life International 1962 zebra puzzle itself: 5 `enum` domains,
  `alldifferent` per domain, same-house clues as bidirectional `forall`, adjacency clues via a
  `next_to` predicate. Solves uniquely; assignment matches `eval/answer-keys.json` exactly.
- **PZL-0004** — already had a hand-translated `.mzn` from earlier work (unrelated to this
  spike); registered as a seed rather than re-authored. 3 independent enum domains, no arrays —
  direct elimination via `!=` only, not a house grid.
- **PZL-0011** — a genuinely different puzzle SHAPE: a single decision variable determined by
  reified if/then policy rules over given facts (credit score, DTI, loan amount), no
  `alldifferent` at all. Solves uniquely; matches the answer key's `CounterOffer`.
- **PZL-0038** — single domain (`animal`), with clue 5 ("the wolf preys on the rabbit")
  deliberately left unencoded — the puzzle's own answer-key notes name it a defeated premise
  (concrete walls make predator/prey proximity irrelevant), not an omission. Solves uniquely;
  matches the answer key.

Added catalog/mzn/README.md index rows for all three newly-authored files (PZL-0001, PZL-0011,
PZL-0038), registered all four in `SEED_PUZZLE_IDS`, and ran `REPS=1` across all 6 seeds as a
smoke check before any larger sweep. Raw: `results/domain-substitution-openai-gpt-4o-mini-2026-09-18T14-23-27-141Z.json`,
**$0.0013**.

| Puzzle | Outcome |
|---|---|
| PZL-0001 | `VERIFIED`, `wellFormed=true` |
| PZL-0002 | `VERIFIED`, `wellFormed=true` |
| PZL-0003 | `SUBSTITUTION_NOT_WELL_FORMED` (the known lizard/spock critic noise, §5.6) |
| PZL-0004 | `MZN_APPLY_TOTAL_FAILURE` |
| PZL-0011 | `DOMAIN_MATCH_FAILED` |
| PZL-0038 | `VERIFIED`, `wellFormed=true` |

**PZL-0001 and PZL-0038 worked end-to-end on the very first live rep** — real evidence the
mechanism generalizes past the original two seeds, not just evidence it works on the puzzles it
was built against.

**PZL-0004's failure is a THIRD, distinct failure category — a naming-convention mismatch, not
a mechanism bug.** The domain matched perfectly (`"domain name and complete value set both
match"`, proposing exactly `Miss Scarlett`/`Colonel Mustard`/`Professor Plum`), but
`applyMappingToMzn` skipped every entry with `"not found among declared enum members"`:
`PZL-0004-whodunit.mzn`'s enum members are surname-only (`Scarlett`, `Mustard`, `Plum`), which do
not fold-match the prose's full-name convention (`sanitizeIdentifier("Miss Scarlett")` folds to
`"missscarlett"`, never `"scarlett"`). This is NOT something to fix by editing that `.mzn`:
`tests/solver/catalog-examples.test.ts` and `tests/cli/cli.test.ts` are pinned to the surname-only
convention (`assert.deepEqual(result.assignment.culprit, { e: "Plum" })`), and that file predates
this spike and serves other, unrelated tests. PZL-0004 stays registered as a seed — its domain-
matching and mechanical-solve steps are exercised correctly — but any substitution rep against it
will hit this same `MZN_APPLY_TOTAL_FAILURE` until a future seed `.mzn` is authored (or this one
is deliberately forked) with a fold-matchable naming convention.

**PZL-0011's failure is a genuine model-competency miss, not a harness defect.** The model
proposed `currentValues: [680, 750]` — the two credit-score NUMBERS from the prose — as its
"domain," directly violating its own system prompt's instruction not to pick a number/quantity.
`scoreDomainMatch` correctly rejected this (`missing [Denied, Approved, Counter-Offer]; invented
[680, 750]`) rather than silently accepting a wrong pick. This is one `n=1` data point, not
evidence the model can never find PZL-0011's real domain — worth more reps before drawing a
firmer conclusion, but a legitimate, expected outcome of the harness working as designed
(reporting a miss precisely, not obscuring it), not something to patch.

### 5.8 Majority-vote critic (3 votes) — filters random judge noise, leaves systematic bias untouched, and surfaced a genuinely new real finding

§5.5/§5.6 both found the critic's biggest reliability problem was same-input-different-verdict
noise, not consistent bugs. Added `judgeSubstitutionMajority` (`judge-substitution.ts`): 3
parallel calls to the same critic, strict majority verdict, issues taken only from the votes
agreeing with that majority. `run-domain-substitution.ts` now calls this instead of the single-
call `judgeSubstitution`.

Ran the default `REPS=3` sweep across all 6 seeds ($0.0075 — roughly 3x the single-call cost, as
expected). Raw: `results/domain-substitution-openai-gpt-4o-mini-2026-09-18T14-37-21-873Z.json`.

**Confirmed fix for the specific noise case this was built for**: PZL-0002, previously showing
1/3 or 2/3 flakiness across every prior run in this session, came back 3/3 `VERIFIED` this run —
consistent with the noise being genuinely random rather than a property of that puzzle's own
substituted text (which never changed).

**Immediately surfaced a genuinely new, real finding — not noise, since all 3 votes agreed**:
PZL-0001 rep 1 was flagged 3/3 for a real grammatical defect the mapping itself introduced, not
a mechanical apply bug (`mznApplied: 5, mznSkipped: []` — substitution ran cleanly). The model
proposed replacing "Norwegian" with "Swedish" — but "Norwegian" doubles as a NOUN in English
("the Norwegian" = a person), while "Swedish" is adjective-only ("the Swedish" needs a following
noun, e.g. "the Swedish person"). The mechanical substitution correctly replaced every
occurrence, faithfully reproducing this pre-existing ungrammaticality in the model's own value
choice. This is a content-quality risk in the mapping proposal itself, not in `apply-to-prose.ts`
or `apply-to-mzn.ts` — the critic caught something no amount of mechanism-level fixing could,
because the defect isn't in the mechanism.

**Majority voting reduces RANDOM noise; it does not fix a SYSTEMATIC bias, and it does not stop
the critic from occasionally reasoning incorrectly — both still show up, unchanged in kind from
before**:
- PZL-0003's real-world-rock-paper-scissors-lizard-spock bias (§5.6) recurred 2/3 votes this run
  ("Lizard beats spock (original: Paper beats rock)" flagged as wrong) — a systematic prior in
  the critic model about this specific name pair, which no number of repeated votes on the SAME
  prompt will out-vote away, since every vote shares the same bias.
- PZL-0038 showed a NEW kind of critic unreliability: the critic itself reasoned incorrectly.
  Rep 1 asserted `"a lion" should be "an lion"` — backwards; "lion" starts with a consonant
  SOUND, so "a lion" is the correct form, not the substituted text. Rep 3 listed every
  substituted sentence next to its original as if the difference itself were the defect
  (`"The frog is in pen 1. (original: The tortoise is in pen 1.)"`), never naming an actual
  problem — confusing "this text changed" with "this text is wrong." Both are the critic being
  simply incorrect in its own reasoning, a different failure shape from either verdict-flipping
  noise or a consistent real-world-knowledge bias.

**PZL-0011's domain-match miss is no longer an `n=1` curiosity — it replicated 3/3 with the
identical reason.** The model consistently proposes `[680, 750]` (the two credit-score numbers)
as its "domain" for this puzzle, not the actual named `outcome` domain, despite the system
prompt explicitly ruling out numbers/quantities. This is now a replicated, not speculative,
finding: this puzzle's SHAPE (a procedural decision with prominent numeric facts stated before
its one real named-value domain appears, only implicitly, inside the rule text) appears to be
a genuine, consistent weak point for domain identification with this model — worth a stronger
prompt (e.g. a short few-shot example distinguishing a decision outcome from a given numeric
fact) as a follow-up, not something majority voting on the CRITIC (a different call entirely)
could ever address.

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
1. **Done, per §5.4**, superseding both §5.2's substring heuristic and §5.3's curated-alias-
   table migration. Value-set equality (via `src/eval/aliases.ts`'s `stringsMatch`, ADR-011's
   shared string-equivalence matcher) is now the SOLE scoring gate — domain-name matching was
   dropped entirely, since neither `apply-to-prose.ts` nor `apply-to-mzn.ts` ever reads the
   proposed name. This closes both the morphological-variance gap (§5.1) and the genuine-
   synonym-variance gap (§5.2/§5.3 both hit this and neither closed it by curation alone) in one
   change, confirmed live: every rep across both seed puzzles now clears domain-matching (0/6
   `DOMAIN_MATCH_FAILED`, down from 1/6 even after §5.3's curation). The proposed name is still
   reported for human legibility, just never used to accept or reject a rep.
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
