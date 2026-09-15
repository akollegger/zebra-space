---
id: SPIKE-013
title: Isolating Vocabulary Construction — Self-Consistency, Correctness, and Two Library Candidates
status: in-progress
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
   with correctness scored only against the determinate ~11.

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
