---
id: SPIKE-008
title: Per-Clue Tool-Call Decomposition vs. the Whole-Document Critic Loop
status: done
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

Work happens directly on the `spike/008-per-clue-decomposition` branch (off `main`), in this
directory's own `scripts/` — no nested worktree: nothing else was in flight on this repo
concurrently, so the isolation a worktree buys wasn't needed (see §4 Notes). Nothing here
touches the real extraction pipeline until/unless the findings justify an ADR.

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

**2026-09-15 — grounded critic and back-translation critic built and offline-tested.**
`lib/grounded-critic.ts`'s drop-one-clue search correctly named both constraints in a synthetic
direct conflict (zero LLM cost — local `minizinc` only). `lib/back-translation.ts`'s renderer
and `lib/back-translation-critic.ts`'s judging call (a small forced-tool "accepted"/"issue"
schema via `tool-call.ts`'s single-tool path) are wired into `run-comparison.ts`, which runs all
four variants (full-critic; per-clue; per-clue+grounded; per-clue+back-translation) per puzzle
and grades each against `eval/answer-keys.json` via a spike-local `lib/grade.ts` (mirrors
`scripts/eval-extraction.ts`'s private `gradeSolved`/`recoverEntityKeyedArrays`, cited there).

**2026-09-15 — user approved the full billed run with no spend cap.** Before committing to the
full 14-puzzle × 4-variant sweep, ran a single live dry-run on PZL-0004 to catch runtime bugs
against real model responses (the stub-server smoke tests can't substitute for this). Two things
surfaced, both real findings rather than harness bugs:
1. **`ZEBRA_LOCAL_BASE_URL` in `.env` breaks these scripts the same way it broke the CLI tests
   fixed in `chore/fix-cli-tests`** (merged, PR #25) — `resolveProviderRoute` prefers it over
   `ZEBRA_OPENROUTER_BASE_URL_OVERRIDE`/real OpenRouter routing. Every live invocation of this
   spike's scripts must clear it explicitly (`ZEBRA_LOCAL_BASE_URL= node --env-file-if-exists=.env ...`).
2. **A vocabulary-stage modeling error, not a per-clue-mechanism error.** On this run, stage 1
   modeled PZL-0004's suspects/weapons/rooms each as their OWN entities (`suspect_scarlett`,
   `weapon_rope`, ...) rather than the one-entity ("Murder") shape the known-good extraction
   uses — a real, reproducible instance of SPIKE-004's already-documented non-determinism, not a
   bug in this harness (the vocabulary prompt is copied verbatim from `extract.ts`'s own
   `vocabularySystemPrompt`). This cascaded into `per-clue`'s `SOLVE_MULTIPLY_SATISFIABLE`
   (one clue got mis-typed as `assignment` on a synthetic per-value entity instead of the correct
   `arithmetic !=`) and `per-clue+back-translation`'s `COMPILE_FAILED` (`entity: null` on an
   entity-indexed variable — the exact live cross-stage binding-mismatch failure class the
   2026-09-14 eval-workflow review found in the real pipeline). The back-translation critic
   correctly flagged 6/6 clues as suspect in this run — genuine detection — but a critic
   downstream of a bad vocabulary decision can only ask for a redo against that same flawed
   vocabulary, not fix the vocabulary itself. This is a real, useful distinction for the
   Conclusion: sub-question 4's enum-schema mechanism forecloses invented-value/kind errors
   *within* a clue, but a bad *vocabulary*-stage decision (what counts as an entity at all) is a
   separate failure surface neither per-clue decomposition nor either critic variant addresses.
3. Confirmed each of the three per-clue-based variants runs its OWN independent stage-1 +
   per-clue loop (not shared state) — the methodologically correct design (matches how the real
   pipeline's own harness ablations compare independent runs), but it does mean a difference
   between e.g. `per-clue` and `per-clue+grounded` on one puzzle can partly reflect LLM sampling
   variance rather than the critic mechanism alone — a caveat to carry into Findings, the same
   way SPIKE-005 flagged its own "one sample per cell" limitation.

**2026-09-15 — full billed run completed** (14 puzzles × 4 variants, raw records in
`results/comparison-2026-09-14T13-32-51-460Z.json`; committed alongside this file per Method
step 1, unlike the gitignored top-level `eval/results/`). See §5/§6 for the analysis. One
methodological gap found while digging into a `per-clue` `SOLVE_ERROR` case (PZL-0002): this
spike's `compileAndSolve` helper (`run-comparison.ts`) discards the underlying `SolverError`'s
detail on failure (`Effect.catch(() => Effect.succeed({ ok: false }))` — a `{ok:false}` with no
error carried), so several `SOLVE_ERROR` records in the raw JSON have no diagnostic beyond the
preserved `mzn` text itself. Diagnosed PZL-0002 manually from its stored `.mzn` instead: a
genuine cross-domain entity-scoping bug in `lib/clue-schema.ts`'s generator, not a swallowed-
error artifact — `entityEnum` is built from ALL declared entities globally
(`entityIds(vocab)`), not scoped per-domain to that domain's own `entityType`, so a model can
validly (per the generated schema) reference `animal_cat` as the `house`-indexed array's index,
producing `house_animal[animal_cat]` in the compiled MiniZinc — an undeclared-identifier error
the real `minizinc` binary catches at solve time, but that `src/compiler/compile.ts` itself
apparently doesn't reject at compile time either (worth a follow-up: does the real compiler
validate domain-membership of adjacency/assignment entity references anywhere, or only that the
*variable* name resolves?). This is a genuine gap in THIS spike's schema generator, distinct
from sub-question 4's actual claim (enum-typing forecloses *out-of-vocabulary* values, which the
zero-cost smoke test already proved directly) — a per-domain-scoped entity enum is the natural
fix, not built here given the time-box, and named explicitly in the Conclusion as the clearest
next iteration rather than folded into a rerun.

