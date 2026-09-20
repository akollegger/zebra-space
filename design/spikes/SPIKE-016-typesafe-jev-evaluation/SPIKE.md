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
this one mislabeled fixture is discounted (§5.3).

## 5. Findings

All four sub-questions were run live against real data in one pass (39-puzzle answer-key
catalog, 89 replayed SPIKE-015 substitution reps, 6 PZL-0010/0038 formalize-mzn drafts, 25
pairwise-equivalence checks). Raw results: `scripts/results/{pairwise-equivalence,
wellformed-decomposed,outcome-framing-gate,per-clue-fidelity}-2026-09-20T*.json`.

### 5.1 Sub-question 1 — outcome-framing gate: 82% overall, but the catalog has no ambiguous/subjective/non-problem examples to test against

32/39 correct (82%) across the FULL current catalog. But `perClass`/`confusion` show the current
`eval/answer-keys.json` has **zero puzzles labeled `ambiguous`, `subjective`, or `non-problem`** —
every entry is `determinate` (33) or `cop` (6). `cop` scored 6/6 (100%); `determinate` scored
26/33 (79%), with all 7 misses being Jev OVER-flagging a genuinely determinate puzzle as
`non-problem` (2 cases: PZL-0015, PZL-0018) or `ambiguous` (5 cases: PZL-0017, PZL-0019, PZL-0020,
PZL-0021, PZL-0035) — a real, one-directional calibration bias toward the rarer classes, not
random noise. **This finding is incomplete by construction**: the redesigned framing gate can
only be validated against the classes the catalog actually contains; whether it correctly
recognizes a genuinely ambiguous/subjective/non-problem puzzle remains untested. Latency:
11.5s total / 39 calls ≈ 294ms/call.

### 5.2 Sub-question 4 — decomposed well-formedness: 71% agreement with the majority-of-3, and a directional bias

89/89 reps scored (0 errors), 71% agreement (63/89) with the recorded 3-vote majority verdict.
Disagreements are NOT symmetric: Jev is more lenient — most disagreements are `majority=false,
jev=true` (Jev calling something well-formed that the 3-vote frontier critic flagged), clustered
heavily on PZL-0001 (8 of PZL-0001's 9 disagreeing reps go this direction). PZL-0001 is exactly
the puzzle SPIKE-015's own file header cites as its motivating case-sensitivity/word-boundary bug
example — a subtle single-word placement mismatch ("The Swedish lives in the first house" instead
of substituting "Norwegian"→"Swede" correctly) that the frontier 3-vote critic caught but Jev's
decomposed Nouls largely missed. This is consistent with the jaggedness doc's own "indirection"
warning: spotting one specific misplaced word inside a 14-line paragraph is a multi-hop
localization task, not a literal surface read. Note the confound from §4's fixture gap (no
`mapping` available for this replay) — some of this gap may narrow with the mapping present;
untested. Latency: 26.2s total / 89 reps ≈ 294ms/rep (3 parallel Nouls per rep, same wall-clock
as one).

### 5.3 Sub-question 3 — pairwise equivalence: strong on lexical variants and negative controls, but did NOT close the named domain-synonym gap

- **Curated-alias pairs**: 2/3 correct. Missed `"hardcover book set"` vs. `"book set"` (noul=0.29,
  i.e. leaning "no match") — a plain underscore/space + word-drop variant the existing
  deterministic fold handles trivially. A real, surprising miss on an easy case.
- **Named-miss pairs (the actual gap this sub-question exists to test)**: 0/2. Both `"action"` vs.
  `"move"` (noul=0.26) and `"game"` vs. `"move"` (noul=0.04) — WITH the puzzle's own domain
  description as `contextHint` — were judged NOT the same value. The context-hint mitigation the
  redesign added (see §2) was not enough; Jev's judgment tracked general-English synonymy far
  more than the puzzle-specific domain framing. **This is a real, direct negative result**: Jev
  does not, as tested, close the exact gap `score-domain-match.ts`'s own comments named as
  something "curation alone can't close."
- **Negative control (hard-negative sample, capped 20 pairs)**: 19/20 correct as scored; 20/20
  once the one mislabeled `"Dog"`/`"dog"` pair is discounted (§4) — Jev never produced a false
  merge on a genuinely distinct pair, including lexically close ones like `"Norwegian"`/`"North"`
  or `"Coffee"`/`"Conservatory"`.
- Total latency: 7.8s / 25 calls ≈ 311ms/call.

