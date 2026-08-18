---
id: SPIKE-004
title: LLM-Based Extraction (OpenRouter)
status: done
rfcs: [RFC-003]
created: 2026-08-18
---

# SPIKE-004: LLM-Based Extraction (OpenRouter)

## 1. Question

Per [RFC-003](../../rfc/RFC-003-natural-language-csp-extraction.md) Appendix §9.4: does
schema-constrained LLM-based extraction achieve usable accuracy on this catalog's clue text, and
how does it compare to [SPIKE-003](../SPIKE-003-gliner2-capability/SPIKE.md)'s GLiNER2 findings
on the same [SPIKE-001](../SPIKE-001-catalog-clue-audit/SPIKE.md) stratified sample — including
whether the per-clue-vs-per-puzzle batching sensitivity SPIKE-003 found for GLiNER2 also affects
an LLM, and whether a frontier model and a cheap model differ meaningfully in accuracy for this
task.

Before this spike started, a preliminary compatibility check was run (not itself part of the
timed spike): `@effect/ai` (and all its provider packages) peer-depend on `effect@^3.22.0`, which
conflicts with this repo's `effect@4.0.0-beta.107` pin — the same incompatibility CLAUDE.md
already documents for `@effect/platform`'s `Command` module. `@openrouter/sdk` was selected
instead: an official, thin API client (not an agentic/orchestration framework) with zero peer
dependencies, so it doesn't conflict with the `effect` pin.

## 2. Method

