---
id: ADR-008
title: Direct-Solve Baseline with LLM Judge
status: proposed
rfcs: [RFC-004]
created: 2026-09-06
specs: []
---

# ADR-008: Direct-Solve Baseline with LLM Judge

## 1. Context

The eval pipeline measures one expensive capability: prose → `ExtractedCsp` (a
machine-checked constraint model with entities, domains, and depth-bounded constraints) →
MiniZinc → solved assignment. Live sessions against a local 27B model showed direct
solving and schema-constrained extraction take roughly the same wall-clock time in free
prose (3:00 vs 3:26 on the same puzzle), while extraction through the forced-tool-call
schema envelope costs an order of magnitude more and fails outright on some models
(Gemma 0/2, both SchemaViolation). Every extraction failure is therefore ambiguous: the
model may be unable to reason about the puzzle, or merely unable to speak the schema.
Without a baseline measuring the first capability, the schema tax — the gap the harness
improvement track exists to close — cannot be quantified, and per-model timeouts have no
empirical anchor. Attributing a failure to the wrong condition is itself a failure
([RFC-004](../rfc/RFC-004-computational-decision-making.md) §5.7): a model that cannot reason
about the puzzle and a model that can reason but cannot speak the schema are two different
conditions, and today's pipeline reports both identically.

## 2. Decision

### 2.1 Baseline harness

A new `direct-solve` harness id (registered in `src/eval/harness.ts`, implemented in
`src/eval/direct-solve.ts`): the solver model receives matched fixed prompts (identical
wording for every model, versioned as `DIRECT_SOLVE_PROMPT_VERSION`) and answers in free
prose — no forced tool call, no schema. A judge model (default `z-ai/glm-5.3-flash`,
overridden by `--judge-model` / `ZEBRA_JUDGE_MODEL`) then grades that prose against the
answer key — which the runner serializes into the judge prompt — and returns a
`JudgeVerdict` forced tool call: `verdict` (`correct` / `incorrect` / `unclear`) plus a
`reason`. The runner maps verdicts into the shared outcome taxonomy (§2.2). Two LLM calls
per puzzle; no MiniZinc (`mzn: null`, which records already accept).

The judge judges; it does not transcribe. An earlier revision had the judge emit the
solution as structured assignments for `grader.ts` to score — that reduced the judge to a
lossy serializer (empty records, comma-joined strings, incoherent keys, puzzle prose
transcribed as answers), and three prompt revisions changed failure shape without changing
rate. Semantic comparison with paraphrase tolerance is what LLMs do well; lossless
structured emission is what they do poorly. The verdict schema has no transcription
surface by design.

### 2.2 Judge grades against the key; the runner maps verdicts to outcomes

The judge receives prose, solution, and the answer-key entry, and applies the entry's
per-class expectation itself (determinate full-grid match with paraphrase tolerance,
COP optimum value only, ambiguous some-reading match, subjective premise-free vs silent
promotion, non-problem decline expected — the rules live in the judge prompt, restating
[ADR-007](ADR-007-eval-outcome-grader-semantics.md) §2.1's per-class expectations in
prompt form rather than defining them fresh). It never solves, never fills gaps, and a
fluent but answer-free response is `unclear`. The runner (`gradeJudged`) translates
`correct`/`incorrect` into the class-appropriate pass/fail outcomes so pass-rate accounting
treats baseline and pipeline verdicts alike (`unclear` → `EXTRACT_FAILED` with
`JudgeUnclear` detail). On a non-problem, `incorrect` must map to a counted failure, not to
ADR-007 §2.1's `UNDECLINED` — this harness has a decline mechanism (the judge), so an
incorrect verdict here means the mechanism was used and got it wrong, which `UNDECLINED`'s
"no mechanism exists" exclusion does not cover. `grader.ts` stays the pipeline's scorer; the
baseline no longer routes through it.

### 2.3 Timeout calibration

`--baseline <run-id>.json --timeout-factor N` (default factor 3) caps each puzzle's
wall-clock at N × its slowest recorded baseline duration. The cap is a `Promise.race` in
the runner, uniform across harnesses — no per-call plumbing. Overruns record a new
`TIMEOUT` outcome (a failure in the denominator, never silent). Missing baseline files,
unreadable records, or puzzles absent from the baseline fail loudly rather than running
uncapped.

### 2.4 Judge model accounting

The judge model is a call like any other: it must be a `verified` entry in
[ADR-007](ADR-007-eval-outcome-grader-semantics.md) §2.3's model registry before a run uses
it, and its calls count against that run's budget and cost accounting the same way the
solver model's calls do. An override via `--judge-model` / `ZEBRA_JUDGE_MODEL` is subject to
the same registry gate — an unverified judge is skipped-with-reason, not silently run.

### 2.5 Scope

The baseline is an imperfect ballpark: judge over-acceptance on fluent wrong answers is
unmeasured (flagged follow-up: judge accuracy on known-wrong solutions), and the
3× factor is a starting calibration, not a derived constant.

## 3. Alternatives Considered

- **No baseline; keep measuring extraction only.** Rejected: leaves every extraction
  failure ambiguous between reasoning and schema-conformance, and gives timeout values no
  empirical anchor.
- **Judge emits MATCH/MISMATCH directly.** Rejected: duplicates grader semantics in a
  prompt, guaranteeing drift. The judge transcribes; code grades.
- **Per-call timeouts scaled from the baseline.** Rejected: couples every harness's
  internals to baseline data. A uniform wall-clock race covers all harnesses with one
  mechanism.
- **Deterministic answer parser instead of a judge.** Rejected: free-prose solutions vary
  in notation per model (tables, grids, sections); a regex parser would be per-model
  prompt engineering by another name.

## 4. Consequences

- Matrix cells gain a `direct-solve` column; per-model comparison tables show solve rate
  vs extraction pass rate, and the gap is the measured schema tax.
- The judge model is a cost and accuracy dependency: cheap judges over-accept fluent
  wrongness, so judge calibration (accuracy on known-right AND known-wrong solutions) is
  required before baseline numbers are trusted.
- `TIMEOUT` becomes a first-class outcome; local runs get time budgets to match their
  dollar budgets.
- `HarnessCompilation.mzn` / `HarnessSolution.mzn` widen to `string | null`; the shared
  `solveMzn` adapter refuses null MiniZinc rather than passing it to the solver.

## 5. Related

- RFCs: RFC-004
- Specs: _(populated automatically by the speckit ADR-link hook once `/speckit-specify` references this ADR)_
- Implementation: `.kilo/plans/1788691671220-eval-framework-improvements.md` — this branch
  was built against a kilocode-tracked plan rather than a speckit spec; see CLAUDE.md's
  Design process section for the recorded exception.