**2026-09-15 — entity-scoping fix implemented and re-run (the recommended next step from §6,
taken up immediately rather than deferred).** Also opened
[SPIKE-009](../SPIKE-009-graph-style-reconciled-extraction/SPIKE.md) first, tracking the
broader question (is a global one-shot vocabulary decision the right architecture at all, vs. a
knowledge-graph-style local-extract/reconcile/filter pipeline) as a separate, not-yet-built
follow-up — this fix is the narrower patch, not that redesign.

`lib/clue-schema.ts` changes: `variableRefSchema` and a new `assignment`/`comparison`
generator now build one schema alternative PER DECLARED DOMAIN (`variable` fixed to a literal,
`entity`/`value` scoped to that domain's own `entityType`/`values` — mirroring
`compile.ts`'s own `isScalar` rule, `entityIds.length <= 1`, so schema-time scoping matches
solve-time expectations exactly) instead of one flat schema with independent global enums.
Added `smoke-test-entity-scoping.ts`, reproducing the exact live PZL-0002 shape
(`{variable:"house_color", entity:"animal_cat"}`) and confirming it's now rejected structurally
while the correct same-domain form still passes — zero cost, local only.

**A real provider constraint surfaced immediately on the first live retry, caught before the
full rerun**: OpenAI's forced-tool-call validator rejects a top-level `anyOf` in a tool's
`parameters` outright — `"schema must have type 'object' and not have 'oneOf'/'anyOf'/'allOf'/
'enum'/'const'/'not' at the top level"` — even with a sibling `type: "object"`. This is specific
to the TOP-LEVEL tool-parameters document; nested `anyOf` under a property (e.g.
`arithmetic.expression`'s `ArithmeticExpression` union) is unaffected and was already working
throughout the first billed run. Fixed by splitting `assignment` into one flat top-level tool
per domain (`assignment__<variable>`) instead of one `assignment` tool with an internal
per-domain union — the emitted payload's `kind` field stays the literal `"assignment"`
regardless, so `per-clue-extract.ts`'s assembly needed no change, only the outer tool NAME
differs. `comparison`'s per-domain union stays nested (inside `derivedRule.condition`, never a
top-level tool) and needed no change.

A live single-puzzle check (PZL-0002, the puzzle whose stored `.mzn` first diagnosed the bug)
confirmed the fix directly: the same puzzle now compiles with **zero cross-domain entity
references** — every `assignment`/`variableRef` correctly names an entity of the right type.
The puzzle still fails to compile, but for a *different*, already-acknowledged reason (no
numeric/ordered domain was declared for `adjacency`'s "directly left of" relation — a
vocabulary-completeness gap, not a cross-domain reference error) — direct evidence the fix
targets what it was built to target, without papering over it with a coincidentally-different
failure. Full 14-puzzle re-run launched next, reusing the prior run's unaffected `full-critic`
numbers (`SKIP_FULL_CRITIC=1`/`PRIOR_RUN_PATH`, added to `run-comparison.ts`) rather than
re-spending ~$2 re-measuring a harness this fix never touches.

