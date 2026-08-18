---
id: ADR-004
title: Adopt LLM-Based Extraction with a Solver-Validated Critic Loop
status: proposed
rfcs: [RFC-003]
created: 2026-08-18
specs: []
---

# ADR-004: Adopt LLM-Based Extraction with a Solver-Validated Critic Loop

## 1. Context

RFC-003 scoped extracting a computable CSP from a puzzle's prose clues and compared a five-tier
strategy spectrum (§5.2), evaluated empirically by four spikes (Appendix §9, `design/spikes/`)
rather than left as guesses. The evidence converges cleanly enough to decide:

- **Rule-based/grammar (9.1)**: [SPIKE-001](../spikes/SPIKE-001-catalog-clue-audit/SPIKE.md)
  found only 4 of the seed catalog's 14 puzzles (~29%) reduce to simple flat clue patterns; the
  other 10 need fundamentally different handling per shape (a second extraction pass over a
  generative meta-rule, recognizing a named problem type, a dedicated parser for an ASCII-art
  diagram or an embedded markdown table). This isn't "write more grammar rules" — it's several
  distinct engineering efforts, disproportionate to what the LLM tier does for free (below).
- **JS-native NLP (9.2)**: [SPIKE-002](../spikes/SPIKE-002-js-native-nlp-wink/SPIKE.md) found
  wink-nlp's pattern matcher crashes on hyphenated compounds in a way that silently voids
  unrelated patterns registered in the same batch, and doesn't generalize across syntactic voice.
  A brittle foundation to build anything further on top of.
- **Small specialized model (9.3, GLiNER2)**: [SPIKE-003](../spikes/SPIKE-003-gliner2-capability/SPIKE.md)
  substantially outperformed 9.2, fully offline, with graceful (non-crashing) failure modes — the
  strongest non-LLM contender.
- **LLM-based (9.4)**: [SPIKE-004](../spikes/SPIKE-004-llm-based-extraction/SPIKE.md) found this
  tier solves two shapes that defeated every other tier outright — the hyphenated `3-by-3` grid
  dimension, and a raw embedded markdown table row — via schema-constrained structured output on
  both a frontier model (`anthropic/claude-sonnet-4.5`) and a ~30x cheaper one
  (`google/gemini-2.5-flash-lite`). But it is also the least deterministic tier, confirmed
  concretely: the identical extraction call, same model, same input, same schema, returned a
  correct result once and a schema-valid-but-semantically-wrong result (`"outcome": "680"`, a
  credit-score value, not a valid outcome) on a second run.

This ADR converges on the LLM-based tier as the primary extraction strategy, and — because
SPIKE-004's non-determinism finding means schema validity alone is not a sufficient trust
signal — extends the decision with a validation architecture built around this project's own
solver (`src/solver/`, [ADR-002](ADR-002-adopt-minizinc-solver.md)) as a critic, plus model-tier
routing to control cost. This resolves RFC-003 Open Questions 7.1 (representation shape), 7.2
(failure mode), and 7.3 (round-trip validation as a hard gate), and states how 7.6's boundary
case (derived variables, non-binary outcomes) is accommodated at the representation level.

**Out of scope for this ADR** (each is either a separate future decision or explicitly deferred
elsewhere): the CLI subcommand that would expose this capability (a follow-up extension to
[ADR-003](ADR-003-cli-interface.md)'s shape, per its own stated growth pattern, once this is
built); the graph-representation compiler (RFC-003 Non-Goal, still undesigned); CSP → NL
generation (RFC-003 §4/§6, its own future RFC); and building a validated-example corpus toward a
local-first/distillation tier — a natural consequence of this design (§4) but not something this
ADR commits to building now.

**A sequencing dependency, not just a deferred nice-to-have**: this ADR's critic loop (§2.4)
cannot be fully implemented until the `ExtractedCsp` → `.mzn` compiler ADR (§2.2, §4) exists —
`/speckit-specify` on this ADR alone can build extraction, model routing, and the error model
now, but the round-trip validation step is blocked on that sibling decision.

