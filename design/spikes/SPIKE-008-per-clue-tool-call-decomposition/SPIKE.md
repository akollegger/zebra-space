---
id: SPIKE-008
title: Per-Clue Tool-Call Decomposition vs. the Whole-Document Critic Loop
status: in-progress
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

A later session (2026-09-14) reviewed the eval workflow end-to-end and found harder evidence
than was available when this spike was first drafted: `ExtractedCsp`'s actual JSON Schema is
69,118 chars (~20k tokens, 134 `anyOf` unions, nesting depth 39 — over 4× the "~16k characters
at depth 2" `types.ts:17` claims), every `variable`/`entity`/`value` field is an untyped
string, and the September raw eval records show every classifiable model failure was
structural (an invented relation name, a cross-stage entity-binding mismatch, a value-casing
mismatch) with zero misread clues. The fidelity critic accepted 36 extractions of which only
11 matched (31% precision) and never once caught a compile failure or an undeclared-variable
error, despite the harness computing exactly that signal and discarding it. That review
sharpens sub-question 1 into something concrete enough to build (sub-question 4 below) and
raises a genuinely new question about the critic itself (sub-question 5) — both folded into
this spike's scope rather than split off, since a per-clue extraction loop and the critic that
judges its output are entangled: redesigning one without the other can't be measured cleanly.

Five sub-questions (1-3 as originally scoped, 4-5 added by the 2026-09-14 review):

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
4. **Does generating each per-clue tool's schema from stage 1's fixed vocabulary — `variable`/
   `entity`/`value` as closed `enum`s populated from the declared domains/entities, `relation`/
   `comparator` as closed enums drawn from `compile.ts`'s own registries — eliminate the
   invented-value and cross-call binding-mismatch failures that a plain per-clue tool call
   (typed as free strings, per this spike's original framing) would still allow?** This is the
   concrete mechanism behind sub-question 1: the 2026-09-14 evidence (live `"rightOf"`, a live
   `entity: null` on an entity-indexed variable, a live `paper`/`Paper` casing mismatch) is
   exactly the failure class enum-typing forecloses at decode time rather than catching
   downstream at compile time.
5. **Does replacing today's single-line-JSON-vs-prose fidelity critic with a critic that has
   compile/solve feedback (grounded revision) or a back-translation NL-vs-NL check measurably
   outperform it** — on catch rate (compile errors, undeclared variables) and/or on cost — given
   the baseline shows today's critic has ~31% precision and never once caught a structural
   failure the harness's own compile/solve step already surfaces for free?

**Out of scope**, deliberately split off rather than folded in (each is a genuinely independent
question, per this skill's own guidance): **emitting MiniZinc directly from the LLM**, skipping
an intermediate JSON schema entirely — a falsification test of the intermediate representation
itself, not of the delivery mechanism SPIKE-005 already settled, and a different enough
question to deserve its own spike; and **a classification-as-step-zero pipeline stage**
(RFC-004 §5.3 — letting non-determinate prose decline gracefully instead of always producing a
CSP). Both are candidates for a future SPIKE-009/SPIKE-010, not created by this revision.

## 2. Method

Work happens in a nested git worktree at `design/spikes/SPIKE-008-per-clue-tool-call-decomposition/worktree/`
(gitignored per `design/spikes/*/worktree/`, same pattern as SPIKE-007), on a branch off
`main`. Nothing here touches the real extraction pipeline until/unless the findings justify an
ADR.

1. **Baseline, redone from scratch — do not trust the old summaries.** `eval/results.md`'s
   committed summaries are all that survive of the prior full-critic runs this baseline would
   otherwise reuse: the raw JSON files are gitignored (`eval/results/*.json`) and the August
   runs' files are gone from this working tree, so per-attempt critic detail (what exactly a
   given critic call accepted or rejected, and why) cannot be reconstructed after the fact —
   only aggregate outcome counts survive. Re-run the existing `full-critic` harness fresh over
   this spike's full puzzle sample (step 2) with per-attempt logging turned up, and commit the
   raw output for this spike's own sample alongside `SPIKE.md` (e.g. under this directory's own
   `results/`, not the gitignored top-level `eval/results/`) so this spike's findings stay
   independently auditable, unlike the ones it's correcting. This baseline run gives real
   numbers: total calls, revision rounds, and escalations per puzzle, split into "clean"
   (accepted first try) and "churned" (needed revision/escalation) — question 2 needs both
   groups.
2. **Puzzle sample: the existing stratified subset plus the puzzles that actually churn.** Start
   from `scripts/eval-matrix.ts`'s `STRATIFIED_SUBSET` (`PZL-0002`, `PZL-0004`, `PZL-0022`,
   `PZL-0028`, `PZL-0033`, `PZL-0038`, `PZL-0015`, `PZL-0018` — ADR-007 §2.3's five-outcome-class
   spread) and add the puzzles the 2026-09-14 review found were never reliably solved or never
   previously sampled: `PZL-0001` (0/5 in the August runs — at 25 variables/5 domains/14
   constraints, the largest catalog puzzle), `PZL-0003` (never passed in 5 August runs; the
   `ruleTable` kind plus an un-pinned value-casing failure), `PZL-0007`, `PZL-0010`, `PZL-0011`,
   `PZL-0012` (4-5 of 5 August runs each SchemaViolation — arithmetic/derived-rule cascades).
   Total sample: 14 puzzles. Deliberately **excluded**: every ambiguous (`PZL-0028` stays only
   for its invented-relation failure, not its ambiguity), subjective, or non-problem puzzle
   (`PZL-0016` through `PZL-0021`, `PZL-0029` through `PZL-0037`, `PZL-0039`) — classification is
   out of scope (§1), and today's extractor has no decline path, so including them would only
   produce `UNDECLINED` or a faithful CSP-of-a-non-problem, noise unrelated to the decomposition
   question this spike asks.
