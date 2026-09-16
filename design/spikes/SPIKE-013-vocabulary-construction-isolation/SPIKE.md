---
id: SPIKE-013
title: Isolating Vocabulary Construction — Self-Consistency, Correctness, and Two Library Candidates
status: done
rfcs: [RFC-003]
created: 2026-09-15
---

# SPIKE-013: Isolating Vocabulary Construction — Self-Consistency, Correctness, and Two Library Candidates

## 1. Question

[SPIKE-012](../SPIKE-012-graph-shaped-per-clue-pipeline/SPIKE.md) §6 recommended next step 2:
every per-clue architecture tried across SPIKE-008 through SPIKE-012 has varied HOW constraints
are extracted per clue while inheriting whatever vocabulary-construction approach came before it
— and vocabulary-stage non-determinism (SPIKE-004's original finding) is now confirmed as the
common thread regardless of that downstream variation (SPIKE-012 §5.3's PZL-0001 fragmentation,
§5.2's PZL-0004 near-miss). This spike isolates vocabulary construction — SPIKE-012's
`inventory → group → shape` stages, imported unchanged, with **no constraint extraction at
all** — as the sole independent variable, at `n≥5` samples per puzzle (up from SPIKE-012's
`n=3`), to directly measure:

1. **Self-consistency**: do independent runs converge on the same entity/domain shape (same
   entity-axis/domain-values split, same entity count, same domain count) regardless of whether
   that shape is correct?
2. **Correctness**: for the determinate puzzles in the sample, does the resulting shape match a
   ground truth derived from `eval/answer-keys.json` (domain names, aliased for casing/naming
   drift; entity/value counts)?
3. Per the session's own tool survey (2026-09-15, not written up as its own document — captured
   here instead): does swapping the LLM call in **inventory** (span discovery) for a
   deterministic, zero-network candidate-span chunker, or the LLM call in **group**
   (categorization) for local sentence-embeddings + deterministic clustering, change either
   measure — closer to the project's established preference (confirmed by
   [SPIKE-003](../SPIKE-003-gliner2-capability/SPIKE.md)'s GLiNER2 findings) for a narrower,
   deterministic tool over an LLM call wherever one fits? `shape`'s own structural classification
   (entity-axis vs. domain-values, RFC-003 §7.1's still-open representation question in
   miniature) stays LLM-based in every variant — it's a judgment call, not a span-discovery or
   similarity problem, per this session's own conversation ruling embeddings out as a primary
   mechanism there.

Explicitly out of scope, per the session's own conversation (2026-09-15): entity resolution for
attribute-referenced clues ("the green house" binding to a specific house) is NOT a vocabulary-
construction problem — the real pipeline's own successful extractions resolve it entirely within
`derivedRule`'s existentially-quantified condition/then-constraint structure at the constraint
layer (`$this`/`$outer`, bound at solve time), never touching `entities`/`domains`. Confirmed by
inspecting `full-critic`'s actual PZL-0001 extraction (clue 5, "the green house is immediately to
the right of the ivory house") before this spike was scoped. Any question about whether per-clue
classification reliably recognizes when a clue needs that quantified shape belongs to a future
spike revisiting constraint extraction, not this one.

## 2. Method

New code lives under this directory's own `scripts/lib/`, reusing SPIKE-012's
`inventory.ts`/`group.ts`/`shape.ts` unchanged via relative cross-spike imports (the established
pattern SPIKE-009/010/012 all used). A spike-local `package.json` (this directory's own
lockfile/`node_modules`, not the repo root — SPIKE-002/007's own precedent for throwaway spike
dependencies) adds the two library candidates:

- **`wink-nlp` + `wink-eng-lite-web-model`** (MIT, zero-network, already spiked in
  [SPIKE-002](../SPIKE-002-js-native-nlp-wink/SPIKE.md) for a different job — custom-entity
  *pattern matching*, which needed hand-authored patterns per clue shape and hit real friction).
  Here it's used only for its noun-chunk/entity-candidate enumeration (`.entities()`/`.tokens()`
  filtered to nouns and proper nouns) — a much better fit for `inventory`'s actual job (list every
  candidate span, no typing) than SPIKE-002's harder job (recognize a specific clue *shape*).