### 5.4 Sub-question 2 — per-clue fidelity: a clean, consistent signal on PZL-0038; a real false-positive problem on PZL-0010

**PZL-0038 (3 reps, all outcomes): a genuinely clean, consistent result.** Clues 1-4 (simple
"animal is in pen N" and one ordering clue) all localized correctly to their own constraint line
with high fidelity (0.76-0.95) in every rep. **Clue 5 ("The wolf preys on the rabbit") was
flagged in all 3 reps** (fidelity 0.24, 0.45, 0.28) — correctly forced onto the same line as
clue 4 (no dedicated line exists for it) and correctly judged as not fully capturing it. This
lines up with SPIKE-014 §5.4's hand-diagnosed finding that this draft never encoded the predation
constraint at all (there diagnosed as a missing `alldifferent`/uniqueness constraint) — the exact
failure class this sub-question exists to test, caught mechanically and consistently across
every rep, MATCH and non-MATCH alike (the SOLVE_MULTIPLY_SATISFIABLE/MISMATCH reps and the
SOLVE_ERROR rep all show the identical clue-5-only flag pattern).

**PZL-0010 (3 reps): a real limitation, not a clean result.** Every clue in every rep was
flagged, INCLUDING the one `SOLVE_UNIQUE`/`MATCH` rep — a false-positive rate this mechanism
cannot be trusted at, as tested. Root cause, inspecting the raw selections: PZL-0010's clues are
compound/conditional ("if two cars arrive at the same moment, right-of-way rotates clockwise...")
while the draft's constraint lines vary structurally rep-to-rep (one rep encodes positions via a
`POSITION` enum + `order` array, another via `Direction` + differently-shaped comparisons) — the
single-line SELECT step, given only a flat numbered list of constraint lines with no comment
context, frequently picked a low-relevance line or found no match at all, then correctly (but
unhelpfully) judged that low-relevance line as not fully capturing the clue. This is a
methodology limitation of this spike's simple line-level selection design on compound clues, not
evidence that Jev cannot help with fidelity checking in general — PZL-0038's clean result on
the SAME mechanism shows it works when clue-to-line correspondence is closer to 1:1.

Total latency: 20.1s / 36 clue-checks ≈ 559ms/check (two calls — select, then judge — per clue
when a line was selected).

## 6. Conclusion

**No single verdict across all four — each resolves independently, as planned:**

- **Outcome-framing gate (1)**: promising but unvalidated on 3 of 5 classes (§5.1) — the catalog
  itself needs at least one `ambiguous`/`subjective`/`non-problem` example before this can be
  trusted as a real puzzle-type gate. Worth adding such examples to the catalog specifically to
  close this gap, independent of any Jev decision.
- **Well-formedness critic substitution (4)**: 71% agreement with the existing majority-of-3 is
  not close enough to substitute outright, and the disagreement pattern (Jev more lenient,
  missing subtle single-word-placement errors) is a real, name-able weakness, not noise — but the
  replay's fixture gap (no `mapping`) is a genuine confound worth closing with a live re-run
  (new frontier-model substitution calls, small cost) before treating 71% as final.
- **Alias/equivalence folding (3)**: the curated fold's own named gap (context-specific synonyms)
  was NOT closed by Jev with a context hint, a clean negative result — but Jev also never
  introduced a false merge on any tested negative-control pair, and its one curated-alias miss
  (an easy case) suggests it isn't a reliable drop-in even for what the fold already handles well.
  **Recommendation: do not pursue this replacement** based on this evidence.
- **Per-clue fidelity/localization (2)**: the most genuinely promising result — a real,
  mechanistically clean catch on PZL-0038 (SPIKE-014's own hand-diagnosed failure, reproduced
  automatically) — but the PZL-0010 false-positive rate shows the simple select-then-judge design
  as built doesn't generalize to compound/conditional clues. **Worth a follow-up spike**
  specifically on improving the SELECT step (e.g. giving Jev the draft's own `%`-comments as
  context, or allowing multi-line selection) before drawing a final verdict — the PZL-0038 result
  alone is strong enough evidence this direction isn't dead.

**For RFC-003**: cite §5.4's PZL-0038 result and §5.1's framing-gate result as the two candidates
worth a dedicated follow-up spike; cite §5.3's negative result on the alias-folding replacement as
closing that specific candidate (§7.1/§7.4 remain otherwise unaffected — this spike doesn't touch
the intermediate-representation or offline-testing open questions directly). Manual citation into
RFC-003's Open Questions/Appendix is a step the user takes separately, per this skill's own
scope guard.
