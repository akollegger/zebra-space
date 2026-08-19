---
id: SPIKE-003
title: GLiNER2 Extraction Capability
status: done
rfcs: [RFC-003]
created: 2026-08-18
---

# SPIKE-003: GLiNER2 Extraction Capability

## 1. Question

Per [RFC-003](../../rfc/RFC-003-natural-language-csp-extraction.md) Appendix §9.3: does GLiNER2's
native schema-driven structured extraction achieve usable accuracy on this catalog's clue text —
and, per [SPIKE-001](../SPIKE-001-catalog-clue-audit/SPIKE.md)'s shape taxonomy, how far does it
reach into the harder shapes (E: relational+meta-rule, F: implicit spatial/arithmetic, H/I:
numeric threshold+derived variable+rule-chain, K: embedded table+vocabulary mapping) compared to
[SPIKE-002](../SPIKE-002-js-native-nlp-wink/SPIKE.md)'s wink-nlp findings? Scoped, per explicit
request, to GLiNER2's native capability only (its native Python interface) — not to how it would
eventually integrate into this project's TypeScript/Node codebase (that's a separate, later
question if this tier looks promising).

## 2. Method

Installed GLiNER2 (`pip install gliner2`) in an isolated Python virtual environment inside this
spike's own directory (not the repo's Node toolchain), loaded its default pretrained model, and
used its native schema-driven `extract()` API to define structured schemas per clue shape,
running them against SPIKE-001's recommended stratified sample: `PZL-0001` (A/B baseline),
`PZL-0005` (E), `PZL-0008` (F), `PZL-0011` (H/I), `PZL-0013` (K).

## 3. Time-box

≤1 day.

## 4. Findings

Script: `scripts/spike.py` (run with `python3 scripts/spike.py` from this directory, inside
`.venv` after `pip install gliner2`). Model: `fastino/gliner2-base-v1` (the package's documented
default), loaded via its native `extract_entities`/`extract_relations`/`extract_json` API.

**Environment friction (worth noting for Runtime requirements, separate from capability)**: this
machine is an Intel Mac (x86_64), and PyPI only ships `torch` up to `2.2.2` for that platform —
newer releases are Apple-Silicon/Linux/Windows only. A plain `pip install gliner2` pulled
`transformers==5.15.0`, which requires `torch>=2.5`, an unsatisfiable combination here. Getting a
working environment needed manually pinning `transformers==4.44.2`, `peft==0.11.1`, `numpy<2`,
and installing `setuptools` (not pulled in transitively by newer pip). This is a real
one-time environment-setup cost specific to this class of tier (a locally-run transformer model)
that neither the rule-based nor JS-native-NLP tiers have — worth a line in RFC-003 §9.3's Runtime
requirements, distinct from ongoing per-call cost.

**Shapes A/B/C/D (simple — PZL-0001)**: `extract_entities` correctly pulled all three
nationalities, both beverages, and all three house colors from one combined multi-sentence
passage — including correctly classifying "Coffee" from the **passive-voice** sentence
("Coffee is drunk in the green house") as a beverage, which
[SPIKE-002](../SPIKE-002-js-native-nlp-wink/SPIKE.md) found wink-nlp's pattern matcher could not
do without a second explicit pattern. Schema-driven `extract_json` on the assignment clue
returned a clean, correctly-structured `{"nationality": "Englishman", "house_color": "red"}`.

**Shape E (relational fact + generative meta-rule — PZL-0005)**: `extract_relations` returned an
actual **relation tuple** `("Avalon", "Borealis")` for "shares border with" — a materially
different (and more directly usable) result than SPIKE-002's wink-nlp finding, which could only
flag that the sentence matched a pattern, leaving the two country names to be parsed out
separately. Schema-driven extraction also decomposed the meta-rule sentence into
subject/condition/requirement fields cleanly. As with SPIKE-002: recognizing and structuring the
rule is not the same as **applying** it to generate the actual pairwise constraints — that
remains necessarily separate logic regardless of tier.