3. **Build the per-clue prototype — schema-generated per call, not one generic tool.** Reuse
   `src/extraction/provider.ts`'s `requestStructuredCompletion` forced-tool-call plumbing
   directly (no new library, mirrors SPIKE-002's/SPIKE-007's own-`package.json` isolation): run
   stage 1 (`extractStaged`'s existing `ExtractedVocabulary` call) unchanged, then generate one
   tool per constraint kind *from that stage's output* — `variable` and `value` fields become
   `enum`s populated from the declared domains, `entity` an enum from declared entity ids (the
   `linkedAttributes` existential path is unchanged, since it deliberately never names an
   entity), and `relation`/`comparator` closed enums drawn from `compile.ts`'s own adjacency
   registry and arithmetic comparator set — this directly tests sub-question 4, not just
   sub-question 1. Split the prose into clues (reuse the numbered clue-list structure the
   catalog format already gives) and drive a harness-controlled loop: call the model once per
   clue with the accumulated vocabulary and generated tool set, validate the call's arguments
   synchronously in the handler against the declared vocabulary (reject and re-prompt only that
   one clue on a structural miss, never re-emit the whole document), and assemble the resulting
   `ExtractedCsp` the same deterministic way `extractStaged` already assembles stage 1 + stage 2
   output.
4. **Build the two critic variants for sub-question 5**, run only on this spike's sample:
   - *Grounded revision*: after assembly, compile and attempt to solve. On `Unsatisfiable`, run
     a cheap minimal-conflicting-subset search (drop one clue at a time — this sample tops out
     around 14 clues, so a handful of extra solves per puzzle) to name the likely-wrong clue; on
     `MultiplySatisfiable`, name the under-constrained variable(s). Feed that specific,
     structured finding back as the revision prompt in place of today's generic faithfulness
     critique.
   - *Back-translation*: a deterministic renderer (a stripped-down mirror of `compile.ts`'s
     per-kind logic, producing English instead of MiniZinc) turns each assembled constraint back
     into a sentence; a critic call (may be a different, cheaper model than the extractor)
     judges only "does this sentence match clue N," one clue at a time, never the whole document
     against the whole prose.
   Compare both, and today's unmodified whole-document JSON-vs-prose critic, on catch rate
   (does each correctly flag the failure classes actually observed in step 1's baseline and in
   prior runs — invented relation, cross-call binding mismatch, value casing, genuine semantic
   misreadings) and on cost per catch.
5. **Run every harness variant over the same 14-puzzle sample** — today's unmodified
   `full-critic`; per-clue decomposition with no critic change; per-clue decomposition +
   grounded-revision critic; per-clue decomposition + back-translation critic — and record per
   puzzle: total LLM calls, total cost (read directly per call —
   `finishPart.metadata.openrouter.usage.cost`, confirmed accessible via `@openrouter/sdk` in
   SPIKE-007 — no ADR-010-style estimation needed here), and whether the resulting
   `ExtractedCsp` compiles and solves to the recorded answer key.
6. Bound spend: cheap-tier model only (`openai/gpt-4o-mini`) except where a puzzle's baseline
   run already required frontier escalation; the sample stays at the 14 puzzles named in step 2,
   not the full 39-puzzle catalog.

## 3. Time-box

**Two days (~12 hours)**: ~2 hours re-running the full-critic baseline with logging retained
(step 1); ~4 hours building the schema-generated per-clue prototype (step 3); ~3 hours building
and running the two critic variants (step 4); ~3 hours running the full four-way comparison
(step 5) and write-up. Hard stop at the time-box regardless of completeness — write up whatever
findings exist and mark `status: abandoned` with a note on what was still open, rather than
extending scope.

## 4. Notes

**2026-09-15 — decided to skip the nested worktree.** Nothing else is in flight on this repo
concurrently, so the investigation proceeds directly on the `spike/008-per-clue-decomposition`
branch (in `design/spikes/SPIKE-008-per-clue-tool-call-decomposition/scripts/`) rather than
under a gitignored `worktree/` subfolder — the isolation a worktree buys (parallel spikes not
stepping on each other) isn't needed here.

**2026-09-15 — clue-splitting is not universal across the catalog.** Built `lib/puzzles.ts`'s
`splitClues()` on a `^\d+\.\s` numbered-list heuristic (every classic zebra-shaped puzzle in the
sample uses it) and checked it against the full 14-puzzle sample: PZL-0001/0003(via ruleTable
clues)/0004/0010/0011/0012/0028/0038 all split cleanly (3-14 clues each). PZL-0007 (SEND+MORE=
MONEY, an ASCII arithmetic diagram), PZL-0022 (a markdown table of items, no numbered list), and
PZL-0033 (a plain prose paragraph) have no numbered structure at all — `decomposable: false`,
and the harness degenerates to one call for these, same as single-shot. This is itself a data
point for sub-question 2 (net cost): decomposition can't reduce call count below 1, so these
three puzzles test the floor case, not the mechanism, and should be reported separately from the
puzzles that actually decompose.

**2026-09-15 — schema generation proven at zero cost.** Built `lib/clue-schema.ts` (generates
one closed JSON Schema tool per constraint kind from an `ExtractedVocabulary` — `variable`/
`entity`/`value` as enums, `relation`/`comparator` as closed enums drawn from
`src/compiler/compile.ts`'s own registries, `derivedRule.thenConstraints` restricted to the four
kinds `compile.ts`'s own `compileThenConstraint` actually accepts there rather than all nine) and
`lib/tool-call.ts` (a forced-tool-call wrapper reusing `src/extraction/provider.ts`'s exported
`resolveProviderRoute` for route resolution, structurally validating each returned call against
its own generated schema). Smoke-tested against `tests/extraction/support/stub-server.ts` (zero
real API cost): a stub returning an invented value (`"value": "Green"` against a
`["Red","Blue"]` enum) is correctly rejected structurally before ever reaching the compiler —
`$.value: "Green" is not one of the declared values [Red, Blue]`. This is a direct, offline-
reproducible confirmation of sub-question 4's premise: enum-typed per-clue schemas foreclose
the invented-value failure class at decode time, where the monolith only catches it (or doesn't)
downstream at compile time.

**2026-09-15 — one call per clue offers all nine tools, not a hand-picked one.** Designed
`requestClueConstraints` (`lib/tool-call.ts`) to send every generated tool with
`tool_choice: "required"` rather than forcing a single named kind per clue — the model decides
how many constraints a clue implies (usually one, occasionally two for a genuinely compound
clue) rather than this harness guessing the kind from the clue text itself, which would just
relocate the "which kind does this clue need" judgment call out of the model and into
unreliable heuristic code.

**2026-09-15 — full offline pipeline proof.** Built `lib/per-clue-extract.ts` (stage 1
vocabulary reuses the real pipeline's `requestStructuredCompletion` + `ExtractedVocabulary`
directly; stage 2 loops `requestClueConstraints` per clue with one repair retry on a
structurally-rejected call, scoped to that one clue rather than the whole document) and ran it
end to end against a synthetic 2-clue puzzle via the stub server: vocabulary call → 2 per-clue
calls → assembly → `src/compiler/compile.ts`'s real `compile()` → `src/solver/solve.ts`'s real
`solve()`, all succeeding mechanically (3 total calls, valid MiniZinc emitted, solver returned a
real — if intentionally underconstrained — outcome). Zero real API spend; proves the mechanism
before any billed run.

**Not yet done, pending a spend go-ahead from the user**: the grounded-revision critic
(sub-question 5's compile/solve-fed minimal-conflict search — buildable and testable entirely
offline against the local `minizinc` install, no LLM cost, still to build), the back-translation
critic (its deterministic renderer is offline-testable; its NL-vs-NL judgment call is not), and
the actual baseline rerun + four-way comparison across the 14-puzzle sample, which is real,
billed OpenRouter spend and needs an explicit dollar-bounded go-ahead before running (per this
project's own established convention — `scripts/eval-extraction.ts --budget-usd`, and spec
006/T030's "do not run without explicit approval because it is billed").

## 5. Findings

_(filled in once the spike concludes)_

## 6. Conclusion

_(filled in once the spike concludes — including explicit language for whichever of these
turns out true, ready to inform a follow-up ADR against ADR-004/ADR-009: (a) per-clue
decomposition wins clearly on the churned population and doesn't lose badly on the clean
population — worth an ADR superseding ADR-009's staging with finer-grained decomposition; (b)
it wins on structural-failure elimination but the net cost/latency case is a wash or worse —
worth adopting only the synchronous structural-validation idea, not full per-clue calls; (c) it
doesn't hold up — today's whole-document critic loop stays as designed. State separately
whether either critic variant (sub-question 5) is worth adopting **independent of** the
decomposition decision — it's possible per-clue decomposition doesn't pay off but
grounded-revision or back-translation critique still measurably beats today's critic on its
own, in which case that alone is worth an ADR regardless of how (a)/(b)/(c) above land. Note
direct-MiniZinc-emission and classification-as-step-zero here as candidate follow-up spikes,
per §1 — not created by this pass.)_
