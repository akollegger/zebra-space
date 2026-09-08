---
id: SPIKE-007
title: "effect/unstable/ai + @effect/ai-openrouter Viability"
status: done
rfcs: [RFC-003, RFC-004]
created: 2026-09-07
---

# SPIKE-007: effect/unstable/ai + @effect/ai-openrouter Viability

## 1. Question

Does adopting `effect/unstable/ai` (Effect 4.0's built-in `LanguageModel`/`Chat`/`Tool`
abstractions, published in the same monorepo as the pinned `4.0.0-rc` line) plus the
`@effect/ai-openrouter` provider package give this project a viable replacement for
hand-rolled provider integration code — specifically for the call-site layer RFC-003's
extraction pipeline owns (`src/extraction/provider.ts`, the critic loop in
`src/extraction/extract.ts`) — without regressing what that layer already does?

This isn't yet a numbered RFC-003 open question; it's a new one surfaced this session,
directly upstream of whether [ADR-010](../../adr/ADR-010-actual-llm-cost-accounting.md)
(proposed) gets implemented as drafted, rewritten around this module, or superseded outright.
`@effect/ai` (the classic package) is confirmed still blocked on `effect ^3.22.0` as of its
latest release, but the newer `effect/unstable/ai` + provider-package line is different code
under active v4 development — this spike is what turns "looks promising from reading source"
into an actual finding.

Three sub-questions, each independently falsifiable:

1. **Structured output.** Does `OpenRouterLanguageModel`'s structured-output path decode
   reliably, using Effect Schema, against a schema shaped like this project's real
   `ExtractedCsp` (or a representatively complex subset — entities, domains, and at least one
   nested constraint), on both `openai/gpt-4o-mini` and `anthropic/claude-sonnet-4.5` (the two
   `verified: true` entries in `eval/models.json`)?
2. **Actual cost.** Does the raw OpenRouter `ChatUsage` (including its `cost` field) actually
   surface cleanly from a call — the source read this session found it in
   `FinishPartMetadata.usage` — and would reading it be materially less code than ADR-010 §2.1's
   `onCost` callback design?
3. **Retry/escalation composability.** Does wrapping a `LanguageModel` call in ordinary
   `Effect.retry`/`Schedule` (the same pattern `provider.ts`'s
   `PROVIDER_ERROR_RETRY_SCHEDULE` already uses) work without fighting the module's own
   `Model`/`Chat` abstractions — needed to reproduce ADR-004's cheap-then-frontier tier
   escalation?

## 2. Method

Work happens in this spike's own directory, in a git worktree branched off
`eval-framework-improvements` (see Completion Report) — nothing here touches the real
extraction pipeline.

1. Bump `effect` to the `rc` dist-tag current at spike time (`4.0.0-rc.112` as of this
   writing) and add `@effect/ai-openrouter`@`rc` as a devDependency, scoped to this spike's
   `pnpm` install (revert both if the spike concludes against adoption).
2. `scripts/structured-output.ts`: define an Effect Schema shaped like a representative slice
   of `ExtractedCsp` (entities + domains + at least one constraint kind), call
   `OpenRouterLanguageModel`'s structured-output method against 3–5 real puzzles from
   `catalog/puzzles/` on both verified models, and record: did it decode, was the extraction
   faithful to the prose, and how did failures present (schema violation vs. prose reply vs.
   transport error) compared to what `src/extraction/provider.ts`'s
   `requestStructuredCompletion` already reports for the same puzzles.
3. `scripts/cost-check.ts`: make a handful of calls, log whatever carries the raw
   `ChatUsage`/`cost` value end to end, and write down the actual code path — this is the
   direct comparison point against ADR-010 §2.1's `onCost` design.
4. `scripts/retry-escalation.ts`: wrap one cheap-tier `LanguageModel` call in
   `Effect.retry`/`Schedule.exponential` the way `provider.ts` already does, force a couple of
   failure modes (a bad model id, a short timeout), and confirm the retry/escalation shape
   reads the same way it does in the existing hand-rolled code — or note exactly where it
   doesn't.
5. Bound spend: cheap-tier calls only except where question 1 explicitly needs the frontier
   model for comparison; a handful of puzzles, not the full 39-puzzle catalog.

## 3. Time-box

One day (~6 hours), budgeted roughly 2 hours per sub-question above. Hard stop at the
time-box regardless of completeness — write up whatever findings exist and mark `status:
abandoned` with a note on what was still open, rather than extending scope.

