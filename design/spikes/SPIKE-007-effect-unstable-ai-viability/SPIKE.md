---
id: SPIKE-007
title: "effect/unstable/ai + @effect/ai-openrouter Viability"
status: planned
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

_(dated log, kept during the work — filled in as the spike runs)_

## 5. Findings

_(filled in once the spike concludes)_

## 6. Conclusion

_(filled in once the spike concludes — including explicit language for whichever of these
turns out true, ready to paste into ADR-010 or a new superseding ADR: (a) adopt
`effect/unstable/ai` and rewrite ADR-010 around `FinishPartMetadata.usage.cost`; (b) adopt it
for structured output/tool calling but keep ADR-010's cost design since the metadata path
didn't pan out; (c) it doesn't hold up yet — implement ADR-010 as drafted and revisit once
effect 4.0 and the AI packages are closer to stable.)_
