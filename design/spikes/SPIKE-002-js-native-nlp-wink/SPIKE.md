---
id: SPIKE-002
title: JS-Native NLP Library (wink-nlp) Extraction
status: done
rfcs: [RFC-003]
created: 2026-08-18
---

# SPIKE-002: JS-Native NLP Library (wink-nlp) Extraction

## 1. Question

Per [RFC-003](../../rfc/RFC-003-natural-language-csp-extraction.md) Appendix §9.2: is wink-nlp's
custom-entity pattern matcher a net simplification over hand-rolled regex/grammar (the §9.1
rule-based tier) for extracting this catalog's clues — and, per
[SPIKE-001](../SPIKE-001-catalog-clue-audit/SPIKE.md)'s shape taxonomy, how far does it reach
beyond the simple shapes (A/B/C/D) into the harder ones (E: relational fact + generative
meta-rule, F: implicit spatial/arithmetic from a named problem type, H/I: numeric threshold +
derived variable + rule-chain, K: embedded table + vocabulary mapping)?

## 2. Method

Built a small throwaway Node/TypeScript script using `wink-nlp` + `wink-eng-lite-web-model`,
defining custom-entity patterns for clue shapes and running them against
[SPIKE-001](../SPIKE-001-catalog-clue-audit/SPIKE.md)'s recommended stratified sample:
`PZL-0001` (A/B baseline), `PZL-0005` (E), `PZL-0008` (F), `PZL-0011` (H/I), `PZL-0013` (K).
Dependency kept local to `design/spikes/SPIKE-002-js-native-nlp-wink/package.json` (its own
lockfile/`node_modules`), not added to the repo root, since this is throwaway spike tooling, not
a production dependency.

## 3. Time-box

≤1 day.

## 4. Findings

Script: `scripts/spike.mjs` (run with `node scripts/spike.mjs` from this directory, after
`pnpm install`). Full output preserved by re-running; summary below.

**Shapes A/B/C/D (simple — PZL-0001)**: all four patterns (attribute-assignment, positional,
adjacency, the passive-voice variant) matched correctly on the first attempt for their exact
phrasing. Confirms these shapes are cheap to cover, as RFC-003 §9.1/9.2 assumed. But: the
passive-voice variant of "drinks" ("Coffee is drunk in the green house.") did **not** match the
active-voice pattern written for "X drinks Y" — a separate pattern was needed. wink-nlp's
custom-entity matcher does not generalize across syntactic voice any more than hand-rolled regex
would; each surface variant still needs its own explicit pattern.

**Shape E (relational fact + generative meta-rule — PZL-0005)**: both the literal border-fact
sentence and the meta-rule sentence itself matched their own dedicated patterns without
difficulty. **But** this only confirms the *sentence* is recognizable — wink-nlp's matcher does
not, and cannot, apply the meta-rule to the previously-extracted facts to generate the derived
pairwise constraints. That's necessarily separate logic in the extraction pipeline, external to
the NLP layer, regardless of which tier is chosen for the sentence-recognition step itself.

**Shape F (implicit grid constraints — PZL-0008)**: two real, non-obvious integration failures:
1. A pattern containing a hyphenated compound written as `[CARDINAL]-by-[CARDINAL]` **throws at
   pattern-registration time** (`incorrect token "CARDINAL]-by-[CARDINAL"`), not a graceful
   no-match — and because `learnCustomEntities()` takes a whole array of pattern definitions in
   one call, this exception aborted the *entire* batch, silently preventing unrelated valid
   patterns registered in the same call from ever taking effect. Anyone using this tier needs to
   validate patterns individually, not just call `learnCustomEntities()` once with everything.
2. Root cause (confirmed via a token/POS diagnostic): wink-nlp's tokenizer splits any hyphenated
   compound into **three separate tokens** — e.g. `top-left` → `top` (ADJ), `-` (PUNCT), `left`
   (tagged **VERB**, not ADJ/NOUN — a genuine tagging error by the `wink-eng-lite-web-model` in
   this context). A pattern must explicitly account for the literal `-` PUNCT token between the
   two halves, and even then, the lite model's POS tagger got `left` wrong here, which would
   still break a POS-based pattern. A fallback pattern avoiding the hyphen syntax error entirely
   still got **NO MATCH** on both the grid-fill and cell-value sentences.
3. Separately, and expected: the row/column/diagonal-sum constraints implied by "magic square"
   are never stated in prose at all — no pattern, however well engineered, extracts text that
   isn't there. This confirms SPIKE-001's shape-F prediction directly: it needs a rule keyed off
   recognizing the *problem type by name* ("magic square"), not a clue-text pattern.

**Shapes H/I (numeric threshold + rule-chain — PZL-0011)**: the pattern for rule-number ranges
(`rules [CARDINAL]-[CARDINAL]`) hit the **same hyphenated-compound registration crash** as Shape
F, for the same underlying reason (`1-2` tokenizes the same way as `3-by-3` or `nut-free`). This
blocked testing the threshold-rule pattern in the same batch too (per the batch-failure behavior
noted above) — this shape's cross-clue rule-numbering reference remains untested by this spike;
a follow-up would need to register that pattern in its own isolated call and pre-normalize
hyphenated numeric ranges before matching.

**Shape K (embedded table + vocabulary mapping — PZL-0013)**: `"Amara is vegan."` against pattern
`[PROPN] is [ADJ]` got **NO MATCH** — diagnostic showed `vegan` is tagged **NOUN**, not ADJ, by
this model. A predicate-noun/adjective ambiguity that's easy to miss when hand-authoring a
pattern from intuition rather than checking the actual tagger output. The markdown table row
itself (as expected) tokenized into meaningless punctuation-heavy fragments — no pattern-based
extraction is realistic there; confirms SPIKE-001's prediction that this shape needs a dedicated
table parser, not an NLP layer, regardless of tier.

## 5. Conclusion

**wink-nlp's pattern matcher is a real but partial simplification over hand-rolled regex** — for
shapes A/B/C/D it's clean and fast to write. Past that, three concrete frictions specific to this
library (not just "harder shapes exist," which SPIKE-001 already established) showed up:
(1) hyphenated compounds (`3-by-3`, `nut-free`, `1-2`) crash pattern *registration*, not just
matching, and abort the whole batch silently; (2) the lite model's POS tagger has real,
non-obvious errors on exactly the kind of compound-adjective tokens common in this catalog's
non-zebra puzzles; (3) predicate nouns-that-read-like-adjectives (`vegan`) need checking against
actual tagger output, not assumed from intuition. None of these are fatal — all are workable with
more careful pattern engineering (explicit `-` PUNCT tokens, per-pattern registration, tagger
verification) — but they add real engineering overhead beyond "just write a pattern," which
[RFC-003](../../rfc/RFC-003-natural-language-csp-extraction.md) §9.2's original "thin layer over
the rule-based tier's own pattern work" estimate should reflect.

**Suggested RFC-003 update** (manual): revise §9.2's Level-of-effort and Extensibility notes to
mention the hyphenated-compound tokenization gotcha and batch-registration-failure behavior as
concrete, tier-specific friction — not just "bounded by the custom pattern set" in the abstract.

**For the §9.3/9.4 spikes**: worth testing whether GLiNER2 and an LLM handle `top-left`,
`nut-free`, and `1-2`-style hyphenated compounds and the "magic square"/rule-cross-reference
shapes better out of the box — if either does, that's a meaningful, concrete differentiator this
spike surfaced, not just a theoretical one.