## 2. Decision

### 2.1 Extraction strategy: schema-constrained LLM extraction

Adopt LLM-based extraction (RFC-003 §5.2/§9.4) as the primary strategy: an LLM call constrained
to a JSON Schema response format (tool/structured-output mode, `strict: true`), not free-form
prompting. Rule-based, JS-native-NLP, and small-model tiers are not adopted as the primary
strategy (§3) — GLiNER2 (9.3) remains the leading candidate for a future local-first tier (§4),
not rejected outright.

This also resolves Open Question 7.5 in the LLM tier's favor: RFC-003 Appendix §9's
Extensibility criterion (criterion 6) already scored LLM-based extraction "Best" on reach toward
[RFC-001](../rfc/RFC-001-parameterizable-puzzle-generation.md)'s future vague/contextual and
subjective/preference clue-strictness tiers, since "interpretation and preference are exactly
what general-purpose LLMs are suited to reason about" (§9.4) — the widest evidenced headroom of
any tier. This ADR's spike evidence (SPIKE-001-004) directly validates only the seed catalog's
current shape variety, not those future tiers themselves; the Appendix's qualitative scoring, not
new empirical evidence, is what this decision leans on for 7.5's forward-looking half.

### 2.2 Intermediate representation

Resolves Open Question 7.1. Extraction produces a solver-agnostic JSON structure — not MiniZinc
text directly, not a free-form blob — designed to map cleanly onto both known consumers:
[ADR-002](ADR-002-adopt-minizinc-solver.md) §2.5's MiniZinc target (arrays of finite-domain
variables, `alldifferent`/comparison/arithmetic/`if-then-else` constraints) and a future graph
representation (entities/constraints as candidate nodes/edges).

The decision is the six-kind constraint taxonomy below (drawn from SPIKE-001's shapes, per the
rationale after the listing) — not the exact TypeScript syntax. The shape illustrates that
taxonomy; field names and precise typing are implementation's call, not fixed by this ADR:

```ts
interface ExtractedCsp {
  readonly entities: ReadonlyArray<{ readonly id: string; readonly type: string }>
  readonly domains: ReadonlyArray<{
    readonly variable: string
    readonly entityType: string
    readonly values: readonly string[]
  }>
  readonly constraints: readonly ExtractedConstraint[]
}

type ExtractedConstraint =
  | { readonly kind: "assignment"; readonly entity: string; readonly variable: string; readonly value: string }
  | { readonly kind: "allDifferent"; readonly variable: string }
  | { readonly kind: "adjacency"; readonly relation: string; readonly a: string; readonly b: string }
  | { readonly kind: "relation"; readonly name: string; readonly a: string; readonly b: string }
  | { readonly kind: "derivedRule"; readonly appliesTo: string; readonly condition: string; readonly then: readonly ExtractedConstraint[] }
  | { readonly kind: "arithmetic"; readonly expression: string; readonly comparator: string; readonly target: string | number }
```

This taxonomy is drawn directly from [SPIKE-001](../spikes/SPIKE-001-catalog-clue-audit/SPIKE.md)'s
12 observed shapes, collapsed to their computable essence: `assignment`/`adjacency` cover the
simple shapes (A-D); `relation` + `derivedRule` cover shape E's two-pass "fact, then a rule
applied over facts" pattern; `arithmetic` covers shapes F/H/I's numeric/threshold constraints,
including — resolving Open Question 7.6 — derived variables and non-boolean outcomes via
`derivedRule`'s nested `then` list rather than requiring a strictly binary satisfy/fail shape.
Like [ADR-002](ADR-002-adopt-minizinc-solver.md) §2.5 committing to a MiniZinc target while
deferring the compiler that produces it, this ADR commits to *this* representation and its
constraint taxonomy while deferring the `ExtractedCsp` → `.mzn` compiler itself as follow-up
work — expected to grow as new constraint shapes are encountered, the same way ADR-003 names
itself "deliberately incomplete by design."

