---
id: SPIKE-005
title: Tool-Calling and Structured-Output Conventions Across Providers
status: done
rfcs: [RFC-003]
created: 2026-08-19
---

# SPIKE-005: Tool-Calling and Structured-Output Conventions Across Providers

## 1. Question

**Which structured-output mechanism is reliably honored across a wide range of providers and
model sizes, and what JSON Schema subset is broadly safe to send?**

Unlike SPIKE-001–004, this question is not one RFC-003 listed in advance — it surfaced while
*implementing* [ADR-004](../../adr/ADR-004-llm-extraction-critic-loop.md) (`specs/004-nl-csp-extraction`),
and it bears on RFC-003 §9.4's "Runtime requirements" and "Coverage" assessment of the LLM tier,
which implicitly assumed schema-constrained structured output is uniformly available across
providers. It bears directly on two ADR-004 decisions:

- **§2.1** committed to a single-shot request "constrained to a JSON Schema response format
  (OpenRouter/OpenAI-style structured output, `strict: true`)" — explicitly *not* tool-calling.
- **§2.5** committed to cheap-first routing (`google/gemini-2.5-flash-lite`) escalating to a
  frontier tier (`anthropic/claude-sonnet-4.5`). That tiering requires **two different vendors to
  honor the same mechanism identically** — which is precisely what's now in doubt.

**Baseline observations to confirm or refute** (each recorded during implementation; the second
is a single observation with a minimal prompt and is the weaker of the two):

1. **Gemini rejects `$ref` outright, not just ref cycles.** `google/gemini-2.5-flash-lite` via
   OpenRouter, `response_format: json_schema` + `strict: true`, returned HTTP 400 for the
   `ExtractedCsp` schema: *"ref loops are only supported if they include optional or nullable
   property values … a ref loop of required fields was found at
   `$defs.Union_.anyOf.5.properties.expression.anyOf.2.properties.left`"*. Making that field
   nullable produced the same class of error one level deeper. A **non-recursive** schema that
   merely reused a shared definition via `$ref` also failed — *"reference to undefined schema at
   `anyOf.0`"* — implying `$ref`/`$defs` is unsupported generally, not just when it forms a cycle.
2. **Anthropic accepted the request but did not enforce the schema.**
   `anthropic/claude-sonnet-4.5` via OpenRouter, identical mechanism and schema, returned HTTP
   200 — but `choices[0].message.content` was conversational prose wrapping a markdown code block
   whose JSON didn't match the schema at all (bare strings where `{id, type}` objects were
   required; `domains` as an object rather than an array). If real, this means `strict: true` was
   silently ignored rather than refused.

If both hold, neither of ADR-004 §2.5's two tiers currently works via §2.1's chosen mechanism,
and the *mechanism* — not the target format or the schema's content — is the thing to change.

Sub-questions this spike must answer, since they drive different fixes:

- **1a.** Does tool/function calling get honored where `response_format` didn't (especially
  Anthropic, whose native structured-output mechanism *is* tool use)?
- **1b.** Does switching to tool calling also fix the `$ref` problem, or is the safe-schema-subset
  question independent of the mechanism question? (Expected: independent — a function's
  `parameters` is still JSON Schema, and Gemini's function-declaration schema is also a
  restricted subset. Worth confirming rather than assuming.)
- **1c.** Does **model size** matter — do small/cheap models degrade on tool calling relative to
  frontier ones? This is what decides whether ADR-004 §2.5's cheap-first tiering survives at all.

## 2. Method

Two phases, cheap-and-broad before expensive-and-narrow.

**Phase 1 — declared support (free, no API calls billed).** Query OpenRouter's models catalog
(`GET /api/v1/models`), which exposes a `supported_parameters` list per model. Tabulate which
models declare `tools`, `tool_choice`, `response_format`, and `structured_outputs`, grouped by
provider family and by price tier as a proxy for model size. This produces the candidate matrix
for Phase 2 and — on its own — shows how *broadly* each convention is claimed to be supported.
Declared support is not evidence of working support (baseline observation 2 above is exactly a
declared-vs-actual mismatch), so Phase 1 only narrows what Phase 2 verifies.

**Phase 2 — empirical verification (real calls, deliberately small).** A matrix of
*schema shape* × *mechanism* × *model*, holding the prompt constant and trivial so the only
variables are the ones under test.

*Schema ladder* (each minimal and self-contained, increasing in structural demand):

| id | Shape |
|---|---|
| S1 | Flat object, primitive fields only |
| S2 | Nested object + array of objects |
| S3 | Discriminated union, fully inlined (no `$ref`) |
| S4 | Shared definition referenced via `$ref`, non-recursive |
| S5 | Recursive via `$ref` (the real `ExtractedCsp` shape) |

*Mechanisms:*

- **M1** — `response_format: { type: "json_schema", json_schema: { …, strict: true } }` (what
  ADR-004 §2.1 currently specifies).
- **M2** — `tools: [{ type: "function", function: { name, parameters } }]` with `tool_choice`
  forcing that function.