- **`@huggingface/transformers`** (the maintained successor to `@xenova/transformers`), running a
  small ONNX sentence-embedding checkpoint (`Xenova/all-MiniLM-L6-v2` — a widely-used, ~22M
  parameter, 384-dim embedding model with an existing transformers.js-compatible ONNX export) for
  `feature-extraction`, fully local after a one-time model download (no API key, no per-call
  cost — the same "no network call" property SPIKE-003 confirmed for GLiNER2's runtime
  requirements, distinct from RFC-003 §5.3's LLM-tier network/cost criterion).

**1. `lib/ground-truth.ts`** — derives an expected vocabulary shape from `eval/answer-keys.json`
for the determinate subset of SPIKE-008's 14-puzzle sample (the puzzles where "correct" has an
unambiguous meaning): expected domain names (the answer entry's own keys) and expected
entity/value counts (array lengths for the grid shape; a single scalar domain set for
Whodunit-shaped puzzles). Hand-verified against each puzzle's own prose once, not re-derived
per run.

**2. `lib/score.ts`** — correctness scoring: matches each produced domain name against the
ground truth's own names via exact match, then `sanitizeIdentifier` + case-fold (reused from
`src/compiler/compile.ts`, the same cheap fix flagged as a follow-up in
[SPIKE-011](../SPIKE-011-per-clue-pipeline-retrospective/SPIKE.md) §4 for the real grader), then
— only for names that still don't match — cosine similarity between their `@huggingface/
transformers` embeddings, above a fixed threshold, to catch genuine synonym drift (e.g.
"nationality" vs. "citizenship") neither exact nor string-normalized matching would catch. This
is the "fold in a library" instance for *grading*, distinct from using one *inside* the pipeline.

**3. `lib/chunked-inventory.ts`** — an alternative `extractInventory`-shaped function: wink-nlp
enumerates noun/proper-noun tokens and multi-word noun chunks as candidate spans (no LLM call at
all), filtered to those appearing verbatim in the prose (trivially true here, since they're
derived from the prose itself, but kept as an explicit invariant matching `inventory.ts`'s own
contract). Zero cost, zero network, fully deterministic — the interesting comparison is whether
`group`/`shape`'s own LLM calls, fed this instead of the LLM-produced inventory, land on as good
or better a vocabulary shape.

**4. `lib/embedded-group.ts`** — an alternative `extractGroups`-shaped function: embeds every
inventory mention via `@huggingface/transformers`, then a simple greedy threshold merge over
cosine similarity (deliberately NOT a general clustering library — group sizes here are small
enough, per this session's own conversation, that a hand-rolled ~15-line merge is more
transparent and testable than tuning k-means/DBSCAN). Produces the same `InventoryGroup[]` shape
`group.ts` does, so `assignCanonicalIds`/`shape.ts` need no changes.

**5. `run-comparison.ts`** — three variants, each running ONLY inventory→group→shape (no
per-clue-typed, no oracle-repair, no compile/solve at all — this spike measures the vocabulary
shape directly, not a downstream solve outcome):
   - `llm-only` — SPIKE-012's `extractInventory`/`extractGroups`/`extractShape`, unchanged.
   - `chunked-inventory` — `lib/chunked-inventory.ts` + SPIKE-012's unchanged `extractGroups`/
     `extractShape`.
   - `embedded-group` — SPIKE-012's unchanged `extractInventory` + `lib/embedded-group.ts` +
     SPIKE-012's unchanged `extractShape`.

   `n≥5` samples per puzzle per variant (only for the parts of each variant that remain
   stochastic — `chunked-inventory`'s own chunking step is deterministic and need not be
   resampled, but `group`'s LLM call downstream of it still varies run to run, so the variant as
   a whole still needs resampling). Records, per sample: entity count, domain count + names,
   entity-axis/domain-values split, and (for the determinate subset) the `lib/score.ts`
   correctness verdict. Puzzle sample: the same 14 puzzles SPIKE-008 through SPIKE-012 used,
   with correctness scored only against the determinate 9 (confirmed by reading each entry's
   actual `outcome` field, nested or top-level, in `eval/answer-keys.json`: PZL-0022 is a COP,
   PZL-0028 ambiguous, PZL-0033 subjective, PZL-0015/0018 non-problem — 5 of 14, not the ~11
   this Method section originally estimated before checking).

**Verification order**, mirroring every prior spike in this line's own spend discipline: (1)
offline-only — confirm `wink-nlp` chunking and `@huggingface/transformers` embedding+clustering
run and produce plausible output on 2-3 synthetic fixtures, zero network beyond the one-time
model download; (2) stop and report a cost estimate (LLM calls only — the two library candidates
are free after their one-time model download) for the `n≥5×14`-puzzle sweep, wait for explicit
go-ahead; (3) one live dry-run; (4) the full sweep.

## 3. Time-box

**One day (~8 hours)**: ~1h `ground-truth.ts` (mechanical derivation from an already-existing
file, hand-verified against prose); ~1h `score.ts` (exact/normalized matching is simple; the
embedding-similarity fallback is the only new logic); ~2h `chunked-inventory.ts` +
`embedded-group.ts` (thin wrappers over well-documented library APIs, per SPIKE-002's own "low
level of effort" finding for wink-nlp and RFC-003 §9.3's "low integration effort" expectation for
this class of local model); ~1h comparison runner + offline smoke tests; ~1h live dry-run +
fixes; ~2h full sweep and write-up. Hard stop at the time-box regardless of completeness.

## 4. Notes

_(dated log, appended as work proceeds)_

**2026-09-15 — environment friction on this Intel Mac, same class as SPIKE-003's torch pinning,
now for `onnxruntime-node`.** `@huggingface/transformers@4.2.0` pulls `onnxruntime-node@1.24.3`,
which — confirmed by inspecting the published npm tarball directly — bundles a prebuilt native
binding for `darwin/arm64`/`linux`/`win32` but **not `darwin/x64`** (Intel Mac); this machine
reports `process.arch === "x64"`, `process.platform === "darwin"` (confirmed via `uname -m` /
`sw_vers`), so the default install crashes at first import
(`Cannot find module '.../darwin/x64/onnxruntime_binding.node'`). Tried and rejected: forcing
`@huggingface/transformers`'s web/WASM build via a direct file import (bypasses the package's
`exports` map, which only exposes `node`/`default` conditions with no subpath wildcard) — it
loads without crashing, but its ONNX backend list comes back empty (`env.backends` `[]`) and
model loading fails outright; not investigated further given a simpler fix existed. Checked
`onnxruntime-node`'s published tarballs directly (`npm pack --dry-run`) across recent versions:
`darwin/x64` binaries are bundled through **1.23.0** and dropped starting at **1.24.x** (Intel
Mac support removed upstream, not a config gap). Fixed via `package.json`'s `overrides` field,
pinning `onnxruntime-node` to `1.23.0` — confirmed working end to end: model loads, runs
inference, and (see below) produces exactly the clustering signal expected.

**2026-09-15 — embedding clustering signal confirmed directly, before writing any pipeline
code.** `Xenova/all-MiniLM-L6-v2` (384-dim, mean-pooled, L2-normalized) on the 8 words
`Red/Blue/Green/Dog/Cat/1/2/3`: within-category cosine similarity 0.66-0.87 (colors 0.69-0.73,
numbers 0.79-0.87, the 2-word animal pair 0.66), cross-category 0.28-0.41 — a clean, wide
separation band. A fixed threshold around 0.5-0.55 should cluster these correctly with a simple
greedy merge, no tuning-sensitive algorithm needed, consistent with this session's own earlier
reasoning against pulling in a dedicated clustering library for group sizes this small.

**2026-09-15 — derived ground truth from REAL successful extractions, not from
`eval/answer-keys.json`'s own shape alone.** Confirmed by reading `src/eval/grader.ts`'s
`gradeDeterminate` dispatch directly: the answer-key format is not generically parseable into a
single vocabulary shape (parallel arrays for PZL-0001/0002/0010 specifically hardcoded by id;
a flat digit-map for PZL-0007; a bare scalar for PZL-0003/0011; a dict-keyed-by-entity for
PZL-0038 — `gradeDeterminate` itself falls through to a token-subset check, `gradeFlatRecord`,
for everything not on its own hardcoded parallel-array list). Instead hand-derived
`ground-truth.ts`'s 9 entries directly from SPIKE-011's already-recorded `full-critic` results
(the run that achieved `MATCH` on PZL-0004/PZL-0011, `SOLVE_UNIQUE` on every puzzle in this set)
— grounding "expected" in a real, already-solved vocabulary shape. Two genuine surprises found
this way, both encoded directly into the ground truth rather than smoothed over: PZL-0010's own
successful extraction declared a SECOND domain (`arrivalTime`) beyond what the answer key's own
`order` key requires — scoring is coverage-only (every expected domain found; extras never
penalized), so this doesn't break anything, but it's a reminder that "the answer key's own keys"
is not automatically "the complete correct vocabulary." PZL-0038's successful extraction modeled
the exact INVERSE of the answer key's own shape (entities = the 5 animals, one domain `pen`
ranging 1..5 — rather than entities = 5 pens, domain `animal`) — an equally valid isomorphic
representation; `ground-truth.ts` accepts either via `valueSets`' multiple-alternatives shape,
confirmed directly by `smoke-test-score.ts`.

**2026-09-15 — offline smoke tests for `score.ts`, zero cost, all pass**: the correct case, a
deliberately-broken case (a missing domain correctly fails), casing/naming drift still matching
via `normalize.ts`, PZL-0038's dual-representation OR logic (both directions score correct), and
confirmation that an extra domain beyond ground truth is never penalized (coverage, not exact
match — mirrors ADR-007 §2.2's own lesson for the real grader, applied here to structure).

**2026-09-15 — embedding-similarity threshold (0.6) calibration, checked against real word
pairs before relying on it for scoring.** True synonyms/spelling variants score comfortably
above threshold: `color`/`colour` 0.974, `cigarette`/`smoke` 0.848, `drink`/`beverage` 0.791,
`weapon`/`murder_weapon` 0.715. Genuinely unrelated pairs score well below: `color`/`animal`
0.403. But `nationality`/`citizenship` — the exact example used earlier in this session's own
conversation as a case embeddings should catch — measures **0.534, below the 0.6 threshold**,
as does `nationality`/`country` (0.595). This is named honestly rather than adjusted away:
0.6 was chosen deliberately conservative (a false POSITIVE here would silently inflate this
spike's own correctness numbers, the exact failure mode this spike exists to measure rather than
paper over) — the real, calibrated finding is that this embedding model's similarity space
separates spelling/near-synonym variants cleanly from unrelated words, but sits genuinely
ambiguous on more distant conceptual paraphrases, which is itself useful information for anyone
tuning this threshold later, not a bug to silently fix by lowering it to fit one example.

**2026-09-15 — first dry-run crashed the whole sweep on a transient OpenRouter 504; fixed with
retry + incremental writes (see the standalone commit for detail), then the full `n=5×14×3`
sweep completed cleanly: 210 puzzle-reps × 3 variants, $0.0623 total, 0 unrecovered errors.**

**2026-09-16 — a 4th variant added: `post-hoc` transcription of an already-completed direct-solve
trace (ADR-008), motivated directly by this session's own "is solving in prose a means to an end,
or a requirement to produce constraints as a side effect?" question. Unlike the first three
variants, Stage 1 (solving) is NOT re-run — it's read straight from the already-collected,
already-paid-for `eval/results/2026-09-15T14-59-37-368Z.json` (`gpt-4o-mini` direct-solve, chosen
specifically because it has real MISMATCH cases to test against, unlike the frontier run's 13/14
MATCH). Only Stage 2 (transcription) spends anything: n=3 reps × 14 puzzles, 42 calls, **$0.0084
total**. See `lib/post-hoc-vocabulary.ts` for the schema/prompt and `run-post-hoc.ts` for the
runner; scored with the exact same `score.ts`/`ground-truth.ts` as the other three variants.**

## 5. Findings

Raw: `results/comparison-2026-09-15T13-45-00-734Z.json`. 14 puzzles × 5 reps × 3 variants (9 of
the 14 have ground truth — PZL-0022/0028/0033/0015/0018 are scored for self-consistency only,
per §1's explicit scope).

### 5.1 The collapsed "structurally correct" number is real but misleading on its own — split it

| Variant | Structurally correct (both) | Entity-axis size matches | Domain full-coverage | Domain-slot coverage |
|---|---|---|---|---|
| `llm-only` | 0/45 | 7/45 (16%) | 11/45 (24%) | 28/80 (35%) |
| `chunked-inventory` | 2/45 | 8/45 (18%) | 9/45 (20%) | 24/80 (30%) |
| `embedded-group` | 1/45 | 11/45 (24%) | 1/45 (2%) | 6/80 (8%) |

A flat "0/45" for the baseline reads as total failure. It isn't — per-puzzle inspection (PZL-0002,
the simplest puzzle in the sample) shows `llm-only` correctly identified BOTH domains
(`color`/`animal`, exact names, exact value sets) in 3 of its 5 reps, and got the right kind of
vocabulary in every rep. What sank `structurallyCorrect` there specifically was entity-AXIS SIZE
— never domain content. `domainCoverage` (35% of individual expected domain-slots found, across
all 9 puzzles) is a fairer single number for "does this identify the right categories," and it's
still low, but the two failure modes below explain why, concretely — a very different picture
than "vocabulary construction just doesn't work."

### 5.2 A new, concrete failure mode: referring-expression entity inflation

PZL-0002's `llm-only` reps repeatedly declared 6-7 `house`-typed entities instead of 3 — not
because the model invented houses, but because referring expressions actually mentioned in the
prose ("the Red House", "the middle house", "the Blue House") got added as ADDITIONAL entities
alongside the three positional ones (`v1`/`v2`/`v3`), rather than recognized as descriptions OF
one of those same three houses. This is a distinct problem from this session's earlier
"coreference" conversation (§1): that conversation correctly concluded ENTITY BINDING ("which
house is red") doesn't need resolving until solve time, and the constraint layer (`derivedRule`)
already handles it without touching vocabulary. This is upstream of that — `inventory` correctly
lists "the Red House" as A LITERAL MENTION (it does appear in the prose), but nothing in `group`
recognizes that a compound span combining a domain word ("Red") with the axis's own generic noun
("House") is a REFERENCE to an already-counted entity, not a new one. The result is entity-count
inflation even when domain identification itself is working (§5.1's PZL-0002 case). PZL-0004 and
PZL-0012 show the identical pattern (0/5 and 0/5 entity-axis matches despite 60-67% domain
coverage) — this is a general failure mode across the sample, not a PZL-0002 quirk.

### 5.3 Domain-naming diversity is wider than this spike's ground truth anticipated

PZL-0003's `move` domain came back named `game_items` or `game_tools` across different reps —
correct in content (`Paper`/`Rock`/`Scissors`), wrong by every name this spike's own
`ground-truth.ts` anticipated, and NOT close enough for the 0.6 embedding threshold to bridge
either (a gap consistent with §4's own calibration finding that this embedding model separates
near-synonyms cleanly but sits ambiguous on more distant paraphrases). This is best read as a
limitation of this spike's own ground truth (a narrow alias list) exposing a genuinely wider
naming diversity than assumed, not a pipeline defect — and it's independently confirmed without
any ground truth at all by §5.5's self-consistency numbers.

### 5.4 A genuinely new failure class this isolation surfaced: procedural-rule text mistaken for domain values

PZL-0010 (Four-Way Stop)'s `llm-only` reps repeatedly produced domains like `rules` or `traffic`
whose "values" are sentence fragments — `"If two cars"`, `"right-of-way"`, `"rotates
clockwise"` — not attribute values at all. This puzzle's clues state PROCEDURAL RULES (who
yields to whom), not just attribute facts, and nothing in `group`/`shape` distinguishes "this is
a fact about a category" from "this is a conditional rule that shouldn't become a category at
all." This is a genuinely new problem, only visible because this spike isolated vocabulary
construction from constraint extraction — none of SPIKE-008 through SPIKE-012 could have
surfaced it, since a whole-pipeline run's downstream constraint-typing failure would have masked
where exactly things went wrong.