## 5. Findings

One sample per puzzle × variant (SPIKE-005's own caveat applies equally here — individual
cells are suggestive, not conclusive; the aggregate pattern across 14 puzzles is the load-
bearing evidence, not any single cell). Raw records: `results/comparison-2026-09-14T13-32-51-460Z.json`.

### 5.1 Cost and call count

| Variant | Total cost (14 puzzles) | Total calls | Passing verdicts | Never reached a graded state |
|---|---|---|---|---|
| `full-critic` (today's real pipeline) | **$2.096** | 168 (worst-case constant, not measured — see caveat below) | 2/14 | 1/14 (`SOLVE_ERROR`) |
| `per-clue` (no critic) | **$0.029** | 73 (real) | 0/14 | 10/14 |
| `per-clue` + grounded revision | **$0.029** | 77 (real) | 2/14 | 8/14 |
| `per-clue` + back-translation | **$0.047** | 179 (real) | 1/14 | 7/14 |

Per-clue decomposition is **~45-72× cheaper** in measured dollars than today's full-critic loop
— the single clearest, least-ambiguous result of this spike. `full-critic`'s call count is
`fullCriticHarness.maxCallsPerPuzzle` (12), a worst-case ceiling this harness doesn't expose a
real per-puzzle count for, not a measured figure like the other three columns — flagged here
rather than silently presented as comparable.

### 5.2 Sub-question 1/4 — do structural failures drop?

**Directly proven, separately from the full run**: the zero-cost stub-server smoke test
(§4, 2026-09-15) showed an invented enum value (`"Green"` outside a `["Red","Blue"]` domain) is
rejected structurally before it ever reaches the compiler — this is unambiguous and doesn't
depend on the billed run at all.

**Complicated by the full run**: `per-clue` alone reached a gradable state on only 4/14 puzzles
(the rest were `COMPILE_FAILED` or `SOLVE_ERROR`) — worse structural reliability than
`full-critic`, which reached a gradable state on 13/14. The dominant cause, diagnosed directly
from stored `.mzn` text (PZL-0002, §4): this spike's schema generator scopes each `entity` enum
globally across ALL declared entities, not per-domain to the referencing field's own
`entityType` — so a model can validly (per the generated schema) index a `house`-typed array
with an `animal`-typed entity id. This is **exactly the class of error sub-question 4 predicts
enum-typing forecloses** — but only when the enum is scoped correctly, which this
implementation's generator doesn't yet do. The finding is nuanced, not negative: out-of-
vocabulary values are structurally impossible (proven); cross-domain-but-in-vocabulary
confusion is not yet, in this generator.

### 5.3 Sub-question 2 — net cost

At $0.029-0.047 vs $2.096, per-clue decomposition wins on cost by a wide enough margin that
even a much higher revision-round rate wouldn't close the gap. The "clean vs. churned"
population split the original Method asked for wasn't tracked per-puzzle in this run (no
column recorded which puzzles needed critic-loop revision rounds in `full-critic` specifically)
— a gap in this run's own instrumentation, not a finding either way.

### 5.4 Sub-question 3/5 — does the critic shrink, move, or help independently?

Both critic variants **recovered puzzles from an ungraded failure into a graded, sometimes
passing, state** that plain `per-clue` alone did not reach:
- PZL-0028 (ambiguous): `per-clue` alone → `COMPILE_FAILED` (N/A). Both `+grounded` and
  `+back-translation` → `SOLVE_MULTIPLY_SATISFIABLE` / `READING_MATCHED` (a genuine pass).
- PZL-0033 (subjective): `per-clue` alone → `SOLVE_ERROR` (N/A). `+grounded` →
  `PREMISE_FREE_MATCH` (a genuine pass). `+back-translation` stayed `SOLVE_ERROR`.

Both variants also **failed to help, or made things worse**, elsewhere:
- PZL-0011: `full-critic` → `MATCH`. `per-clue` alone → `SOLVE_UNSATISFIABLE`/`MISMATCH`.
  `+grounded`'s revision pass turned this into `COMPILE_FAILED` (N/A) — strictly worse than not
  revising at all. `+back-translation` left it unchanged (`MISMATCH`).
- PZL-0004: `full-critic` → `MATCH` (the one puzzle this spike's dry run had already inspected
  closely). None of the three per-clue variants reached `MATCH` — `per-clue` and
  `+back-translation` both `MISMATCH`, `+grounded` `COMPILE_FAILED`.