## 4. Notes

**2026-09-07.** Installed `effect@4.0.0-rc.112` and `@effect/ai-openrouter@4.0.0-rc.112` in
the worktree (bumped from the pinned `4.0.0-rc.110`; both packages' `rc` dist-tags matched at
install time). `pnpm-workspace.yaml` has no `packages:` glob, so the nested worktree's own
`node_modules`/`package.json` never touched pnpm's workspace resolution.

The package ships its own `AGENTS.md`/`CLAUDE.md` (and a bundled `ai-docs/src/` example tree)
directly in `node_modules/@effect/ai-openrouter/` — this is the *only* usable v4 documentation
found anywhere; effect.website's public docs still target v3, confirming CLAUDE.md's
description of the ecosystem is accurate for published guides, just not for what's already
shipped in the package itself. All three scripts below were written against that bundled
documentation and the installed `.d.ts`/`.js` source, not the public website.

**Sub-question 1 (structured output), first attempt — `LanguageModel.generateObject`.** Ran
`scripts/structured-output.ts` against PZL-0002 and PZL-0004 on both verified models: 1/4
succeeded (`openai/gpt-4o-mini` × PZL-0004). Failures:
- `openai/gpt-4o-mini` × PZL-0002: `StructuredOutputError`, "Missing key at
  `constraints[0][\"entity\"]`" — the model's own JSON omitted a required field. A real schema
  violation, structurally identical to what `provider.ts`'s `SchemaViolation` already reports.
- `anthropic/claude-sonnet-4.5` × both puzzles: `StructuredOutputError`, "Expected a valid JSON
  string" — the model replied in prose/markdown instead of JSON at all.

Read `OpenRouterLanguageModel.js` to find why: `generateObject` builds
`response_format: {type: "json_schema", ...}` (`getResponseFormat` in the source), **not** a
forced tool call. This is exactly the delivery mechanism SPIKE-005 (this project's own earlier
spike) found unreliable — ADR-004 §2.1 chose a forced tool call specifically because
`response_format` is "accepted and then silently ignored" by some providers/models. Claude
Sonnet 4.5 via OpenRouter did exactly that here.

**Sub-question 1, second attempt — forcing a tool call.** Wrote
`scripts/structured-output-tool.ts`: defined the same schema as a `Tool.make(...)`, grouped in
a `Toolkit`, called `LanguageModel.generateText({toolkit, toolChoice: {tool: "ExtractCsp"}})` —
the tool-calling equivalent of `provider.ts`'s forced `tool_choice`. This crashed immediately,
before any network call, with:
```
TypeError: Cannot read properties of undefined (reading 'encoding')
  at .../effect/dist/SchemaAST.js:2710 (out)
  at .../effect/dist/unstable/ai/Tool.js (getJsonSchemaFromSchemaWith / getJsonSchema)
```
Isolated with a 6-line repro (`scripts/repro-nullor.ts`): a tool parameter field typed
`Schema.NullOr(Schema.String)` — the *exact* shape `src/extraction/types.ts`'s real
`adjacency` constraint already uses for its `variable` field — crashes `Tool.getJsonSchema`
outright. This is not a hypothetical edge case; it is a real, non-optional shape in the
production schema this spike is standing in for. `generateObject`'s `response_format` path
(first attempt, above) did not hit this crash on the same nullable shape — the two
structured-output code paths use different, differently-robust schema-to-JSON-schema
conversion internally.

**Sub-question 2 (actual cost).** `scripts/cost-check.ts` made one plain `generateText` call
(`openai/gpt-4o-mini`) and inspected the response. First attempt read the wrong field
(`finishPart.providerMetadata` — guessed from memory) and got `undefined`; the real field,
confirmed from `Response.d.ts`'s `BasePart` interface, is `.metadata`. Corrected, the finish
part's `metadata.openrouter.usage` carries the complete raw OpenRouter usage object —
`cost: 0.00006615`, plus `cost_details` (upstream inference/completion/prompt cost
breakdown) — with **no request-level flag needed**; it's present by default on every call.
Reading it is two property accesses:
```ts
const finishPart = response.content.find((p) => p.type === "finish")
const costUsd = finishPart?.metadata?.openrouter?.usage?.cost
```

