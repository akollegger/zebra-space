---
id: SPIKE-016
title: TypeSafe Jev — First-Contact Evaluation of a Judgment-Primitive Model
status: done
rfcs: [RFC-003]
created: 2026-09-20
---

# SPIKE-016: TypeSafe Jev — First-Contact Evaluation of a Judgment-Primitive Model

## 1. Question

RFC-003 §5.2 enumerates candidate extraction strategies by tier (rule-based, JS-native NLP,
small specialized models, LLM, hybrid) and §7.4 asks whether extraction can run
offline/deterministically for CI, and how an LLM-dependent strategy would be tested without a
live model dependency. Neither anticipated a distinct tier this session's own review surfaced:
[TypeSafe](https://typesafe.ai)'s **Jev**, a "System One" model returning typed judgments
(Choice/Noul/Score — one-of-N, yes/no-probability, scored-degree) rather than generated text,
positioned as fast/cheap enough to be called densely (per-clue, or even pairwise) where a
frontier-model call could only be afforded once per rep.

**This spike's question is broad and exploratory, not a single hypothesis**: what does Jev
actually do, at what real latency/cost/accuracy, and does it offer a concrete benefit for any of
the four candidate operations this session's review identified as classification/judgment-shaped
sub-steps hiding inside this project's otherwise-generative formalization pipeline? A "no
measurable benefit" finding for one or more of these is as valid an outcome as a "yes" — this is
a first-contact evaluation, not a targeted A/B expected to confirm a preferred answer.

The four candidate operations (independent sub-questions; run and report each separately rather
than as one aggregate verdict):

1. **A puzzle-type/outcome-class gate.** No stage of the pipeline currently infers which of the
   five outcome classes (`determinate`/`cop`/`ambiguous`/`subjective`/`non-problem`,
   `src/eval/grader.ts`'s `OutcomeClass`) a puzzle belongs to — it's only known via the curated
   `eval/answer-keys.json`. Can a Noul ("is this a well-posed, uniquely-solvable CSP?") or a
   Choice (over the five classes) infer it accurately enough from prose alone to matter?
2. **Per-clue fidelity/localization against an already-drafted `formalize-mzn` model.**
   SPIKE-014 §5.4 diagnosed three silent failure mechanisms (dropped `alldifferent`, incomplete
   relational coverage, self-contradiction) with "no mechanical remedy from inside this pipeline"
   short of "an independent second formalization to cross-check against" — judged too expensive
   to run with a frontier model. Does a cheap per-clue Noul ("does this constraint fully and
   correctly capture this clue?") against the *already-collected* failing traces
   (`design/spikes/SPIKE-014-informal-reasoning-formalization/scripts/results/*.json`, PZL-0010
   and PZL-0038 specifically) catch what SPIKE-014 diagnosed by hand?
3. **Replacing curated alias/lemmatizer folding with pairwise semantic-equivalence judgments.**
   `src/eval/grader.ts`'s `comparisonKey` and SPIKE-015's `score-domain-match.ts`'s
   `nameResembles` both fold spelling/morphology variance via a hand-maintained alias table plus
   a lemmatizer — `score-domain-match.ts`'s own comments name "genuine synonym variance...that
   curation alone can't close" as an open gap. Does a Jev Noul ("do these two tokens/names refer
   to the same value?"), run pairwise, match or beat the curated fold on the existing alias-table
   fixtures and the synonym cases the fold already admits it misses — cheaply enough to run
   exhaustively?
4. **Substituting Jev for the majority-of-3 full-LLM well-formedness critic.**
   SPIKE-015's `judge-substitution.ts` repeats a full forced-tool-call chat completion 3x and
   takes a majority `wellFormed` verdict to filter single-call noise. Does one Jev Noul call
   (using its native calibrated probability instead of a hand-rolled vote) match the 3-vote
   verdict on the already-collected SPIKE-015 result set, at a fraction of the cost?

**Explicitly out of scope for this spike**: adopting Jev for anything generative (formalization
itself, MiniZinc authoring, prose completion) — per TypeSafe's own positioning, System One models
return typed judgments over given state, not written text, so they are not a candidate
replacement for the frontier-model authoring step SPIKE-014 already evaluated.

## 2. Method

**Step 0 — orientation (no API calls, or the cheapest possible ones).** Read TypeSafe's live
docs (`https://docs.typesafe.ai/llms.txt` index, `concepts/system-one.md`,
`concepts/how-to-build-with-system-one.md`, `primitives/{choice,noul,score}.md`, `api.md` and/or
`sdk/{python,javascript}.md`) to confirm current API shape, auth, pricing, and rate limits before
writing any integration code — the installed skill (`typesafe:typesafe-ai`) explicitly directs
this. Record actual observed latency and per-call cost from the first few real calls (not just
published pricing) since that's the property motivating this whole spike.

**Redesign after reading `docs.typesafe.ai/model-jaggedness/jev-1.13`** (done before writing any
of steps 1-4; full failure-mode list in §4's 2026-09-20 entry): that page's own guidance changed
two of the four sub-questions' design, not just implementation detail —
- Sub-question 1 is reframed from "is this puzzle solvable/unique" (a solvability *computation*,
  exactly what the docs say to keep out of Jev — "math/counting", "indirection") to classifying
  the puzzle's *rhetorical framing* instead (a literal, surface-reading classification — Jev's
  strength). Reported as framing-classification accuracy against the answer key's `outcome`
  field, never as "Jev detects solvability."
- Sub-question 4's single bundled `wellFormed` boolean (four concerns in one question) is
  decomposed into three separate Nouls, AND-gated in code, per the docs' "don't hide multiple
  judgments in one question."
- Sub-question 2 became a two-step SELECT-then-JUDGE pipeline (which constraint line addresses
  this clue, then does it fully capture it) rather than one bundled call, for the same reason,
  and to keep each call's state to just the one clue + one line (the docs' "large irrelevant
  state"/context-rot warning).
- Sub-question 3's pairs are given a `contextHint` (the puzzle's domain), since a named-miss pair
  like "action"/"move" is only synonymous WITHIN a puzzle's domain, not in general English.

**Credentials/access**: this is a third-party paid API requiring its own account/API key —
distinct from this project's existing OpenRouter key. Obtain a key, store it the same way
`OPENROUTER_API_KEY` is handled (`.env`, never committed), and treat any code that calls it the
same way `tests/extraction/live.test.ts` treats a live model call: gated, not part of the default
`pnpm test` run (CLAUDE.md's "pnpm test stays offline and free" MUST NOT is a hard constraint —
this spike's code must not violate it for the main test suite regardless of what `pnpm test:live`
or a dedicated spike script does).

**Steps 1-4 — one per candidate operation above, each a small, disposable script under
`scripts/lib/`, each independently time-boxed (see §3):**

1. **Outcome-framing gate** (`lib/outcome-framing-gate.ts`, `run-outcome-framing-gate.ts`): one
   Jev Choice per puzzle over the puzzle prose, criteria reframed per the redesign above. Run
   against the FULL current answer-key catalog (39 puzzles, not just the historical 14-puzzle
   sample this spike line originally used elsewhere — a puzzle-agnostic gate costs nothing extra
   to run against every puzzle already on disk). Report accuracy per class plus a confusion
   matrix.
2. **Per-clue fidelity** (`lib/per-clue-fidelity.ts`, `run-per-clue-fidelity.ts`): load PZL-0010
   and PZL-0038's already-collected `formalize-mzn` failing drafts from SPIKE-014's result JSON
   (`formalize-mzn-2026-09-16T10-53-55-723Z.json`, the post-fix run SPIKE-014 §5.3 cites), split
   the source prose into clues (SPIKE-008's `splitClues`), extract each draft's `constraint`
   lines, and for EVERY rep (not just known-failing ones, so a correct MATCH rep serves as a
   false-positive control) run the select-then-judge pipeline per clue. Zero new frontier-model
   spend.
3. **Alias/equivalence folding** (`lib/pairwise-equivalence.ts`, `run-pairwise-equivalence.ts`):
   pull the existing curated table (`eval/aliases.json`), the specific synonym misses
   `score-domain-match.ts`'s comments name ("action"/"game" vs. "move", with the puzzle's own
   domain as `contextHint`), and a sampled "hard negative" cross-check (pairs of distinct
   answer-key values sharing a 2-letter prefix, capped at 20 — the closest lexical neighbors in
   the catalog, not a random sample that would trivially all read "no match").
4. **Well-formedness critic substitution** (`lib/wellformed-decomposed.ts`,
   `run-wellformed-decomposed.ts`): replay the three decomposed Nouls against every already-
   collected SPIKE-015 substitution result with a recorded `wellFormed`+`substitutedProse`
   (`design/spikes/SPIKE-015-domain-substitution/scripts/results/*.json`), comparing the
   AND-gated verdict to the recorded 3-vote majority verdict. **Fixture gap found live**: those
   results never persisted the `mapping` used to produce `substitutedProse`, only the outcome —
   so the replay asks Jev to identify what changed by comparing the two proses directly instead
   of naming it explicitly (more indirection than intended, see §4).

**Reporting**: for each of the four, record accuracy/agreement against the existing ground truth
or existing verdict, plus observed latency and cost per call, then a plain verdict — worth a
follow-up ADR-track experiment, inconclusive, or not worth pursuing — rather than forcing an
overall single conclusion across all four (they are independent questions and may resolve
differently).

## 3. Time-box

**One day (~8 hours)**, split roughly: 1h orientation/docs/account setup (step 0); 1.5h each for
the four candidate-operation scripts (6h total, since three of the four reuse already-collected
artifacts and need no new frontier-model spend, only new Jev calls); 0.5h write-up. Hard stop at
the time-box regardless of how many of the four get fully answered — a partial result on all four
is more useful than a complete result on one, given this is explicitly a broad first-contact
survey, not a single deep dive. If step 0 reveals a hard blocker (no usable trial/free tier,
auth friction, rate limits too tight to run even the existing 14-puzzle sample), stop there and
report that as the finding rather than spending the rest of the box working around it.

## 4. Notes

**2026-09-20 — read `docs.typesafe.ai/model-jaggedness/jev-1.13` (the page the user specifically
pointed at) before writing any code.** Nine documented failure modes, condensed: (1) literal
reading — state exact conditions, put boundary cases in criteria; (2) math/counting — keep
arithmetic in code; (3) date/time comparison — extract components in code; (4) indirection —
avoid double negatives/multi-hop, name relevant state directly; (5) large irrelevant state —
filter in code first; (6) adversarial content — state is neutral data, write explicit criteria;
(7) contradictory instructions/criteria — keep aligned; (8) structural invariants don't hold
(a Noul's yes-score and a separate "not X" Noul's score don't sum to 1) — ask directly, don't
derive; (9) text generation — Jev can't generate text, use Choice over enumerated options. Plus
key best practices: don't hide multiple judgments in one question; minimize state (context rot);
don't interpolate exact numbers from Score. This directly reshaped sub-questions 1, 2, and 4's
design (see §2's redesign note) before any experiment ran — a genuinely different plan than
SPIKE-016's original text, not just an implementation detail.

**2026-09-20 — SDK/API shape confirmed from the JS SDK docs and the installed package's own
`.d.ts`** (`@typesafe-ai/sdk@0.6.0`, model `jev-1.13.0`): `TypeSafeClient` reads
`TYPESAFE_API_KEY` from the environment; `client.systemOne({ state, questions })` answers named
questions in parallel over the same state; `noul`/`choice`/`score` are the three primitives,
returning `{noul}` (0-1 probability), `{choice, confidence, probabilities}`, and
`{score, confidence, legend, probabilities}` respectively. Confirmed with one minimal live Noul
call before building anything: `1267ms` latency, `280` input / `20` output tokens for a
single-question call against a one-sentence state — the first real cost/latency data point this
spike exists to gather.

**2026-09-20 — offline smoke tests (`lib/smoke-test-jev.ts`) written and passing before any live
sweep**, per this whole spike line's own established discipline: a stubbed `AskFn` (injectable in
every lib module, defaulting to the real `ask`) proves each module's request/response plumbing
and scoring logic (AND-gate, select-then-judge indexing, constraint-line regex extraction) at
zero cost. All 10 checks passed on the first run.

**2026-09-20 — found a fixture gap in SPIKE-015's persisted results while wiring up
sub-question 4**: `design/spikes/SPIKE-015-domain-substitution/scripts/results/*.json` never
recorded the `mapping` (old→new value pairs) used to produce `substitutedProse`, only the
judged outcome. `judgeWellFormedDecomposed` was made to accept an optional `mapping`, falling
back to asking Jev to identify what changed by comparing `originalProse`/`substitutedProse`
directly when absent — more indirection than the ideal design intended, a real (if minor)
confound on this specific replay, not a Jev capability finding.

**2026-09-20 — negative-control fixture in sub-question 3 had one mislabeled pair**: the
"hard negative" sampler (grouping answer-key values by a shared 2-letter lowercase prefix) picked
up `"Dog"` vs. `"dog"` as a same-bucket pair and labeled it `expected: false` (a "distinct value"
pair) — but these are the SAME value differing only by case, not a real collision like
`tests/eval/grader.test.ts:302`'s own collision-guard is designed to catch. Jev's `true` answer
for that pair was actually correct; the raw 19/20 negative-control accuracy is really 20/20 once
this one mislabeled fixture is discounted (§5.3). **Superseded 2026-09-20 (below): fixed at the
source rather than discounted by hand.**

**2026-09-20 — Copilot review on PR #37 found four real, independent bugs; all four fixed and
every affected experiment re-run before this write-up.** Full detail in the fix commit; summary:

1. **Sub-question 1's loader only read `entry.outcome` (top-level), never the nested
   `entry.answer.outcome` shape most non-`determinate` entries actually use** (e.g. PZL-0015
   through PZL-0021, PZL-0028 through PZL-0037) — every one of those silently defaulted to
   `determinate`, which is why the first pass showed only two classes present at all. Fixed with
   a fallback mirroring `scripts/eval-extraction.ts`'s own private `effectiveOutcomeClass`/
   SPIKE-008's `grade.ts`'s `effectiveOutcome` (both unexported, so restated locally rather than
   imported). **This invalidated the entire original §5.1 finding, not just its numbers** — the
   corrected class distribution (15 determinate, 7 non-problem, 6 cop, 5 ambiguous, 6 subjective)
   is qualitatively different from the "only two classes exist" picture the bug produced.
2. **Sub-question 2's checker discarded `splitClues`'s `preamble` entirely**, so a global
   constraint stated only in the puzzle's setup sentence (PZL-0038's "one animal per pen," the
   EXACT `alldifferent(pens)` SPIKE-014 §5.4 diagnosed as silently dropped) was never checked at
   all — the clue-5 flag the first pass reported was a real but DIFFERENT omission (the predation
   clue), not the one this write-up originally claimed to reproduce. Fixed by checking the
   preamble as its own item, tagged `isPreamble`, alongside the numbered clues.
3. **`jev-client.ts` discarded `SystemOneResult.usage` entirely** — the "fraction of the cost"
   framing sub-questions 3/4 exist to test had no persisted data to back it, and TypeSafe has not
   published per-token pricing as of this spike (checked live), so token counts (input/output),
   not a $ figure, are now the recorded cost proxy. Fixed by threading `usage` through every lib
   module's result type and adding a shared `totalUsage` helper each run script's summary calls.
4. **Sub-question 3's "hard negative" sampler let a case-only pair (`"Dog"`/`"dog"`) through**
   as a `negative-control` — the project's own `stringsMatch` fold (ADR-011) already considers
   that the SAME value, so labeling it `expected: false` was wrong by this project's own
   definition of "distinct." Fixed by filtering candidate pairs through `stringsMatch` before
   adding them.
5. **Sub-question 4's replay loader accepted BOTH genuine majority-of-3 records (`judgeVotes`
   present, length ≥ 2) and the project's earlier legacy single-judge result files (no
   `judgeVotes` at all)**, silently mixing a lone frontier-model judgment in among the actual
   3-vote verdicts this sub-question claims to compare against — 22 of the original 89 replayed
   reps were legacy records. Fixed by requiring `judgeVotes.length >= 2`; the corrected replay
   set is 67 reps, all genuine majority-of-3 comparisons.