Used `@openrouter/sdk`'s chat-completions API with structured-output (JSON schema) requests
against two models: `anthropic/claude-sonnet-4.5` (frontier) and `google/gemini-2.5-flash-lite`
(cheap, ~30x lower cost per OpenRouter's live pricing). Tested the same stratified sample as
SPIKE-002/SPIKE-003: `PZL-0001` (A/B baseline), `PZL-0005` (E), `PZL-0008` (F), `PZL-0011` (H/I),
`PZL-0013` (K) — both per-clue (isolated sentences) and per-puzzle (full combined text) to
directly test the batching question SPIKE-003 raised.

## 3. Time-box

≤1 day.

## 4. Findings

Script: `scripts/spike.mjs` (run with `node --env-file=.env scripts/spike.mjs` from this
directory, after `pnpm install` and placing `OPENROUTER_API_KEY` in `.env`).

**SDK friction (quick, but real)**: `@openrouter/sdk`'s own README shows `chat.send({ messages,
model, ... })` with fields flat — the installed version's actual TypeScript signature requires
them nested under a `chatRequest` key (`chat.send({ chatRequest: { messages, model, ... } })`).
Every call failed with an opaque Zod validation error (`expected object, received undefined` at
path `chatRequest`) until this was found by reading the `.d.ts` directly. A real doc/code
mismatch worth knowing about before anyone else hits it, though trivial once identified.

**Both shapes that defeated every prior tier were solved outright.** This is the spike's biggest
finding:
- **Shape F's hyphenated grid dimension** ("3-by-3") — wink-nlp crashed on it
  ([SPIKE-002](../SPIKE-002-js-native-nlp-wink/SPIKE.md)), GLiNER2 returned `null`
  ([SPIKE-003](../SPIKE-003-gliner2-capability/SPIKE.md)). **Both** LLM models correctly resolved
  it to `{"grid_rows": 3, "grid_cols": 3}`, plus correct `target_sum` and all three given cells
  mapped to their correct named positions (top-left/top-middle/center) — something neither prior
  tier achieved even partially.
- **Shape K's raw embedded markdown table row** — wink-nlp produced garbage tokens, GLiNER2
  returned an empty result. **Both** LLM models parsed `"| Thai Palace | No | No | Yes | $$ |"`
  into a perfect `{"name": "Thai Palace", "vegan_friendly": "No", "nut_free": "No",
  "gluten_free": "Yes", "price": "$$"}`. This **overturns** the working assumption carried since
  [SPIKE-001](../SPIKE-001-catalog-clue-audit/SPIKE.md) that this shape "needs a dedicated parser
  regardless of tier" — that's true for the rule-based/NLP-library/small-model tiers, but not for
  schema-constrained LLM extraction, which handles semi-structured markdown natively.

**A concrete, first-hand non-determinism catch** (not just the theoretical concern already in
RFC-003 §9.4): running the exact same combined-passage threshold-rule extraction against
`anthropic/claude-sonnet-4.5` twice produced materially different results:
- Run 1: `{"derived_variable": "couple's credit tier", "comparison": "below 600", "outcome":
  "Denied"}` — correct.
- Run 2 (identical input, prompt, schema, model): `{"derived_variable": "couple's credit tier",
  "comparison": "lower of their two individual credit scores", "outcome": "680"}` — **wrong**:
  `"680"` is a credit-score value, not a valid outcome. Schema-constrained structured output
  guarantees the *shape* is valid JSON; it does not guarantee semantic correctness stays stable
  run to run, even from a frontier model.

**Batching (per-clue vs per-puzzle)**: less clear-cut than SPIKE-003 found for GLiNER2. Some
combined-passage extractions were perfect despite batching (`rule_reference`, `person_facts`,
both models); others degraded slightly (`derived_variable` became less precise when combined,
for both models) — but the more dramatic accuracy loss observed (the `"outcome": "680"` case
above) came from **run-to-run variance on the same combined call**, not batching itself in
isolation. A single comparison isn't enough to cleanly separate "batching hurts" from "this
model's variance is just high" — would need multiple trials per condition to say more
confidently.

**Frontier vs. cheap model**: surprisingly close for this task. `google/gemini-2.5-flash-lite`
(~30x cheaper) matched `anthropic/claude-sonnet-4.5` on the grid shape, the table-row shape,
`rule_reference`, and `person_facts`. The cheap model's one clear miss: it split Ben's dietary
requirement into two separate array entries (`"nut allergy"` and `"nut-free kitchen"`) instead of
one concise entry, a schema-following literalism the frontier model didn't exhibit. Neither model
normalized "has a nut allergy and needs a nut-free kitchen" down to a clean `"nut-free"` the way
[SPIKE-003](../SPIKE-003-gliner2-capability/SPIKE.md)'s GLiNER2 did by default — both captured
more verbose raw text, likely fixable with a more specific JSON-schema `description` field than
this spike used, not a hard capability limit.

## 5. Conclusion

Schema-constrained LLM extraction is the strongest tier tested so far on raw capability — it's
the only one to solve both shapes (F's hyphenated grid dimensions, K's embedded table) that
defeated every other tier outright, confirming RFC-003 §9.4's "handles genuinely novel phrasing
with the least per-clue-shape engineering effort" claim concretely rather than just in principle.
But the non-determinism finding is equally concrete now, not theoretical: the same frontier
model, same input, same schema, produced a wrong semantic result on a second run while the JSON
shape stayed valid throughout — exactly the failure mode RFC-003 §5.2 already named ("constrained
decoding guarantees schema-valid output but not semantic correctness") but now with a real
example. Any real use of this tier needs the round-trip solver validation RFC-003 §7.3 already
raises as an open question, not just schema validation, precisely because schema validity was
never the failure mode here.

The cheap model holding up nearly as well as the frontier model on this task (at ~30x lower cost)
is a meaningful economic data point, but a single run per condition isn't enough to make that
claim with confidence given the demonstrated run-to-run variance — it would take repeated trials
to know whether the cheap model is genuinely comparable or this spike got lucky/unlucky on a
given call.

**Suggested RFC-003 update** (manual): revise §9.4's Coverage and Extensibility notes to reflect
the grid-dimension and embedded-table wins concretely (and correct the Appendix's standing
assumption that shape K "needs a dedicated parser regardless of tier" — true for tiers 9.1-9.3,
not for 9.4). Revise the Determinism & reproducibility note to cite this spike's concrete
before/after example rather than describing the risk only in the abstract. Note the SDK's
README/type-signature mismatch as a minor integration gotcha if `@openrouter/sdk` is used again.

**For an eventual ADR**: this spike's non-determinism finding is probably the single most
decision-relevant data point across all four spikes — it makes RFC-003 §7.3's round-trip
solver-validation question (extract → solve → compare against expected solution/uniqueness) look
less like an optional nice-to-have and more like a hard requirement if this tier is chosen, given
schema validity alone provably does not catch a wrong-but-valid extraction.
