---
id: ADR-009
title: Staged Extraction (Vocabulary then Constraints)
status: proposed
rfcs: [RFC-004]
created: 2026-09-06
specs: []
---

# ADR-009: Staged Extraction (Vocabulary then Constraints)

## 1. Context

Single-shot extraction sends one forced tool call carrying the entire `ExtractedCsp`
schema — entities, domains, and the full depth-bounded constraint union (~16k characters
at depth 2) — plus a ~2k-token system prompt covering every confusable clue shape. Live
measurement on a local 27B model shows all three failure modes concentrate in that single
call: wall-clock timeouts on constraint-dense puzzles (4/8 TIMEOUT in the local subset,
including a puzzle that completed in 94s on retry — variance, not difficulty), invented
constraint vocabulary (`"rightOf"` outside the closed 8-kind set → COMPILE_FAILED on
PZL-0028), and critic-loop waste (each revision re-emits the already-correct vocabulary
alongside the broken constraints). Meanwhile a free-form session extracted all six
attribute groups of a novel puzzle flawlessly in one pass: flat string lists are cheap
and reliable; nested constraint JSON is where time and fidelity go.

## 2. Decision

### 2.1 Two stages, vocabulary first

Stage 1 extracts `{entities, domains}` only — flat string lists under a small schema with
a short prompt (vocabulary identification, no constraint guidance). Stage 2 receives the
prose plus stage 1's decoded result and extracts `constraints` only, against that fixed
vocabulary. Assembly is deterministic code (concatenate the three arrays), not a third
LLM call. Either stage failing fails the extraction with the stage named
(`Stage1SchemaViolation`, `Stage2SchemaViolation`, etc.), so raw JSON attributes blame
correctly and partial-credit diagnostics (vocabulary right, constraints wrong) are
visible.

### 2.2 Constraint stage prompt discipline

Stage 2's prompt leads with the closed vocabulary: the 8 constraint kinds enumerated by
name plus an explicit no-other-kind-exists rule, and entity/variable/value references
restricted to stage 1's declared ids. The deep per-shape guidance of the monolithic
prompt (placeholder token families, nesting bounds, comparator/operator separation)
compresses to references against the fixed vocabulary rather than general instruction —
the model is no longer choosing names, only structure. Per-clue scoping is NOT
per-clue calls: one stage-2 call emits all constraints clue-by-clue (14 clues × local
latency would make per-clue calls slower than the monolith). Per-clue calls remain an
option if single-call stage 2 still times out — the seam supports it without redesign.

### 2.3 Interface and rollout

New `extractStaged(prose, options)` alongside `extract`/`extractSingleShot` in
`src/extraction/extract.ts`, reusing `extractOnce`-style `requestStructuredCompletion`
calls with two smaller schemas (`ExtractedVocabulary`, full `ExtractedCsp` minus
vocabulary for constraints — both derived from the existing `Entity`/`Domain`/
`ExtractedConstraint` schemas, no new constraint semantics). New harness id
`staged-single-shot` (`maxCallsPerPuzzle: 2`, `promptVersion` from a new
`STAGED_PROMPT_VERSION`). The critic loop, compiler, and grader are untouched: staged
output is an `ExtractedCsp` like any other. The monolithic paths stay until measurement
decides — the matrix compares them.

## 3. Alternatives Considered

- **Per-clue stage-2 calls.** Rejected for now: multiplies round trips by clue count
  against local latencies; the single-call stage 2 is tried first, per-clue is the
  fallback the seam already supports.
- **Free-form stage 1 parsed deterministically.** Rejected: saves one schema but adds a
  parser the project must own; the vocabulary schema is small enough that forced calls
  are already reliable there.
- **Shrinking the monolith (shorter prompt, depth 1).** Rejected: trades capability for
  payload without changing the failure structure — one call still couples vocabulary
  (reliable) with constraints (fragile), and depth 1 excludes catalog-real nesting.
- **Critic loop over stages instead of staging.** Rejected: orthogonal — the critic can
  later revise constraints-only, which staging enables but does not require.

## 4. Consequences

- Two LLM calls per extraction even single-shot: cheaper models / local runs pay latency
  twice, but each call is smaller than the monolith and failures attribute to a stage.
- `STAGED_PROMPT_VERSION` versions both stage prompts; either wording change bumps it.
- Success criterion (pilot): staged beats single-shot on Qwen-local timeout rate and
  constraint-vocabulary fidelity (no invented kinds) on the stratified subset; Gemma
  re-test is the stretch goal (small schemas succeeded there — stage 1 should pass, stage
  2 is the question).
- The `rightOf`-class infidelity moves from compile-time discovery to stage-2 decode:
  the `ExtractedConstraint` union admits only the nine literal kinds, so an invented kind
  fails decode as a `SchemaViolation` carrying the stage-2 tag — no separate assertion
  needed, decode is the assertion. Stage-2 prompt discipline (closed list + no-other-kind
  rule) is what keeps valid output flowing.

## 5. Related

- RFCs: RFC-004
- Specs: _(populated automatically by the speckit ADR-link hook once `/speckit-specify` references this ADR)_