All five fixes verified with the existing offline smoke test (still 10/10 passing, unchanged
behavior for anything the stub exercises) before spending anything, then every one of the four
live sweeps was re-run in full. **The corrected numbers below replace the original ones
throughout — this section documents that a real, substantive review caught real, substantive
bugs, not a discrepancy to footnote.**

**2026-09-21 — Kilo Code review on PR #37 found four more real issues in the corrected write-up
(one WARNING, three SUGGESTIONs); all four fixed/addressed.** Summary:

1. **Sub-question 4's replay still double-counted**: the three qualifying result files (one bare
   frontier-judge run, two independent-judge-model runs per SPIKE-015 §5.9) cover the SAME six
   puzzles, and their outputs collide — 28 of the 67 "validated majority-of-3" reps were exact
   repeats of one of 39 DISTINCT `(puzzleId, substitutedProse)` items, re-spending Jev on
   byte-identical input and inflating the denominator. Fixed by deduplicating to the first
   occurrence per distinct item (one genuine cross-file disagreement exists on a repeated item —
   PZL-0003's "lizard-spock-water" prose splits 2 `false`/3 `true` across its 5 copies, plausibly
   from the different judge models across files — left as-is rather than re-resolved by a
   second-order vote, per this fix's own code comment).
2. **Sub-question 3's negative-control pool harvested diagnostic METADATA, not domain VALUES**:
   the collector walked every string leaf under `answer`, and non-determinate entries
   (PZL-0015 onward) store `outcome`/`failing_condition`/`diagnosis`/`contestability`/
   `readings[].reading` text there instead of puzzle values — producing pairs like
   `"Norwegian"` vs. `"non-problem"` or `"Coffee"` vs. `"Constitutive constraints"`, which
   contradict `contextHint` and are trivially easy negatives that inflated 20/20. Fixed by
   skipping any entry whose `answer` carries an `outcome` field (the same signal §4's fix #1
   established distinguishes a real value entry from a diagnostic one) before collecting.
3. **§5.4's PZL-0010 preamble claim ("flagged in 2 of 3 reps") didn't match the committed
   result**: rep 1's preamble check DID select a line (index 2, fidelity 0.04) rather than
   finding no match, but 0.04 is still well under the 0.5 flag threshold, so all 3 reps are in
   fact flagged — the write-up conflated "no matching line" with "flagged" instead of reporting
   the actual rule. Corrected in §5.4 below.
4. **§5.3's cited noul value was off by 0.01** (0.29 written, 0.28 recorded) — corrected.
5. **§5.1's `subjective` criterion may not describe the class it's scored against** — `FRAMING_
   CRITERIA.subjective` asks about preference/opinion prose, but the catalog's `subjective`
   entries (PZL-0033 onward) are unstated-premise puzzles that read as ordinary determinate
   puzzles and never ask for a preference at all (confirmed by inspecting their `answer` shape:
   `unstated_premise`/`contestability`/`agreement`/`stakes` fields, no preference language). The
   redesign's deliberate literal-surface-reading approach cannot detect an imported premise by
   construction, so part of `subjective`'s 0/6 measures a criterion/taxonomy mismatch, not only
   Jev's capability — distinguished explicitly from `ambiguous`'s 0/5 (whose criterion DOES match
   its class's actual readings-based definition) in §5.1/§6 below, per Kilo's own suggested
   caveat rather than a design change to the criteria themselves.

Sub-questions 3 and 4 were re-run after their code fixes; §5.1/§5.3/§5.4's TEXT was corrected for
the two documentation-only findings (3, 4) without a re-run, since nothing about the underlying
data changed — only what was written about it.

## 5. Findings

All four sub-questions were run live against real data (39-puzzle answer-key catalog, 39
deduplicated majority-of-3 SPIKE-015 substitution reps, 42 preamble+clue checks across 6
PZL-0010/0038 formalize-mzn drafts, 20 value-only pairwise-equivalence checks), corrected and
re-run per the 2026-09-20 Copilot-review and 2026-09-21 Kilo-review fixes above. Raw results
(pre-fix files deleted at each round, not kept alongside, to avoid citing stale numbers by
accident): `scripts/results/{pairwise-equivalence,wellformed-decomposed,outcome-framing-gate,
per-clue-fidelity}-2026-09-2*.json`.

### 5.1 Sub-question 1 — outcome-framing gate: 59% overall once the class-distribution bug is fixed — strong on determinate/cop, a real failure on ambiguous/subjective

Corrected run: 23/39 correct (59%), all five classes present and scored (15 determinate, 7
non-problem, 6 cop, 5 ambiguous, 6 subjective — the catalog is NOT missing these classes, §4's
bug was hiding them). Per class:

| Class | Correct/Total |
|---|---|
| `determinate` | 15/15 (100%) |
| `cop` | 6/6 (100%) |
| `non-problem` | 2/7 (29%) |
| `ambiguous` | 0/5 (0%) |
| `subjective` | 0/6 (0%) |

**A real, sharp capability split, not noise**: Jev's framing classification is perfect on the two
classes with the most textually distinctive signals (an optimization keyword for `cop`; a fully
specified, closed clue set for `determinate`), and it FAILS COMPLETELY on `ambiguous` and
`subjective` — the confusion matrix shows both classes' misses land almost entirely on
`determinate` (5/5 ambiguous puzzles, 5/6 subjective puzzles predicted `determinate`). `non-
problem` is a genuine middle case (29%, better than chance but far from reliable), with most
misses landing on `ambiguous`. **This is a real negative finding for three of five classes**,
not an artifact of a class the catalog happens to lack — the original "incomplete by
construction, untested" framing was itself a symptom of the bug, not an honest hedge.

**`ambiguous` and `subjective`'s 0% share a symptom but not necessarily a single cause** (Kilo
Code review, PR #37): `ambiguous`'s `FRAMING_CRITERIA` ("leaves out information needed to settle
on one reading") DOES match that class's actual definition (its `readings[]` field records
genuinely multiple valid interpretations) — its 0/5 is a clean capability-gap read, Jev reading
surface completeness as evidence of a single determinate answer when a real interpretive gap
exists. `subjective`'s criterion ("asks for a preference, opinion, or value judgment") does NOT
match that class's actual shape — PZL-0033 onward are UNSTATED-PREMISE puzzles (an assumed norm
like "perishables should be refrigerated" that isn't stated in the prose, per their
`unstated_premise`/`contestability`/`agreement`/`stakes` fields) that read as ordinary,
fully-specified determinate puzzles on their surface and never ask for a preference at all. The
redesign's deliberate literal-surface-reading approach (per the jaggedness doc's own guidance)
cannot detect an imported premise BY CONSTRUCTION, regardless of Jev's capability — so
`subjective`'s 0/6 partly measures that the criterion never described the class being scored
against, not purely a Jev limitation. This doesn't overturn the finding (Jev still can't
recognize either class as tested), but the TWO classes' 0% share a symptom, not necessarily one
cause. Latency: 11.3s total / 39 calls ≈ 290ms/call. Token usage: 25,782 input / 2,445 output
tokens (no $ pricing published as of this spike).