The back-translation critic's own detection worked as designed in the case inspected directly
(§4: correctly flagged 6/6 clues as suspect on a badly-vocabularied PZL-0004 run) — but a critic
downstream of a bad *vocabulary*-stage decision can only ask for a redo against that same
flawed vocabulary, which is consistent with why it didn't convert that case into a pass.

### 5.5 A failure surface outside all five sub-questions: vocabulary-stage entity modeling

Recorded directly in Notes (§4): stage 1's own decision about what counts as an "entity" (one
shared entity per zebra-style row, vs. one entity per attribute VALUE) varies between runs on
identical input — reproducing SPIKE-004's original non-determinism finding concretely, at the
vocabulary-modeling level specifically. Neither per-clue decomposition nor either critic variant
addresses this, because it happens upstream of both.

### 5.6 Post-fix re-run: the entity-scoping fix measurably improved `per-clue` alone

After the §4 (2026-09-15) entity-scoping fix, re-ran the same 14-puzzle sample (full-critic
reused unchanged from the first run — this fix never touches it; raw:
`results/comparison-2026-09-14T14-05-07-883Z.json`):

| Variant | Cost (14 puzzles) | Calls | Reached a gradable state | Passing verdicts |
|---|---|---|---|---|
| `per-clue`, **before fix** | $0.029 | 73 | 4/14 | 0/14 |
| `per-clue`, **after fix** | $0.031 | 77 | **8/14** | **2/14** |
| `per-clue+grounded`, before | $0.029 | 77 | 6/14 | 2/14 |
| `per-clue+grounded`, after | $0.036 | 83 | 7/14 | 0/14 |
| `per-clue+back-translation`, before | $0.047 | 179 | 7/14 | 1/14 |
| `per-clue+back-translation`, after | $0.058 | 183 | 7/14 | 2/14 |

`per-clue` alone — the variant with no critic to compensate — **doubled its gradable-state
rate (4/14 → 8/14) and went from zero genuine passes to two** (`PZL-0028` READING_MATCHED,
`PZL-0033` PREMISE_FREE_MATCH), at essentially unchanged cost. This is the cleanest, least
confounded result in this spike, because it isolates exactly what the fix targets: no critic,
no revision logic, just the generator change.

**Directly confirmed causally, not just aggregately**, on the same puzzle the bug was originally
diagnosed from (PZL-0002, §4): before the fix, its compiled MiniZinc referenced
`house_animal[animal_cat]` — a cross-domain entity, exactly the bug. After the fix, the same
puzzle's `per-clue` output has **zero cross-domain entity references** — every `assignment`/
`variableRef` correctly names an entity of the matching type. It still fails to compile, but
for a different, already-acknowledged reason (`"Could not find a single numeric positional
domain shared by 'house2' and 'house3' for adjacency relation 'directly left of'"` — a
vocabulary-completeness gap: no ordering domain was declared, not a cross-domain reference
error). Spot-checked two more `COMPILE_FAILED` cases in the post-fix run (`PZL-0001`:
`"Adjacency variable \"nationality\" is not shared by ... "`; `PZL-0010`: `"allDifferent
requires an entity-indexed variable; ... has only one entity"`) — both are this same adjacency/
vocabulary-completeness family, not a recurrence of cross-domain confusion.

