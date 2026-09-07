---
id: ADR-010
title: Actual LLM Cost Accounting for the Eval Harness
status: proposed
rfcs: [RFC-004, RFC-003]
created: 2026-09-07
specs: []
---

# ADR-010: Actual LLM Cost Accounting for the Eval Harness

## 1. Context

`chargePuzzle` in `scripts/eval-extraction.ts` charges every puzzle the same amount:
`costPerCallUsd * maxCallsPerPuzzle`, the registry's per-call price times a harness's
worst-case call count, regardless of how many calls that puzzle actually took. A puzzle the
full critic loop accepts on its first attempt is charged as if it needed all 12 worst-case
calls; a puzzle a harness declined to call at all (a budget refusal, a verification gate) is
never charged, but a puzzle that needed six retries before succeeding is charged the same
flat amount as one that needed one. `eval/matrix.md`'s per-cell estimates inherit the same
number, so a run's committed spend figures are a pre-run guess carried through as if it were
a measurement.

The number that would fix this already exists in every response: the `@openrouter/sdk`'s
`ChatResult.usage` carries a `cost` field (`number | null | undefined`) — the actual dollar
cost OpenRouter billed for that specific call, present whenever the upstream provider reports
it and `undefined` on routes that don't bill in dollars (a local model via
`ZEBRA_LOCAL_BASE_URL`, a free-tier entry). Nothing in `src/` or `scripts/` reads it.
`src/extraction/provider.ts`'s `requestStructuredCompletion` and `src/eval/direct-solve.ts`'s
`requestProseCompletion` both decode the SDK response down to a single typed value — an
`ExtractedCsp`, a `FidelityCritique`, a `JudgeVerdict`, plain prose — and discard the
response object that carried the cost.

Surfacing that field changes what every one of those functions' callers can carry outward —
the extraction pipeline's own call-site contracts, the layer
[RFC-003](../rfc/RFC-003-natural-language-csp-extraction.md) governs, and the same layer
[ADR-009](ADR-009-staged-extraction.md) reshaped for an unrelated reason. A call-site change
that ripples through the critic loop's tier orchestration has to add capability without
changing what today's callers already receive from a successful call.

## 2. Decision

### 2.1 A cost-reporting side channel, not a changed return type