- **M3** — M2 plus OpenRouter's `provider: { require_parameters: true }` routing flag, which is
  documented to route only to providers supporting the requested parameters. Tested separately
  because it may convert a silent non-enforcement into an explicit failure (strictly better) or
  into a successful route to a capable provider.

*Models:* a stratified sample of roughly 8, spanning provider families **and** sizes within a
family — at minimum one frontier and one small/cheap model from each of OpenAI, Anthropic, and
Google, plus two or more open-weight models (e.g. Llama, Mistral, Qwen, DeepSeek) to cover the
low end. Exact model ids are chosen from Phase 1's catalog rather than fixed here, so the spike
doesn't start from a stale list.

*Outcome codes* recorded per cell — the distinction between the middle two is the whole point,
since only one of them is detectable at request time:

| code | Meaning |
|---|---|
| `OK` | Request accepted **and** response decoded cleanly against the schema |
| `REJECT` | Request refused (HTTP 4xx) — record the provider's verbatim message |
| `UNENFORCED` | HTTP 200, but the output did not conform (baseline observation 2's failure) |
| `WRAPPED` | Conformant JSON, but wrapped in prose/markdown fences — recoverable by extraction, worth distinguishing from `UNENFORCED` |

Scripts and raw results live in this spike's own `scripts/` directory, committed alongside this
file. Cost is expected to be a few cents total (~100 short calls); if it materially exceeds that,
stop and record why rather than continuing.

## 3. Time-box

**4 hours.** Phase 1 is under an hour; Phase 2 is bounded by the matrix size, which is fixed up
front. If the matrix can't be completed in the time-box, report partial results by *mechanism*
(M1 vs. M2 across all models) rather than by model, since 1a is the highest-value sub-question.

## 4. Findings

Two schema shapes were added mid-spike (S6-S8) once S1-S5 localized the failure; the ladder grew
from 5 shapes to 8. Scripts and raw per-cell results are in `scripts/` and `results/`.

### 4.1 Phase 1 — declared support is broad, and unreliable

Of **415** catalog models: `tools` 348 (83.9%), `tool_choice` 344 (82.9%), `response_format` 359
(86.5%), `structured_outputs` 336 (81.0%). Declared support is roughly comparable between the two
mechanisms, and does **not** degrade at the low end — `tools` is declared by 84-85% of models in
every price tier from free to frontier.

The decisive Phase 1 result is negative: **both of ADR-004 §2.5's default tiers declare all four
parameters**, including `structured_outputs`. Both fail in practice (4.2). OpenRouter's
`supported_parameters` metadata therefore cannot be used to route safely, which rules out the
cheapest imaginable fix ("just check the catalog before calling").

### 4.2 Phase 2 — the empirical matrix

13 models x 8 schema shapes x 2 mechanisms, 208 cells, one sample per cell. `OK` = request
accepted **and** output conformed; `REJ` = HTTP 4xx; `UNEN` = HTTP 200 but non-conforming output.

Per-schema `OK` rate (out of 13 models):

| Schema | Shape | M1 `response_format` | M2 tool calling |
|---|---|---|---|
| S1 | flat primitives | 10/13 | **13/13** |
| S2 | nested + array of objects | 11/13 | 12/13 |
| S3 | discriminated union, inlined | 11/13 | **13/13** |
| S4 | shared `$ref`, non-recursive | 10/13 | 9/13 |
| S5 | recursive `$ref` (today's `ExtractedCsp`) | **5/13** | 10/13 |
| S6 | recursive, inlined depth 3 | 9/13 | 10/13 |
| S7 | recursive `$ref`, array edge | 8/13 | 10/13 |
| S8 | inlined depth 3 **+** array edge | 10/13 | **12/13** |

Aggregate: **M1 74/104 `OK` with 3 hard rejections; M2 89/104 `OK` with zero rejections.**

**Both baseline observations confirmed.**

1. *Gemini rejects recursive `$ref`* — reproduced on all three Gemini models under M1 (S5), same
   `ref loops are only supported…` 400 each time. Not a one-off.
2. *Anthropic accepts but does not enforce* — confirmed on **both** Sonnet and Haiku, under M1,
   returning conversational prose with an invented object (`id`/`name`/`email`/`created_at`) that
   ignores the requested schema entirely. Under M2 both Anthropic models are **8/8**. So this is a
   mechanism failure, not a model-capability one — the strongest single result in the spike.

**One of my own earlier conclusions was refuted.** During implementation I concluded `$ref`/`$defs`
was "unsupported generally" by Gemini. S4 disproves that: non-recursive `$ref` passes on all three
Gemini models under M1. The real constraints are narrower and **mechanism-dependent**:

- **M1 + Google**: recursive `$ref` → hard `REJECT`; non-recursive `$ref` → fine.
- **M2 + Google**: *any* `$ref` (S4, S5, S7) → silently rendered as a **bare string**
  (`{"a":"foo","b":"bar"}` where two `Point` objects were required; `{"root":""}` for S7).
- **Either mechanism + Google**: `anyOf: [<object>, null]` → also rendered as a string
  (S6: `{"root":{"name":"root","child":"child"}}`). S3 proves `anyOf` *of objects* is fine, so it
  is nullability of a nested object specifically, not unions.

**S8 is the shape that works**: no `$ref` anywhere, bounded inline depth, recursive edge as a
possibly-empty array, no nullable nested objects. Under M2 it is 12/13 — including **all three
Google models**, which failed every other recursive shape. Google's own S5 error message had named
this escape hatch ("*or a potentially-zero-length array items*").

**Model size is not the dominant factor — provider identity is.** `openai/gpt-4o-mini` ($0.15/M)
scores 8/8 on *both* mechanisms, beating `google/gemini-2.5-pro` ($1.25/M, 5/8 on M1). `qwen3-32b`
($0.08/M) is 8/8 under M2. Failures cluster by provider (Google, z-ai, Amazon), not by price.

Two useful outliers: `z-ai/glm-4.6` declares `structured_outputs` yet returned **empty content on
all 8 M1 probes** while scoring 8/8 under M2 — the starkest declared-vs-actual gap found.
`amazon/nova-lite-v1` is the honest control: it declares `tools` but *not* `structured_outputs`,
and indeed failed all 8 M1 probes — the only model whose declaration matched its behavior.

### 4.3 Caveats

- **One sample per cell.** SPIKE-004 already established run-to-run non-determinism, so individual
  `UNEN` cells are suggestive, not conclusive. The headline results (Anthropic M1 vs. M2, Google
  `$ref`) each reproduced across multiple models and shapes, so those are solid; borderline
  single-model cells are not.
- **The prompt was deliberately generic** ("Produce a small example object conforming to the
  required structure"), which arguably handicaps M1. That's the point: under a working mechanism
  the schema itself conveys the requirement, and the identical prompt produced conforming output
  under M2 — so the M1-vs-M2 comparison is controlled even though the absolute M1 numbers may be
  pessimistic.
- **Shape handling only**, not extraction accuracy on real puzzle prose. A model that emits a
  well-formed `ExtractedCsp` may still emit a *wrong* one; that is what ADR-004's critic loop is
  for, and is unaffected by this spike.
- **M3 (`provider.require_parameters`) was never run** — M2's zero rejections made it moot for the
  immediate decision. Still worth testing if multi-provider routing is retained.
- **Tested through OpenRouter only.** Direct-to-provider APIs may differ; some failures here may be
  OpenRouter's translation layer rather than the provider's own API.

## 5. Conclusion

**The mechanism, not the target format, was the problem.** Neither "JSON is the wrong target" nor
"the schema's content is wrong" is supported — the same `ExtractedCsp`-shaped payload succeeds
once it is requested via tool calling and expressed without `$ref` or nullable objects. This
weakens the case for the more drastic pivots that were on the table (emitting MiniZinc or gram
text directly): those remain interesting on their own merits, but should not be adopted as a fix
for this, since this is fixed.

Concretely, for [ADR-004](../../adr/ADR-004-llm-extraction-critic-loop.md):

1. **§2.1 should be revised to tool calling.** This is a genuine ADR revision, not just an
   implementation swap: §2.1 currently names `response_format` explicitly and — after the
   correction made last session — explicitly rules tool calling *out*. The evidence now says the
   opposite. M2 never once produced a hard rejection, and rescued Anthropic completely (0/2 → 2/2
   on the recursive shapes) and z-ai entirely (0/8 → 8/8).
2. **The emitted schema must avoid `$ref` and nullable nested objects.** This constrains
   `src/extraction/types.ts`: `Schema.toJsonSchemaDocument` emits `$defs`/`$ref` by default for
   both unions and `Schema.suspend` recursion, so its output needs a dereferencing/inlining pass
   before it is sent, and the recursive edges need re-modelling as possibly-empty arrays rather
   than `Schema.NullOr`. Note `ArithmeticExpression.left`'s nullability — added *specifically* to
   appease Gemini — is now shown to be both insufficient and unnecessary; an array-of-operands
   encoding would be more faithful to the domain *and* compatible.
3. **§2.5's cheap-first tiering survives, but its model choices deserve review.**
   `gemini-2.5-flash-lite` is salvageable (S8 + M2 passes), so the tiering need not be abandoned.
   But the deeper point is that cross-vendor escalation is what *creates* the compatibility
   surface: `openai/gpt-4o-mini` at $0.15/M scored 8/8 on both mechanisms, so a same-vendor
   cheap→frontier pair would eliminate the surface rather than manage it. Worth weighing against
   the value of vendor diversity in the critic loop (§2.4 relies on tier escalation for a
   *less-correlated* second opinion — which same-vendor tiering would weaken).

Suggested text for RFC-003 §9.4's "Runtime requirements" (manual step — this skill does not edit
the RFC): *the LLM tier's runtime requirement is not merely "an API key and network access" but a
specific structured-output mechanism; tool calling is honored far more consistently across
providers and model sizes than `response_format`, and provider-declared capability metadata is not
a reliable proxy for either.*