### 5.2 Sub-question 4 — decomposed well-formedness: 77% agreement on a deduplicated, VALID majority-of-3 sample, and a completely one-directional bias

Corrected run: 39 DISTINCT `(puzzleId, substitutedProse)` items (22 legacy single-judge reps
excluded per §4's fix; a further 28 exact-duplicate reps across three overlapping SPIKE-015
result files collapsed to their first occurrence per the 2026-09-21 dedup fix above), all 39
scored (0 errors), **77% agreement (30/39)** with the recorded 3-vote majority verdict. The 9
disagreements are **100% one-directional** — every one is `majority=false, jev=true` (Jev
calling something well-formed that the 3-vote frontier critic flagged), never the reverse.
5 of the 9 are PZL-0001, exactly the puzzle SPIKE-015's own file header cites as its motivating
case-sensitivity/word-boundary bug example — a subtle single-word placement mismatch ("The
Swedish lives in the first house" instead of substituting "Norwegian"→"Swede" correctly) that
the frontier 3-vote critic caught but Jev's decomposed Nouls missed entirely. This is consistent
with the jaggedness doc's own "indirection" warning: spotting one specific misplaced word inside
a 14-line paragraph is a multi-hop localization task, not a literal surface read. Note the
STILL-OPEN confound from §4's fixture gap (no `mapping` available for this replay, unrelated to
either dedup fix) — some of this gap may narrow with the mapping present; untested. Latency:
12.1s total / 39 reps ≈ 311ms/rep (3 parallel Nouls per rep, same wall-clock as one). Token
usage: 35,018 input / 2,652 output tokens.