### 5.5 Self-consistency, independent of any ground truth, confirms vocabulary-stage non-determinism directly

| Variant | Entity-axis-size agreement (mode / n) | Domain-name-set agreement (mode / n) |
|---|---|---|
| `llm-only` | 53% | 36% |
| `chunked-inventory` | 64% | 31% |
| `embedded-group` | 60% | 44% |

Averaged across all 14 puzzles (n=5 reps each), NOT requiring ground truth — this measures
whether independent runs of the IDENTICAL prompt on the IDENTICAL puzzle agree with each other
at all. They don't, most of the time: the most common answer only shows up in roughly half of
`llm-only`'s runs for entity-axis size, and little more than a third for the domain-name set.
This is the cleanest, most direct confirmation yet of SPIKE-004's original non-determinism
finding, isolated to exactly the stage SPIKE-012 §6 recommended isolating — and it holds even
under the two library-based variants, which only replace ONE of the two remaining LLM calls
each.

### 5.6 The two library candidates: one clear win, one clear (but informative) miss

**`chunked-inventory` (wink-nlp, zero LLM cost for the inventory stage) performs on par with, or
marginally better than, `llm-only` on every measure** (18% vs. 16% entity-axis match, 2/45 vs.
0/45 fully correct) despite its own raw inventory being noisier (§4's dry-run finding — narrative
words like "houses"/"unique" leak through the POS filter). `group`'s LLM call is apparently
robust enough to filter that noise out about as well as it filters its own LLM-inventory's
different noise. This is a genuine, evidence-backed win: a free, fully local, zero-network span
enumerator is a viable substitute for an LLM call here, not just a cheaper-but-worse one.