Shapes G (an ASCII-art arithmetic diagram) and K's raw markdown table (SPIKE-001) are not
addressed by this schema directly — per SPIKE-004, the LLM tier parses them directly into the
schema fields above (e.g. a table row's columns become `assignment` facts) without needing a
dedicated pre-parser, unlike every other tier.

### 2.3 Workflow architecture: pure Effect, no agentic framework

The extraction workflow — call, critique, escalate, retry — is implemented as a composed
`Effect` pipeline, not an agentic framework (Mastra, Vercel AI SDK) and not `@effect/ai`. Three
reasons converge on this:

1. The workflow's control flow (§2.4/§2.5) is authored upfront by this ADR, not decided
   dynamically by an LLM at runtime — a workflow-orchestration problem, which `Effect` already
   solves generally (typed errors, retries, concurrent fan-out), not an agentic problem that
   would justify a framework built for dynamic, LLM-driven control flow.
2. `@effect/ai` (and every `@effect/ai-*` provider package) peer-depends on `effect@^3.22.x`,
   incompatible with this repo's `effect` 4.x pin regardless of which 4.x prerelease is in use —
   confirmed by [SPIKE-004](../spikes/SPIKE-004-llm-based-extraction/SPIKE.md) and generalized in
   `CLAUDE.md`'s dependency notes into a standing pattern to check for any `@effect/*` package.
3. A full agentic framework would still need hand-wrapping to compose with the existing
   `src/solver/solve.ts` Effect the critic loop (§2.4) calls into directly — trading "wrap a thin
   client" for "wrap a bigger, more opinionated surface," without eliminating the wrapping work.

Concretely: `@openrouter/sdk` (zero peer dependencies, a thin API client — confirmed by
SPIKE-004) is hand-wrapped in `Effect.tryPromise`, the same pattern `src/solver/solve.ts` already
uses for `node:child_process` since `@effect/platform`'s `Command` module has the same
incompatibility. Retries/timeouts use `Effect`'s own `Schedule`/`Effect.retry`/`Effect.timeout`;
provider and critic failures are modeled as tagged errors (§2.6), not thrown exceptions.

### 2.4 Critic loop: solver-validated round-trip as the hard gate

Resolves Open Question 7.3: **yes**, round-trip solver validation is a hard gate, not optional —
directly justified by SPIKE-004's non-determinism finding, since schema validation provably did
not (and structurally cannot) catch that failure.

For each extraction attempt:

1. **Cheap sanity check** (free, pre-solver): compare `ExtractedCsp`'s entity/domain/constraint
   counts against the puzzle's declared `variables`/`domains`/`constraints` frontmatter
   (`catalog/puzzles/` format) — a gross-omission check before paying for a solve.
2. **Compile** `ExtractedCsp` to a MiniZinc model (the compiler itself is follow-up work, §2.2).
3. **Solve** via the existing `src/solver/solve.ts` Effect (no new solver integration needed).
4. **Accept only `UniquelySolvable`.** `Unsatisfiable` and `MultiplySatisfiable` are both
   critic-*reject* signals here — a meaningfully different judgment than
   [ADR-002](ADR-002-adopt-minizinc-solver.md) §2.2's `solve` subcommand, which correctly treats
   all three as valid, non-error *solving* outcomes about a given model. This ADR's critic isn't
   asking "what does this model compute" (already answered, correctly, by `solve`) — it's asking
   "should this *extraction* be trusted," and an extraction that produces an unsatisfiable or
   under-constrained model has failed that trust question even though `solve` ran successfully.

Resolves Open Question 7.2 (acceptable failure mode): **reject and escalate**, not blind
same-model re-prompting. SPIKE-004's failure was a same-model, same-input, run-to-run
divergence — re-prompting the identical model with the identical input has no principled reason
to behave differently; escalating to a materially different model tier (§2.5) does. If escalation
is exhausted without an `UniquelySolvable` result, the extraction is rejected and flagged (a
typed `CriticRejected` error, §2.6) for manual review — never silently accepted, per RFC-003
Goal 4.

Self-consistency sampling (N parallel extraction attempts on the same model, compared via
`Effect`'s own concurrent fan-out) is available as a **secondary, opt-in** critic signal for cases
round-trip solving can't fully adjudicate — notably Open Question 7.6's boundary case, where a
derived-variable/branching-outcome puzzle may not reduce to a single clean satisfiability
question the way a classic assignment puzzle does. It is not mandated for every extraction, since
it multiplies LLM calls the free round-trip check doesn't.

### 2.5 Model routing: cheap-first, escalate on critic rejection

Resolves the cost-control goal from the RFC-003 discussion that led to this ADR. Extraction
attempts start on a cheap model tier (`google/gemini-2.5-flash-lite` per SPIKE-004's pricing);
critic rejection (§2.4) triggers one escalation to a frontier tier
(`anthropic/claude-sonnet-4.5`) and a retry. SPIKE-004 found both models performed similarly well
on the tested sample, so escalation is expected to be the exception path, keeping average cost
low — this is a testable expectation once real usage volume exists, not a guarantee (§4).
Model identifiers are configuration reachable through `@openrouter/sdk`'s single client, not
hard-coded architecture — swapping either tier's specific model doesn't require a design change.
No third escalation tier is decided here; that's future work if two tiers prove insufficient.

### 2.6 Error model

Mirrors `src/solver/types.ts`'s `SolverError` tagged-union convention, so this pipeline composes
with the existing solve Effect using the same idiom. The decision is the three-category error
taxonomy (provider failure, schema violation, critic rejection) — the shape below illustrates it;
exact field names and typing are implementation's call, not fixed by this ADR:

```ts
class ProviderError extends Data.TaggedError("ProviderError")<{ readonly message: string }> {}
class SchemaViolation extends Data.TaggedError("SchemaViolation")<{ readonly raw: string }> {}
class CriticRejected extends Data.TaggedError("CriticRejected")<{
  readonly attempts: readonly { readonly model: string; readonly result: SolveResult }[]
}> {}

type ExtractionError = ProviderError | SchemaViolation | CriticRejected | SolverError
```

`SchemaViolation` is a safety net, not an expected path — `strict: true` structured output should
prevent it, but the pipeline models it honestly rather than assuming it can't happen.
`CriticRejected` carries every attempt's model and `SolveResult` (not just the last), so a
rejected extraction is diagnosable, not just a bare failure.

## 3. Alternatives Considered

- **Rule-based/grammar (9.1) as the primary tier.** Rejected (Context): SPIKE-001's 29% simple-
  pattern coverage means the other 71% needs several distinct engineering efforts, not grammar
  extensions — disproportionate given the LLM tier solves the hardest of those shapes natively.
- **JS-native NLP (9.2, wink-nlp) as the primary tier.** Rejected (Context): SPIKE-002 found a
  batch-voiding registration crash and no cross-voice generalization — too brittle a foundation.
- **Small specialized model (9.3, GLiNER2) as the primary tier.** The strongest non-LLM
  contender — fully offline, no per-call cost, graceful failure modes (SPIKE-003). Not chosen as
  *primary* because SPIKE-004 showed the LLM tier still solves strictly more (the grid-dimension
  and embedded-table shapes GLiNER2 didn't fully resolve). Explicitly not rejected outright: this
  is the natural target for a future local-first tier once a validated-example corpus exists to
  ground it (§4), rather than building that tier speculatively now.
- **Hybrid across extraction tiers (9.5), e.g. a rule-based fast path falling back to an LLM.**
  Rejected as RFC-003 §9.5 originally framed it: the rule-based tier's coverage gaps are broad
  enough (12 shapes, only 4 simple) that a "fast path" would rarely fire without disproportionate
  investment in the fast path itself. A hybrid *within* the LLM tier — cheap model escalating to
  frontier (2.5) — is adopted instead, a cost axis rather than a technique axis.
- **Blind same-model re-prompting on failure**, instead of escalating to a different model tier.
  Rejected (2.4): SPIKE-004's failure mode was same-model, same-input, run-to-run divergence —
  re-prompting the identical model with identical input has no principled reason to behave
  differently.
- **An agentic framework (Mastra, Vercel AI SDK) for the workflow.** Rejected (2.3): the
  workflow's control flow is authored upfront, not LLM-driven — a workflow-orchestration problem,
  not an agentic one — and either framework would still need hand-wrapping to compose with the
  existing solver Effect, trading one integration surface for a larger one.
- **`@effect/ai`.** Rejected (2.3): peer-depends on `effect@^3.22.x`, incompatible with this
  repo's `effect` 4.x pin regardless of prerelease (confirmed by SPIKE-004).
- **Always use the frontier model; skip cost-tiering.** Rejected (2.5): SPIKE-004 found the cheap
  model matched frontier quality on most tested shapes, with no evidenced accuracy justification
  for paying frontier price on every call — especially once the critic loop (2.4) already catches
  whichever tier's failures occur.
- **Trust schema-constrained output directly; no critic loop.** Rejected outright: SPIKE-004's
  core finding directly refutes this — schema validity provably does not guarantee semantic
  correctness.

## 4. Consequences

- Every extraction this pipeline accepts has been solver-validated by construction — a
  meaningful, free-standing guarantee (provably `UniquelySolvable`, not just schema-valid) that
  the deterministic tiers (9.1/9.2) get for free without needing it, since their failure mode is
  "doesn't parse" rather than "parses to something plausible but wrong."
- Network dependency and per-call $ cost (RFC-003 Appendix §9.4) remain real runtime
  requirements. Open Question 7.4 (offline/CI testability) is **not** resolved by this ADR — a
  live test suite still needs network access or mocking/caching, neither designed here.
- Rejected extractions (escalation exhausted) need a defined manual-review/reporting surface —
  this ADR names the typed error (2.6) but doesn't design the human-facing workflow around it.
- Every critic-*accepted* (prose clue → `ExtractedCsp`) pair is a natural candidate to accumulate
  into a growing validated corpus — directly serving the local-first/distillation direction
  raised alongside this decision, and doubling as future CI fixtures (partially answering Open
  Question 7.4). This ADR does not commit to building that accumulation system; it's expected,
  motivated follow-up work, and whether it extends this ADR or becomes its own future RFC/ADR is
  an open scoping question, not decided here.
- The `ExtractedCsp` representation (2.2) is a new schema this project now owns, coordinated with
  both the MiniZinc compilation target ([ADR-002](ADR-002-adopt-minizinc-solver.md) §2.5) and the
  still-undesigned graph-representation compiler (RFC-003 Non-Goal) — future ADRs touching either
  consumer need to respect this shape, not redesign it independently.
- The `ExtractedCsp` → `.mzn` compiler itself remains undesigned, mirroring
  [ADR-002](ADR-002-adopt-minizinc-solver.md)'s own deferred graph-to-`.mzn` compiler — this ADR
  commits to the representation both compilers must eventually target, not to writing either one.
- Cheap-model-first (2.5) assumes escalation is the exception path based on SPIKE-004's small
  sample; real usage volume may reveal a higher escalation rate than expected, eroding the
  intended cost savings — worth monitoring once built, not assumed indefinitely.
- This ADR does not decide CLI exposure — a follow-up extension to
  [ADR-003](ADR-003-cli-interface.md)'s shape once this capability is built, per that ADR's own
  stated growth pattern.
- Open Question 7.6 is addressed at the representation level (`derivedRule`'s nested `then`,
  admitting derived variables and non-boolean outcomes) but not empirically re-validated against
  `PZL-0011` specifically by this ADR — worth confirming once implemented.

## 5. Related

- RFCs: RFC-003
- Specs: _(populated automatically by the speckit ADR-link hook once `/speckit-specify`
  references this ADR)_