### 5.3 Sub-question 3 — pairwise equivalence: strong on lexical variants and a now-genuine negative control, but did NOT close the named domain-synonym gap

- **Curated-alias pairs**: 2/3 correct. Missed `"hardcover book set"` vs. `"book set"` (noul=0.28,
  i.e. leaning "no match") — a plain underscore/space + word-drop variant the existing
  deterministic fold handles trivially. A real, surprising miss on an easy case.
- **Named-miss pairs (the actual gap this sub-question exists to test)**: 0/2. Both `"action"` vs.
  `"move"` (noul=0.27) and `"game"` vs. `"move"` (noul=0.04) — WITH the puzzle's own domain
  description as `contextHint` — were judged NOT the same value. The context-hint mitigation the
  redesign added (see §2) was not enough; Jev's judgment tracked general-English synonymy far
  more than the puzzle-specific domain framing. **This is a real, direct negative result**: Jev
  does not, as tested, close the exact gap `score-domain-match.ts`'s own comments named as
  something "curation alone can't close."
- **Negative control (hard-negative sample, capped 20 pairs)**: corrected run, now filtered to
  genuine domain VALUES rather than diagnostic metadata (§4's 2026-09-21 fix) — 15 pairs
  available after filtering (fewer than the original 20-pair cap, since the value-only pool is
  smaller), **15/15 correct**. Jev never produced a false merge on a genuinely distinct value
  pair, including lexically close ones like `"Norwegian"`/`"North"` or `"Coffee"`/
  `"Conservatory"` — a smaller but now-honest number, replacing the metadata-inflated 20/20.
- Total latency: 6.1s / 20 calls ≈ 304ms/call. Token usage: 8,394 input / 440 output tokens.

### 5.4 Sub-question 2 — per-clue fidelity: with the preamble now checked, PZL-0038 shows the ACTUAL diagnosed failure caught, plus one more; PZL-0010 remains a real false-positive problem

**PZL-0038 (3 reps, all outcomes): now a genuinely clean, TWO-PART confirmed result.** Checking
`splitClues`'s `preamble` as its own item (§4's fix) directly targets SPIKE-014 §5.4's actual
claim — the prose's setup sentence ("one animal per pen") never mapped to any constraint line in
**all 3 reps** (`NO MATCHING LINE`), i.e. no `alldifferent(pens)`-equivalent exists in any of
them — this is now a verified, not inferred, match to §5.4's hand diagnosis. Separately, the 5
numbered clues also show their own clean pattern: clues 1-4 (simple "animal is in pen N" and one
ordering clue) all localize correctly with high fidelity (0.70-0.94) in every rep, and **clue 5
("The wolf preys on the rabbit") is flagged in all 3 reps** (fidelity 0.28-0.37) — a second, real,
but DIFFERENT omission from the preamble's global constraint (the original write-up conflated
the two; they are now reported separately and both hold up). The two flagged items per rep (one
preamble, one clue) are consistent across every rep regardless of solve outcome.