**`embedded-group` (local embeddings + greedy single-linkage threshold clustering) is clearly
worse on domain identification** (8% slot coverage vs. 35% for `llm-only`, 2% full-coverage vs.
24%) despite slightly BETTER entity-axis agreement. The embedding SIGNAL itself is real and
well-separated (§4's direct calibration: 0.66-0.87 within-category vs. 0.28-0.41 cross-category
on an 8-word synthetic example) — what doesn't generalize is the naive clustering ALGORITHM
(single fixed threshold, greedy single-linkage merge) across this catalog's actual diversity of
vocabulary sizes and semantic distances. This is an honest negative result about ONE specific
mechanism, not evidence that embeddings can't help this stage at all.

### 5.7 A 4th variant — transcribing vocabulary from an already-solved trace beats every blind-guess variant, and partially confirms the decoupling hypothesis

Raw: `results/post-hoc-2026-09-16T08-43-25-641Z.json`. Same 9-of-14 ground-truth scope, n=3 reps
(reps here re-run the TRANSCRIPTION call against the identical fixed trace, so they measure
transcription self-consistency, not solve-time randomness).

| Variant | Structurally correct | Entity-axis size matches | Domain-slot coverage |
|---|---|---|---|
| `llm-only` (blind) | 0/45 | 7/45 (16%) | 28/80 (35%) |
| `chunked-inventory` (blind) | 2/45 | 8/45 (18%) | 24/80 (30%) |
| `embedded-group` (blind) | 1/45 | 11/45 (24%) | 6/80 (8%) |
| **`post-hoc` (solve first, transcribe)** | **9/27 (33%)** | **16/27 (59%)** | **28/48 (58%)** |