**Shape F (implicit grid constraints — PZL-0008)**: `target_sum` ("15") and the three given cell
values (4, 9, 5) were extracted correctly. `grid_size` came back `None` — the "3-by-3" hyphenated
compound was not resolved to a grid dimension, similar in kind to SPIKE-002's hyphenated-compound
finding, but with a **much better failure mode**: a missing field, not a crash that voids
unrelated extractions in the same call. The `given_cells` values were captured but not
associated with their stated cell positions (top-left/top-middle/center) — the schema as written
only asked for a flat list, so this is partly a schema-design limitation of this spike rather
than a hard model ceiling. As expected, the row/column/diagonal-sum constraints implied by
"magic square" are never generated — no extractor, however capable, can extract text that isn't
there; that logic is still necessarily external.

**Shapes H/I (numeric threshold + derived variable + rule-chain — PZL-0011)**: `person_fact`
correctly split a compound sentence into two clean records (`Priya: 680`, `Sam: 750`) — GLiNER2
handled compound-fact splitting SPIKE-002 never got to test. `rule_reference` correctly extracted
`"rules 1-2"` as the referenced-rules value **despite** the hyphenated numeric range that crashed
wink-nlp's pattern registration outright — a genuine capability advantage on exactly the case
SPIKE-002 flagged as untested. However, `threshold_rule`'s `comparison` field returned a garbled
`"lower"` when extracted from the full multi-sentence passage — an isolated single-sentence
re-test (`"If that score is below 600, the loan is Denied."` alone) got a materially better
`{"comparison": "600", "outcome": "loan is Denied"}`, confirming this was **cross-sentence
interference from batching multiple distinct clues into one extraction call**, not a hard
capability limit — a concrete, actionable finding: this tier's accuracy depends on calling it
per-clue, not per-puzzle. Even isolated, `comparison` captured the number ("600") but dropped the
comparator word ("below") — partial, not perfect, but far more usable than wink-nlp's complete
inability to test this shape at all.

**Shape K (embedded table + vocabulary mapping — PZL-0013)**: `dietary_requirement` correctly
extracted and **normalized** all three requirements — including deriving `"nut-free"` from "has a
nut allergy and needs a nut-free kitchen" and matching `"vegan"` correctly, exactly the case
where SPIKE-002 found wink-nlp's `[PROPN] is [ADJ]` pattern failed outright (because "vegan" is
POS-tagged as a noun, not an adjective). This is a clear, direct capability win for GLiNER2 on
the same input. The raw markdown table row, as expected, produced an **empty** result — no
crash, but no data either; confirms SPIKE-001's prediction that this shape needs a dedicated
table parser regardless of tier, though GLiNER2's graceful empty-result behavior here is a better
failure mode than a thrown exception.

## 5. Conclusion

GLiNER2 substantially outperforms the JS-native NLP tier ([SPIKE-002](../SPIKE-002-js-native-nlp-wink/SPIKE.md))
on every harder shape tested — real relation tuples (not just span matches) for shape E, correct
compound-fact splitting and hyphenated rule-number extraction for shapes H/I, and correct
semantic vocabulary mapping for shape K where wink-nlp failed outright. Failure modes are also
consistently more graceful: missing fields or empty results instead of thrown exceptions that
void unrelated extractions in the same batch. The two genuine remaining limitations are (1)
hyphenated spatial/numeric compounds like "3-by-3" still aren't fully resolved (though this
doesn't crash anything, unlike wink-nlp), and (2) accuracy degrades when multiple distinct clues
are batched into one extraction call rather than processed individually — an operational
constraint on how this tier would need to be used, not a hard capability ceiling. As with every
tier tested so far: applying a recognized meta-rule to generate derived constraints, and parsing
an embedded markdown table, remain necessarily external logic regardless of which tier handles
clue-level extraction.

**Suggested RFC-003 update** (manual): revise §9.3's Coverage and Extensibility notes from
"unmeasured, least certain" to reflect this — meaningfully better shape coverage than the
JS-native NLP tier, particularly on relation extraction and vocabulary mapping — and add a
Runtime requirements note about the one-time Python/torch environment-pinning cost on platforms
without current-`torch` wheel support (e.g. Intel Mac), separate from the "no network call"
per-inference cost already noted there. Also worth noting the per-clue-not-per-puzzle calling
pattern as an implementation constraint for whichever tier(s) an ADR eventually chooses.

**For the §9.4 LLM spike**: worth testing the identical five-puzzle sample and multi-sentence
batching question for direct comparison — does an LLM also degrade when clues are batched
together, or does it handle full-puzzle context better than GLiNER2's narrower extraction model?