**PZL-0010 (3 reps): unchanged, a real limitation.** The preamble is ALSO flagged in **all 3
reps** here — `NO MATCHING LINE` in 2 of 3, plus a weak match in the third (line 2, fidelity
0.04, still well under the 0.5 flag threshold, so it flags too) — consistent with the puzzle's
own clues being compound/conditional rather than the preamble specifically. Every numbered clue
in every rep was
flagged, INCLUDING the one `SOLVE_UNIQUE`/`MATCH` rep — a false-positive rate this mechanism
cannot be trusted at, as tested. Root cause, inspecting the raw selections: PZL-0010's clues are
compound/conditional ("if two cars arrive at the same moment, right-of-way rotates clockwise...")
while the draft's constraint lines vary structurally rep-to-rep (one rep encodes positions via a
`POSITION` enum + `order` array, another via `Direction` + differently-shaped comparisons) — the
single-line SELECT step, given only a flat numbered list of constraint lines with no comment
context, frequently picked a low-relevance line or found no match at all, then correctly (but
unhelpfully) judged that low-relevance line as not fully capturing the clue. This is a
methodology limitation of this spike's simple line-level selection design on compound clues, not
evidence that Jev cannot help with fidelity checking in general — PZL-0038's clean, now-verified
result on the SAME mechanism shows it works when clue-to-line correspondence is closer to 1:1.