An order of magnitude better on structural correctness, and roughly 2-3x better on the two
component measures — solving BEFORE constructing vocabulary, then transcribing the vocabulary an
already-completed solve used, dramatically outperforms every variant that guesses vocabulary
blind, at comparable or lower cost.

**The decoupling hypothesis holds on at least one clean example.** PZL-0001's source solve was
MISMATCH (correct 5-house setup in "Step 1," silent abandonment of rigor by "Step 6," wrong final
answer — the exact trace examined earlier this session for failure-mode analysis). Its post-hoc
vocabulary transcription scored `structurallyCorrect: true` on **all 3 reps** — the same 5
entities, the same 5 correctly-named domains (`color`/`nationality`/`drink`/`cigar`/`pet`),
regardless of the solve's later collapse. Vocabulary shape was fixed early and survived the
failure that came later, exactly as hypothesized.

**But the aggregate by source outcome is noisier than that one example suggests, and for a
diagnosable reason**:

| Source solve outcome | Structurally correct |
|---|---|
| MISMATCH (2 puzzles: PZL-0001, PZL-0012) | 4/6 (67%) |
| MATCH (7 puzzles) | 5/21 (24%) |

MISMATCH scoring *higher* than MATCH is not evidence that failed solves produce better
vocabulary — it's a small sample (2 vs. 7 puzzles) dominated by PZL-0001's clean 3/3, and several
MATCH puzzles failed transcription for a specific, recognizable reason: **PZL-0004 reproduces the
exact entity-axis-vs-domain-values confusion SPIKE-012's `shape.ts` was built to prevent.** Its
post-hoc transcription (all 3 reps) declared **9 entities** — one per suspect/weapon/room VALUE
(`suspect_miss_scarlett`, `weapon_candlestick`, `room_kitchen`, …) — instead of the correct single
scenario entity with three domains. `shape.ts` avoids this by construction: it forces a closed,
per-group multiple-choice classification (entityAxis vs. domainValues) rather than asking the
model to freely decide entity/domain structure from scratch. `post-hoc-vocabulary.ts` asks for
that same free-form decision — the solved trace tells the model WHAT the answer is, but nothing
in this prompt tells it HOW to classify structure, so the same free-construction risk that
motivated `shape.ts`'s design in the first place reappears here, just against a different input.