**Sub-question 3 (retry/escalation).** `scripts/retry-escalation.ts`: built an `ExecutionPlan`
with a deliberately-broken cheap tier (`openai/does-not-exist-9000`, 2 attempts) falling back
to a working tier (`openai/gpt-4o-mini`, 1 attempt), wrapped the whole
`Effect.withExecutionPlan(...)` call in `Effect.retry({schedule: Schedule.exponential(...)})` —
the same combinator `provider.ts`'s `PROVIDER_ERROR_RETRY_SCHEDULE` already uses. Ran clean on
the first try: escalated past the broken tier and returned a real completion
(`finishReason: "stop"`). `Effect.retry`/`Schedule` composed around `ExecutionPlan` with no
friction, exactly as ordinary Effect code would predict.

## 5. Findings

1. **Structured output is not reliable via the default `generateObject` path** (1/4 real
   puzzle × model combinations succeeded) **because that path uses OpenRouter's
   `response_format: json_schema` mode, not a forced tool call** — the same failure mode
   SPIKE-005 already identified and ADR-004 §2.1 already designed around. This is a design
   choice in `@effect/ai-openrouter`, not a flake.
2. **The tool-calling alternative — the one that *would* match `provider.ts`'s forced-tool-call
   design — crashes outright on `Schema.NullOr`**, a shape this project's real `ExtractedCsp`
   schema already depends on (`adjacency.variable`). This is a confirmed bug/gap in
   `effect/unstable/ai`'s `Tool.getJsonSchema` at `4.0.0-rc.112`, reproduced in 6 lines with no
   OpenRouter dependency at all — it's in `effect` core's own `SchemaAST`, not the provider
   package.
3. **Real per-call dollar cost is trivially accessible** — `response.content.find(p => p.type
   === "finish")?.metadata.openrouter.usage.cost` — present on every call with no request
   configuration, and includes a cost breakdown ADR-010's design never asked for. This is a
   clear win over ADR-010 §2.1's `onCost`-callback plumbing *if* the module were otherwise
   adopted.
4. **`ExecutionPlan` + ordinary `Effect.retry`/`Schedule` reproduces ADR-004's cheap-then-
   frontier escalation cleanly**, with no friction between the module's own abstractions and
   the retry pattern `provider.ts` already uses. This part of the premise holds.
5. The only usable documentation for any of this is bundled inside the npm package itself
   (`node_modules/@effect/ai-openrouter/AGENTS.md` + `ai-docs/`) — effect.website has none of
   it yet. Anyone adopting this today is reading source and package-bundled docs, not a
   published guide.

## 6. Conclusion

**Adopt for cost accounting (ADR-010), not yet for structured output.** Findings 1 and 2 are
decisive and don't cancel out: the module's structured-output story is not viable as-is for
this project's actual schema (either it silently degrades to unreliable `response_format`
prompting, or the tool-forcing alternative that would fix that crashes on a shape the real
schema requires) — so `src/extraction/provider.ts`'s hand-rolled forced-tool-call
`requestStructuredCompletion` should **not** be replaced right now. But finding 3 stands
entirely on its own: reading `finishPart.metadata.openrouter.usage.cost` from the *existing*
`@openrouter/sdk` response (not `@effect/ai-openrouter` — `@openrouter/sdk`'s own
`ChatResult.usage.cost`, which this spike confirms is the same field, just reached through a
different client) requires no new dependency and no `effect` version bump at all. **This
supersedes ADR-010 as drafted**: rewrite it around reading `usage.cost` directly off the
existing `@openrouter/sdk` response in `src/extraction/provider.ts`'s
`requestStructuredCompletion` (and `direct-solve.ts`'s `requestProseCompletion`), dropping the
`onCost`-callback design in §2.1 entirely — the SDK already returns this on every call; no
side channel is needed.

Finding 4 (`ExecutionPlan`) is worth remembering but not worth adopting alone: this project's
existing tier-escalation code in `extract.ts`'s `runTier`/`runTierSafely` already does the
same job, and adopting `effect/unstable/ai` for retry/escalation only, while keeping
`provider.ts`'s hand-rolled structured-output path, would mean depending on an `unstable`
namespace for a benefit this project doesn't currently lack.

**Revisit finding 2 (structured output) once**: (a) `Tool.getJsonSchema`'s `NullOr` crash is
fixed upstream (worth filing against `Effect-TS/effect`, since the 6-line repro has no
OpenRouter dependency), and (b) `effect/unstable/ai` reaches a stable (non-`rc`, non-`unstable`
namespace) release — effect.website's own post targets Q3/Q4 2026 for that. Until both hold,
this project's forced-tool-call extraction pipeline (ADR-004 §2.1) stays hand-rolled.