Totals (both puzzles, preamble + numbered clues, 42 items checked): latency 20.6s ≈ 490ms/check
(two calls — select, then judge — per item when a line was selected). Token usage: 37,485 input
/ 3,693 output tokens.

## 6. Conclusion

**No single verdict across all four — each resolves independently, as planned. Numbers below
reflect BOTH review rounds (Copilot, §4's first five fixes; Kilo, §4's second four fixes) — the
original write-up materially overstated sub-question 1, understated the fixture confounds in
2/3/4, and (after the first fix round) still double-counted duplicate reps in 4 and metadata
noise in 3.**

- **Outcome-framing gate (1)**: a genuine, sharp split — perfect on `determinate`/`cop` (21/21),
  a complete failure on `ambiguous`/`subjective` (0/11), a weak middle result on `non-problem`
  (2/7). This is NOT "unvalidated due to missing catalog examples" (the original, bug-driven
  conclusion) — it's a real, now-measured capability gap for `ambiguous` specifically; `subjective`'s
  0/6 is confounded by a criterion/taxonomy mismatch (§5.1) and shouldn't be read as an equally
  clean capability-gap result. **Not usable as a general puzzle-type gate as designed**; possibly
  still useful as a narrower `determinate`-vs-`cop` discriminator, which is a different, smaller
  claim than originally framed.