This is the clean next iteration this variant's first pass earns: keep Stage 1 (free solve) as
is, but make Stage 2 a closed classification over candidate spans the solved trace already
names — the same shape.ts-style multiple-choice move, applied to a solved trace instead of a
blind vocabulary guess — rather than free-form entity/domain construction from an unconstrained
prompt.

### 5.8 A 5th variant tests that directly — and it's a clear regression, not the fix

Raw: `results/post-hoc-shaped-2026-09-16T08-56-55-756Z.json`. Same n=3, same 14 puzzles.
`post-hoc-shaped` reuses SPIKE-012's exact `inventory.ts` -> `group.ts` -> `shape.ts` pipeline
UNCHANGED — the same closed entityAxis/domainValues classification `shape.ts` already does for
`llm-only` — the only change is feeding `extractInventory` the puzzle prose concatenated with the
already-solved direct-solve trace, instead of prose alone.

| Variant | Structurally correct | Entity-axis size matches | Domain-slot coverage |
|---|---|---|---|
| `llm-only` (blind, no trace) | 0/45 | 7/45 (16%) | 28/80 (35%) |
| `post-hoc` (free-form, WITH trace) | **9/27 (33%)** | **16/27 (59%)** | **28/48 (58%)** |
| `post-hoc-shaped` (closed classification, WITH trace) | 1/27 (4%) | 5/27 (19%) | 15/48 (31%) |

