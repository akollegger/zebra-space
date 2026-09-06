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
empirical anchor.

## 2. Decision

### 2.1 Baseline harness

A new `direct-solve` harness id (registered in `src/eval/harness.ts`, implemented in
`src/eval/direct-solve.ts`): the solver model receives matched fixed prompts (identical
wording for every model, versioned as `DIRECT_SOLVE_PROMPT_VERSION`) and answers in free
prose — no forced tool call, no schema. A judge model (default `z-ai/glm-5.3-flash`,
overridden by `--judge-model` / `ZEBRA_JUDGE_MODEL`) then converts that prose into a
`DirectSolutionVerdict` forced tool call: `outcome` (`unique` / `multiple` /
`unsatisfiable` / `unclear`) plus up to two free-form assignments (field → scalar). The
verdict maps to the solver's existing `SolveResult` trichotomy (`unique` →
`UniquelySolvable`, `multiple` → `MultiplySatisfiable`, `unsatisfiable` →
`Unsatisfiable`), and the existing per-class grading in `grader.ts` scores it. `unclear`
has no `SolveResult` equivalent and surfaces as `JudgeUnclear` (an extraction-stage
failure, alongside `ProviderError`/`SchemaRejected`/`SchemaViolation`). Two LLM calls per
puzzle; no MiniZinc (`mzn: null`, which records already accept).

### 2.2 Judge proposes, grader disposes

The judge transcribes what the solver claimed; it never solves, never fills gaps, and a
fluent but answer-free response is `unclear`. All comparison semantics stay in `grader.ts`
— the pairing-aware determinate rules, COP optima, ambiguous readings, subjective
premise detection — so baseline numbers are strict in exactly the same places pipeline
numbers are. A loose "does this look right" judge would inflate the baseline precisely
where the pipeline is strict and make the gap meaningless.

### 2.3 Timeout calibration

`--baseline <run-id>.json --timeout-factor N` (default factor 3) caps each puzzle's
wall-clock at N × its slowest recorded baseline duration. The cap is a `Promise.race` in
the runner, uniform across harnesses — no per-call plumbing. Overruns record a new
`TIMEOUT` outcome (a failure in the denominator, never silent). Missing baseline files,
unreadable records, or puzzles absent from the baseline fail loudly rather than running
uncapped.

### 2.4 Scope

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