- **Well-formedness critic substitution (4)**: 77% agreement on a deduplicated, verified
  majority-of-3-only sample (39 distinct items) is not close enough to substitute outright, and
  the disagreement pattern (Jev more lenient, 100% one-directional, missing subtle single-word-
  placement errors) is a real, name-able weakness, not noise — and the STILL-OPEN `mapping`
  fixture gap (§4, distinct from both the majority-filter and dedup fixes) means even 77% may be
  a floor, not a final number. Worth closing with a live re-run (new frontier-model substitution
  calls, small cost) before treating this as final either way.
- **Alias/equivalence folding (3)**: the curated fold's own named gap (context-specific synonyms)
  was NOT closed by Jev with a context hint, a clean negative result — and now a clean 15/15 on
  a genuinely value-only negative control (no false merges at all, once BOTH the case-only
  mislabel and the metadata-harvesting bug were fixed at the source rather than hand-discounted
  or left unnoticed). Its one curated-alias miss (an easy case) suggests it isn't a reliable
  drop-in even for what the fold already handles well. **Recommendation: do not pursue this
  replacement** based on this evidence.
- **Per-clue fidelity/localization (2)**: the most genuinely promising result, and now on firmer
  footing — PZL-0038 shows TWO independently-confirmed catches (the preamble's actual missing
  global constraint, verified against SPIKE-014 §5.4's own claim rather than a different
  omission standing in for it; plus a second, separate dropped clue) — but the PZL-0010
  false-positive rate shows the simple select-then-judge design as built doesn't generalize to
  compound/conditional clues. **Worth a follow-up spike** specifically on improving the SELECT
  step (e.g. giving Jev the draft's own `%`-comments as context, or allowing multi-line
  selection) before drawing a final verdict — the PZL-0038 result alone is strong enough evidence
  this direction isn't dead.