`StructuredCompletionRequest<A>` gains an optional field, `onCost?: (usd: number) => void`.
`requestStructuredCompletion` calls it once, via `Effect.tap` immediately after a successful
decode, with `response.usage?.cost` — only when that value is a `number` (present and
non-null); a `null` or missing `cost` reports nothing, the same as if `onCost` had never been
passed. `requestProseCompletion` gains the identical field and calls it the same way. Neither
function's success type changes: `Effect<A, ProviderError | SchemaRejected |
SchemaViolation>` stays exactly what every existing caller already expects.

A caller that doesn't pass `onCost` loses nothing it has today. A caller that does —
`extractOnce`, `critiqueOnce`, and `critiqueWithRepair` in `src/extraction/extract.ts`; the
two `requestStructuredCompletion` calls in `extractStaged`; `directSolveHarness`'s two calls
in `src/eval/direct-solve.ts` — receives one accumulator through its own parameters and adds
to it on every call it makes, including retried and escalated attempts within the critic
loop's `runTier`/`runTierSafely`. A failed attempt (a timeout, a rejected schema, a
`SchemaViolation` that gets repaired and retried) contributes nothing on that attempt: an
error response never carries `usage`, so there is nothing to add — only a call that reaches a
successful decode reports a cost.

### 2.2 Each harness stage reports its own measured total

Every harness's `extract`/`compile`/`solve` stage already returns a custom object
(`{extractedCsp, model}`, then `{..., mzn}`, then `{..., solveResult}` — `EvalHarness`'s
three stage-separated `Effect`s in `src/eval/harness.ts`). Each stage gains one field,
`actualCostUsd: number | undefined`, carrying the sum of every `onCost` report made within
that stage — `undefined` when the stage made calls but every one of them reported no cost
(a fully local or free-tier run), distinct from a measured `0`. `compile` and `solve` forward
their predecessor's `actualCostUsd` unchanged through the same object-spread pattern they
already use to pass `extractedCsp` and `model` along (`{...extraction, mzn}`); only `extract`
produces a new value, since it is the only stage that makes LLM calls today.

### 2.3 The runner sums actual cost, falling back to the registry estimate per call

`chargePuzzle` (`scripts/eval-extraction.ts`) replaces its flat
`costPerCallUsd * maxCallsPerPuzzle` charge with the harness's reported `actualCostUsd` when
it is a number, and the registry's per-call estimate times that harness's
`maxCallsPerPuzzle` only when `actualCostUsd` is `undefined` — the same two-tier rule ADR-007
§2.3 already specified ("Spend per call is the SDK's reported `usage.cost` when present …
else the registry estimate") and never implemented. `writeRawResults`' per-puzzle record
gains both figures side by side — `estimatedCostUsd` (today's pre-run number, kept for the
budget gate's own pre-run check, which still has to run before any call is made) and
`actualCostUsd` — so `eval/results.md` and `eval/matrix.md` can report a measured number
instead of the estimate standing in for one. `eval-matrix.ts`'s verdict grid (ADR-007 §2.3;
its rendering is `renderVerdictGrid` as of the matrix-tooling fixes on this branch) gains a
per-cell actual-spend line alongside its existing pass-rate line, reading each cell's raw
JSON the same way it already does for verdicts.

## 3. Alternatives Considered

- **Change every affected function's success type to carry cost alongside its value** (e.g.
  `Effect<{data: A; costUsd: number | undefined}, Err>`). Rejected: every caller of
  `requestStructuredCompletion` — and every caller of *those* callers, up through the critic
  loop's tier orchestration — would need to destructure a wrapped value instead of using the
  decoded payload directly, for a benefit (cost) most callers don't need at their layer. The
  side-channel callback gets the same data to the same places without changing what any
  existing caller receives on success.
- **A `Ref`/`FiberRef`-based accumulator instead of a plain callback.** Rejected for this: the
  harness's stages run sequentially within one puzzle, one call at a time — there is no
  concurrent access to guard against, so a `Ref`'s compare-and-swap semantics buy nothing a
  closed-over `let costUsd = 0` doesn't already give, at the cost of introducing an `Effect`
  service/context threading question (does the `Ref` live in `Context`, get passed as a
  parameter, get created per-call?) that a plain callback parameter avoids entirely.
- **Wrap only the top-level harness `extract()` call and read the SDK response there.**
  Rejected: a stage that makes more than one call — the critic loop's multiple tiers and
  revision rounds, staged extraction's two stages, direct-solve's solve-then-judge pair —
  would report only whichever call's response the wrapper happened to see, silently dropping
  every other call's cost rather than summing them. Per-call reporting is what makes the sum
  correct regardless of how many calls a stage ends up making.
- **Leave `chargePuzzle` as a worst-case-only estimate.** This was the status quo before
  ADR-007, and ADR-007 §2.3 already decided against it — the estimate is what protects a
  pre-run budget check (which has to run before any call exists to measure), not what should
  stand in for a cell's actual spend afterward. Committing to the estimate permanently after
  ADR-007 already named the fix would leave every dollar figure in `eval/results.md` and
  `eval/matrix.md` a guess wearing a measurement's clothes.

## 4. Consequences

- Every function on the critic loop's call chain from `requestStructuredCompletion` up to
  `extract()` — `extractOnce`, `critiqueOnce`, `critiqueWithRepair`, `runTier`,
  `runTierSafely` — gains one additional parameter to carry the `onCost` callback down. This
  is signature growth at each layer, not a behavior change to any of them.
- A puzzle that needed retries or tier escalation before succeeding is under-counted relative
  to what OpenRouter actually billed for the failed attempts, since an error response never
  carries `usage`. The registry's per-call estimate is not substituted in for those specific
  failed calls — only for a whole stage whose successful calls never reported a cost — so a
  retry-heavy puzzle's `actualCostUsd` is a real lower bound, not a corrected total. Closing
  this gap would need OpenRouter to bill and report failed generations, which is outside this
  project's control.
- `eval/models.json`'s `cost_per_call_usd` estimates stop being the only spend figure in
  `eval/results.md`/`eval/matrix.md` and become a visible pre-run ceiling and per-call
  fallback instead — a live discrepancy between the two (e.g. a model whose real cost
  consistently runs well under its registry estimate) becomes something the eval can surface,
  where today it can't be seen at all.
- The pre-run budget-estimate check (`checkBudgetEstimate`) is unaffected: it still runs
  before any call is made and still uses the registry number, because no actual cost exists
  yet to check against.

## 5. Related

- RFCs: RFC-004, RFC-003
- Specs: _(populated automatically by the speckit ADR-link hook once `/speckit-specify`
  references this ADR)_
- Implementation: deferred from the `eval-framework-improvements` branch's code-review fix
  pass — see `CLAUDE.md`'s Design process section and
  [ADR-007](ADR-007-eval-outcome-grader-semantics.md) §2.3, whose actual-cost decision this
  ADR now specifies concretely enough to build.