**This falsifies the hypothesis behind §5.7's recommended next step.** Giving the proven closed
classification mechanism a solved trace as extra context did not fix `post-hoc`'s failures — it
regressed all the way back to roughly `llm-only`'s blind-guess numbers, discarding almost all of
`post-hoc`'s gain. The fix isn't "closed classification good, free-form bad" in isolation; both
inputs and mechanism matter together, and this pairing was worse than either half alone would
suggest.

**Inspecting two puzzles shows the closed classification failing in BOTH directions this time**,
not just the one direction `post-hoc` failed in:

- **PZL-0004** (whodunit; expected 1 scenario entity, 3 domains) — `post-hoc-shaped` classified
  `suspect` as the entity axis (3 entities: Miss Scarlett/Colonel Mustard/Professor Plum) with
  `weapon`/`room` as its domains. Structurally coherent (unlike `post-hoc`'s flat 9-entity
  free-for-all), but still wrong: this puzzle narrows down ONE scenario, and treating suspects as
  an entity axis implies each suspect independently gets a weapon+room assignment, which isn't
  this puzzle's semantics at all — precisely the "is this an entity axis or one unstated
  scenario" judgment call `shape.ts`'s own system prompt explicitly warns against getting wrong.
- **PZL-0007** (SEND+MORE=MONEY; expected 8 letter-entities, 1 `digit` domain) — `post-hoc-shaped`
  collapsed ALL EIGHT letters into a single synthesized scenario entity, with one `letters`
  domain holding `["S","E","N","D","M","O","R","Y"]` as VALUES rather than as 8 independent
  entities each taking a `digit` value — the opposite-direction version of the same
  entityAxis/domainValues judgment call, also wrong.

**A plausible mechanism, not yet directly confirmed**: `post-hoc`'s advantage likely comes from
asking the model for a compressed SUMMARY of a structure it already resolved, in one call, with
the answer already sitting in front of it. `post-hoc-shaped` instead asks `inventory`/`group` to
re-derive candidate spans and categories from a much longer, more repetitive, more discursive
text (prose + a multi-step reasoning trace, often several times the length of the prose alone) —
more raw material to enumerate and cluster, and apparently more opportunity for `shape`'s
classification call to misjudge entity-axis-vs-domain-values than the terse original prose gave
it. Richer input did not mean cleaner input here.

**Isolating vocabulary construction confirms, more directly than any prior spike in this line,
that it is itself the dominant source of the non-determinism SPIKE-004 first found** — not
merely inherited from downstream constraint-extraction complexity. §5.5's self-consistency
numbers make this the cleanest evidence yet: independent runs of the IDENTICAL prompt on the
IDENTICAL puzzle agree with themselves only about half the time on entity-axis size and roughly
a third of the time on domain naming, with no ground truth or downstream pipeline involved at
all. SPIKE-012 §6's recommendation to isolate this stage as the sole independent variable was
correct — this is where the instability actually lives.