**Process note worth carrying forward**: TWO rounds of independent automated review each found
real bugs the other missed — Copilot caught the outcome-loader defect, the discarded preamble,
the discarded usage data, and two fixture-labeling errors; a SECOND round from Kilo, reviewing
the ALREADY-CORRECTED code, still found a denominator double-count (duplicate reps across
overlapping SPIKE-015 files) and a metadata-vs-value contamination bug in the very fixtures the
first round had just touched, plus two numbers-vs-claims drifts in the write-up itself. Neither
round was rubber-stamping the other's fix. The general lesson (validate a classifier's INPUT
LOADER's coverage of the answer format's actual variants; check for exact-duplicate inputs
across any UNION of multiple source files; re-verify every specific number cited in prose
against the actual committed JSON, not memory) applies beyond this spike.

**For RFC-003**: cite §5.4's PZL-0038 result as the strongest candidate worth a dedicated
follow-up spike; cite §5.1's corrected framing-gate split (not the original inflated number) if
citing it at all, framed as a `determinate`/`cop` discriminator rather than a general gate; cite
§5.3's negative result on the alias-folding replacement as closing that specific candidate
(§7.1/§7.4 remain otherwise unaffected — this spike doesn't touch the intermediate-representation
or offline-testing open questions directly). Manual citation into RFC-003's Open Questions/
Appendix is a step the user takes separately, per this skill's own scope guard.