`per-clue+grounded` got noisier, not better, post-fix (6/14→7/14 gradable, but 2/14→0/14
passing — both of its pre-fix passes, on `PZL-0028` and `PZL-0033`, flipped to a worse outcome
on the post-fix run). Given the single-sample-per-cell caveat (§5, SPIKE-005's own caveat) this
reads as LLM sampling variance on the puzzles genuinely near a coin-flip, not a sign the fix
made the grounded-revision critic worse — nothing in the fix touches that critic's logic.
`per-clue+back-translation` improved marginally (1/14→2/14 passing, gradable-state rate
unchanged), consistent with drawing from cleaner per-clue inputs without itself changing.

A schema-construction lesson surfaced while building the fix, independent of the spike's actual
question: a naive per-domain `anyOf` union at a TOOL's top level is rejected outright by OpenAI's
real function-calling validator (`"schema must have type 'object' and ... not have ... 'anyOf'
... at the top level"`), even though the identical union nested one level down (inside a
property, e.g. `arithmetic.expression`) works fine and was already in production use throughout
this spike's first run. The fix — split into one flat top-level tool per domain
(`assignment__<variable>`) rather than one tool with an internal union — is a concrete, reusable
pattern for representation-scoping under real tool-calling constraints, distinct from and
in addition to the SPIKE-005 mechanism findings this spike already built on.

## 6. Conclusion

**(b), confirmed with a fix-and-rerun cycle, not just diagnosed — still not (a), and not (c)
either.** The first run ruled out (a) as written: `full-critic` reached a gradable state on
13/14 puzzles and MATCHed 2; `per-clue` alone reached one on only 4/14 and MATCHed 0. Rather
than stopping at that diagnosis, the recommended fix (scope each field's `entity`/`variable`
enum to its domain's own `entityType`, per §5.2) was built and re-run (§5.6) in the same pass.
Result: `per-clue` alone **doubled its gradable-state rate (4/14 → 8/14) and went from zero
genuine passes to two**, at essentially unchanged cost, and — checked directly on the exact
puzzle the bug was diagnosed from — the specific failure class (cross-domain entity reference)
is now **structurally absent**, confirmed both by an offline regression test
(`smoke-test-entity-scoping.ts`) and by a live before/after diff on `PZL-0002`'s actual compiled
output. This is not "today's whole-document critic loop stays as designed" (c) either: a
one-iteration fix materially closed part of the gap that made per-clue look unviable in the
first pass.

It also isn't (a) yet, even after the fix: `per-clue` alone still only reaches a gradable state
on 8/14 puzzles, well short of `full-critic`'s 13/14, and the remaining `per-clue` failures are
a **different, already-named family** — adjacency/vocabulary-completeness gaps (no ordering
domain declared, `allDifferent` on a scalar variable) rather than cross-domain confusion. That
family is exactly what [SPIKE-009](../SPIKE-009-graph-style-reconciled-extraction/SPIKE.md)
(opened during this pass, not yet built) targets: a local-extract/reconcile/filter architecture
where vocabulary itself is built and validated the same way constraints are, rather than decided
once, globally, before any clue is examined.

**On cost (sub-question 2): unambiguous, unaffected by any of the above.** Per-clue decomposition
(any variant) costs 35-70× less than `full-critic` in measured dollars, before and after the fix
— a large enough margin that it survives generous slack for further iteration. This alone is
worth carrying into a follow-up ADR discussion regardless of how correctness nets out, since
$2.10 → $0.03-0.06 per puzzle compounds heavily at catalog scale (39 puzzles) or matrix scale
(model × harness).

**On the critic (sub-question 5): still inconsistent, and now legibly so.** Post-fix,
`per-clue+back-translation` improved slightly (1/14 → 2/14 passing); `per-clue+grounded` got
noisier (2/14 → 0/14 passing, though gradable-state rate ticked up 6/14 → 7/14) — read as
sampling variance on close-call puzzles (§5.6), not a fix-induced regression, since nothing in
the fix touches either critic's own logic. Both still show real value in isolated cases (§5.4)
without being net-positive on this small a sample. This remains a genuinely separate question
from decomposition's own viability, worth its own dedicated measurement once SPIKE-009's
vocabulary-reconciliation work (if pursued) changes what a critic even needs to catch.

**Recommended next steps, in order:**
1. Pursue [SPIKE-009](../SPIKE-009-graph-style-reconciled-extraction/SPIKE.md) — the
   entity-scoping fix closed the specific bug it targeted, but the *architecture* that produced
   it (one global vocabulary call, trusted unconditionally by every per-clue constraint call)
   is unchanged, and the remaining `per-clue` failures are exactly the shape that architecture
   predicts (vocabulary-completeness gaps a reconciliation pass would catch).
2. Once SPIKE-009 concludes (or if it's not pursued soon), draft an ADR informed by both spikes'
   findings — superseding ADR-009's staging, revising ADR-004 §2.1/§2.4 — rather than from this
   spike's numbers alone, since §5.6 shows one fix already meaningfully moved the comparison and
   a second architectural change is likely to move it further.
3. Re-measure the critic variants (sub-question 5) only after vocabulary-stage reliability is
   settled — critiquing constraints built on an unreliable vocabulary conflates two different
   failure surfaces (§5.4's back-translation finding: a critic downstream of a bad vocabulary
   decision can only ask for a redo against that same flawed vocabulary).

**Not built, per §1's explicit scope decision**: direct-MiniZinc-emission (a genuinely separate
falsification question) remains a candidate for its own future spike, not folded into this one.
Classification-as-step-zero (RFC-004 §5.3) likewise remains separate, though it may turn out to
share infrastructure with whatever SPIKE-009 builds for vocabulary reconciliation.