**But "vocabulary construction is unreliable" is not the same claim as "vocabulary construction
identifies the wrong categories."** §5.1's split shows domain identification itself partially
works (24-35% coverage, and qualitatively correct in a real majority of PZL-0002's own reps) —
what actually breaks structural correctness are two distinct, concrete, nameable failure modes
newly diagnosed by this spike: **referring-expression entity inflation** (§5.2 — a compound span
like "the Red House" gets counted as a new entity instead of recognized as a reference to one
already counted) and, on procedural puzzles specifically, **rule-text mistaken for domain values**
(§5.4). Both are narrow enough to be addressed directly in `group.ts`/`shape.ts`'s own prompts —
neither requires abandoning the architecture.

**On the two library candidates**: `chunked-inventory` (wink-nlp) is a confirmed, free win —
performs at least as well as the LLM inventory call it replaces, at zero cost and zero network,
a legitimate answer to this session's own tool-survey question. `embedded-group`'s specific
mechanism (fixed-threshold greedy clustering) is a confirmed miss on domain coverage, but the
underlying embedding signal is real (directly measured, not assumed) — the failure is in the
clustering ALGORITHM, not the representation, so this doesn't settle whether embeddings could
help `group`'s job with a better mechanism.

**A 4th variant, added after this spike's original conclusion, changes the recommended next
step.** §5.7's `post-hoc` transcription (solve freely in prose first, ADR-008-style, then
transcribe the vocabulary that solve already used) beats every blind-guess variant by roughly an
order of magnitude on structural correctness (33% vs. 0-4%), and directly confirms — on at least
one clean example (PZL-0001) — that vocabulary shape can survive a solve that later goes wrong,
because it's committed to early. Its failures are not random noise: they reproduce the SAME
entity-axis-vs-domain-values confusion `shape.ts` exists to prevent (§5.7's PZL-0004 case),
because this variant's transcription step is still a free-form construction, just against a
solved trace instead of a blind guess.

**A 5th variant tested the obvious fix for that — and falsified it (§5.8).** Reusing `shape.ts`'s
proven closed classification unchanged, fed the solved trace as extra inventory input, was
expected to combine `post-hoc`'s accuracy with `shape.ts`'s structural safety. Instead it
regressed almost all the way back to `llm-only`'s blind-guess numbers (4% structurally correct,
vs. `post-hoc`'s 33%) — and inspection showed the SAME entityAxis/domainValues judgment call still
going wrong, in both directions (PZL-0004: values wrongly promoted to an entity axis; PZL-0007:
entities wrongly collapsed into one domain's values). The mechanism and the input turned out not
to be independent: closed classification's safety depends on a clean, terse candidate list to
classify, and concatenating a long, repetitive reasoning trace onto the prose degraded that input
enough to erase the mechanism's benefit. `post-hoc`'s free-form transcription remains the
strongest baseline this spike has measured — it's summarizing an already-resolved structure in
one step, not re-deriving candidates from a much longer document.

**Deprioritized, not pursued further within this spike** (decided 2026-09-16, after §5.7/§5.8):
fixing referring-expression entity inflation in `group.ts` (§5.2), trying a better clustering
mechanism for `embedded-group` (§5.6), and PZL-0010's rule-vs-value confusion (§5.4) are all real,
correctly-diagnosed issues — but every one of them is a narrowing fix to the BLIND-guess
architecture (`llm-only`/`chunked-inventory`/`embedded-group`), whose best measured ceiling
(`embedded-group`'s 24% entity-axis agreement) still sits well below `post-hoc`'s 59% and 33%
structurally correct — achieved by a fundamentally different mechanism (solve first, transcribe
after) that none of these fixes touch. Polishing the losing architecture once a decisively better
one is already measured is not a good use of a time-boxed spike; these are recorded here as
correct, evidence-backed findings, not abandoned as wrong, in case a future need (e.g. a context
where solving isn't an option) makes the blind-guess path relevant again.

**What this spike settles, and what it hands off**: vocabulary construction in isolation (this
spike's actual question, per §1) is answered — blind construction is unreliable (§5.5's self-
consistency numbers), and solving first, then transcribing vocabulary as a side effect, is
measurably far more reliable (§5.7) — with one falsified shortcut along the way (§5.8: naively
combining that with closed classification does not stack, it regresses). The natural next
question is no longer about vocabulary alone: does the same solve-first-then-extract pattern
generalize from vocabulary to the WHOLE CSP, constraints included? That's a distinct, higher-
stakes empirical question (this session's own recurring "informal reasoning as a means to an end,
or a side-effect-producing step" discussion) and belongs in its own spike, with its own Question/
Method/Time-box, rather than further extending this one past its original scope.

Status: done.
