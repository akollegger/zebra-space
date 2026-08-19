---
id: SPIKE-005
title: Tool-Calling and Structured-Output Conventions Across Providers
status: planned
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

_(filled in once the spike concludes)_

## 5. Conclusion

_(filled in once the spike concludes)_ — should state explicitly:

- Whether ADR-004 §2.1's `response_format` choice should be replaced by tool calling, and whether
  that's a mechanism swap or a genuine ADR revision.
- What JSON Schema subset is safe to emit (specifically: is `$ref` usable at all, or must
  `src/extraction/types.ts` emit fully-inlined schemas?).
- Whether ADR-004 §2.5's cheap-first tiering is still viable, or whether cross-vendor escalation
  is itself the source of the compatibility surface and should be reconsidered.
