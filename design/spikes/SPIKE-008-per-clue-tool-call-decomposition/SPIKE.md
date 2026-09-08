---
id: SPIKE-008
title: Per-Clue Tool-Call Decomposition vs. the Whole-Document Critic Loop
status: planned
rfcs: [RFC-003]
created: 2026-09-07
---

# SPIKE-008: Per-Clue Tool-Call Decomposition vs. the Whole-Document Critic Loop

## 1. Question

Does decomposing extraction into a sequence of small, forced tool calls — one (or a few) per
clue, each emitting only the entities/domains/constraints that clue implies against the
vocabulary established so far — reduce total LLM calls, cost, and structural failures relative
to today's whole-document critic loop, on the puzzles that actually drive that loop's cost,
without regressing extraction correctness?

This isn't yet a numbered RFC-003 open question; it's surfaced from this session's review of
[ADR-004](../../adr/ADR-004-llm-extraction-critic-loop.md)'s critic loop and
[ADR-009](../../adr/ADR-009-staged-extraction.md)'s staged extraction, prompted by an analogy
to coding agents' shift from regenerating whole files to issuing line-level edit tool calls.
The project's own evidence already names the symptom this targets —
[ADR-009's Context](../../adr/ADR-009-staged-extraction.md) calls it "critic-loop waste (each
revision re-emits the already-correct vocabulary alongside the broken constraints)" — and
[ADR-009 §2.2](../../adr/ADR-009-staged-extraction.md) already considered finer-than-staged
decomposition once and deferred it: "Per-clue scoping is NOT per-clue calls: one stage-2 call
emits all constraints clue-by-clue (14 clues × local latency would make per-clue calls slower
than the monolith). Per-clue calls remain an option if single-call stage 2 still times out —
the seam supports it without redesign." This spike is what turns that deferred option into an
actual measurement, this time as a call-cost/quality question for API-hosted models generally
— not only the local-latency case ADR-009 was scoped to.

`effect/unstable/ai`'s tool-calling path is not in play here — [SPIKE-007](../SPIKE-007-effect-unstable-ai-viability/SPIKE.md)
found it crashes on `Schema.NullOr`, a shape this project's real `ExtractedCsp` schema
requires. This spike extends the existing hand-rolled forced-tool-call plumbing in
`src/extraction/provider.ts` into a loop instead.

Three sub-questions:

1. **Structural failures drop.** Does rejecting an invented entity/domain id or an invented
   constraint kind synchronously, inside the tool call handler, actually prevent the class of
   failure `ADR-009`'s Context measured (`"rightOf"` outside the closed 8-kind set →
   `COMPILE_FAILED` on PZL-0028) — before it ever reaches a critic call?
2. **Net cost, not just worst-case cost.** For puzzles that succeed cleanly today in one
   critic-loop pass, does per-clue decomposition cost *more* total calls (a naive floor of one
   call per clue) than it saves on the puzzles that currently need revision rounds or tier
   escalation? Measure both populations, not just the hard cases.
3. **Does the fidelity critic shrink or just move?** With structural errors caught per-call,
   does a final holistic critique pass over the assembled `ExtractedCsp` (still needed for
   genuine semantic misreadings — SPIKE-004's `"outcome": "680"` non-determinism finding is a
   meaning error, not a structural one, and a smaller call is just as capable of making it) get
   measurably cheaper/shorter than today's whole-document critique, or does it end up doing the
   same amount of work at the end anyway?

## 2. Method

Work happens in a nested git worktree at `design/spikes/SPIKE-008-per-clue-tool-call-decomposition/worktree/`
(gitignored per `design/spikes/*/worktree/`, same pattern as SPIKE-007), on a branch off
`eval-framework-improvements`. Nothing here touches the real extraction pipeline until/unless
the findings justify an ADR.

1. **Pick the puzzle sample deliberately, not randomly.** `eval/results.md`'s committed
   summaries don't carry per-attempt revision counts for successful runs (only
   `CriticRejected` failures record `criticAttempts`), so first re-run the existing
   `full-critic` harness once over the stratified 8-puzzle subset plus known-difficult puzzles
   named in design docs (PZL-0028's invented-vocabulary case; PZL-0011's threshold cascade
   flagged in RFC-003 §7.6) with per-attempt logging turned up, to get a real baseline: total
   calls, revision rounds, and escalations per puzzle today. Split the sample into "clean"
   (accepted first try) and "churned" (needed revision/escalation) puzzles from that baseline
   — question 2 needs both groups.
2. **Build a per-clue prototype** in this spike's own scoped `package.json` (no root dependency
   changes — mirrors `SPIKE-002`'s and `SPIKE-007`'s isolation pattern): reuse
   `src/extraction/provider.ts`'s `requestStructuredCompletion` forced-tool-call plumbing
   directly (no new library), define one tool per constraint-family (or a single
   `AddConstraint` tool covering the existing kind union), and drive a harness-controlled loop:
   split the prose into clues (reuse whatever sentence/numbering structure the catalog format
   already gives — puzzles are already numbered clue lists), call the model once per clue with
   the accumulated vocabulary so far, validate the tool call's own arguments against declared
   ids/kinds synchronously in the handler (reject and re-prompt that one clue on a structural
   miss, never re-emit the whole document), and assemble the resulting `ExtractedCsp` the same
   way `extractStaged` already assembles stage 1 + stage 2 output deterministically.
3. **Run both harnesses (today's full-critic, and this prototype) over the same sample** and
   record, per puzzle: total LLM calls, total cost (read directly per call —
   `finishPart.metadata.openrouter.usage.cost`, confirmed accessible via `@openrouter/sdk` in
   SPIKE-007 — no need for ADR-010-style estimation here), and whether the resulting
   `ExtractedCsp` compiles and solves to the recorded answer key.
4. **For sub-question 3**, additionally run a final holistic critique pass (reusing
   `critiqueOnce`'s existing prompt) over the prototype's assembled output on a few puzzles,
   and compare that critique call's token count / issues raised against today's whole-document
   critique on the same puzzles.
5. Bound spend: cheap-tier model only (`openai/gpt-4o-mini`) except where a puzzle's baseline
   run already required frontier escalation; the sample stays in the 8–12 puzzle range, not the
   full 39-puzzle catalog.

## 3. Time-box

One day (~6 hours): roughly 2 hours to build the per-clue prototype, 2 hours to run both
harnesses over the sample and gather numbers, 2 hours for the holistic-critique comparison and
write-up. Hard stop at the time-box regardless of completeness — write up whatever findings
exist and mark `status: abandoned` with a note on what was still open, rather than extending
scope.

## 4. Notes

_(dated log, kept during the work — filled in as the spike runs)_

## 5. Findings

_(filled in once the spike concludes)_

## 6. Conclusion

_(filled in once the spike concludes — including explicit language for whichever of these
turns out true, ready to inform a follow-up ADR against ADR-004/ADR-009: (a) per-clue
decomposition wins clearly on the churned population and doesn't lose badly on the clean
population — worth an ADR superseding ADR-009's staging with finer-grained decomposition; (b)
it wins on structural-failure elimination but the net cost/latency case is a wash or worse —
worth adopting only the synchronous structural-validation idea, not full per-clue calls; (c) it
doesn't hold up — today's whole-document critic loop stays as designed.)_
