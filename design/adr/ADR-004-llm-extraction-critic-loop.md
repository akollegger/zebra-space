---
id: ADR-004
title: Adopt LLM-Based Extraction with a Fidelity Critic Loop
status: proposed
rfcs: [RFC-003]
created: 2026-08-18
specs:
  - specs/004-nl-csp-extraction
---

# ADR-004: Adopt LLM-Based Extraction with a Fidelity Critic Loop

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
signal — extends the decision with a **fidelity critic loop**: a second LLM call that judges
whether a candidate extraction is an isomorphic, faithful translation of the source prose, plus
model-tier routing to control cost. This resolves RFC-003 Open Questions 7.1 (representation
shape), 7.2 (failure mode), and 7.3 — but 7.3 is resolved by *rejecting* round-trip solver
validation as the trust mechanism, not adopting it (see below) — and states how 7.6's boundary
case (derived variables, non-binary outcomes) is accommodated at the representation level.

**Why not round-trip solver validation** (this ADR's own earlier design, corrected before
publication): solvability and translation correctness are orthogonal. A faithful extraction of a
prose puzzle that is genuinely contradictory, as written, *should* compile to `Unsatisfiable` —
that is a correct translation of an unsatisfiable problem, not a failure. A faithful extraction
of a prose puzzle that genuinely under-constrains its answer *should* compile to
`MultiplySatisfiable`, for the same reason. Gating trust on solve outcome would reject correct
extractions of ill-posed prose, and — more fundamentally — the solver only ever sees the
*compiled model*, never the source prose, so it structurally cannot detect misinterpretation (a
swapped entity, an invented constraint, a dropped clue). Only a critic with access to **both** the
prose and the extraction can judge whether the translation is faithful. Compiling and solving are
no longer part of the *trust gate* — this ADR's critic loop (§2.4) has no implementation
dependency on [ADR-005](ADR-005-extractedcsp-mzn-compiler.md)'s compiler. Compiling a
critic-accepted extraction is still a real, useful capability elsewhere in this system (e.g.
[ADR-003](ADR-003-cli-interface.md) §2.6's `extract` CLI compiles by default before printing) —
that's a rendering choice made *after* trust is established, not a re-entry of solving into how
trust is decided.

**Out of scope for this ADR** (each is either a separate decision or explicitly deferred
elsewhere): the CLI subcommand that exposes this capability (designed separately in
[ADR-003](ADR-003-cli-interface.md) §2.6); the `ExtractedCsp` → `.mzn` compiler (designed
separately in [ADR-005](ADR-005-extractedcsp-mzn-compiler.md), and — per the correction above —
not a dependency of this ADR's critic loop); the graph-representation compiler (RFC-003
Non-Goal, still undesigned); CSP → NL generation (RFC-003 §4/§6, its own future RFC); and
building a validated-example corpus toward a local-first/distillation tier — a natural
consequence of this design (§4) but not something this ADR commits to building now.

## 2. Decision

### 2.1 Extraction strategy: schema-constrained LLM extraction

Adopt LLM-based extraction (RFC-003 §5.2/§9.4) as the primary strategy: a single LLM request,
constrained to a JSON Schema response format (OpenRouter/OpenAI-style structured output,
`strict: true`), that returns the entire `ExtractedCsp` object in one response — not an agentic
tool-calling loop that incrementally constructs it via separate `addEntity`/`addDomain`/
`addConstraint`-style calls, and not free-form prompting either. (An earlier draft of this section
described this as "tool/structured-output mode," which read ambiguously as if tool-calling were
in play — it isn't; see §2.3 for why, and for why that's a starting-point scoping choice, not a
permanent rejection of agentic techniques generally.) Rule-based, JS-native-NLP, and small-model
tiers are not adopted as the primary strategy (§3) — GLiNER2 (9.3) remains the leading candidate
for a future local-first tier (§4), not rejected outright.

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
constraint taxonomy while deferring the `ExtractedCsp` → `.mzn` compiler to
[ADR-005](ADR-005-extractedcsp-mzn-compiler.md) — expected to grow as new constraint shapes are
encountered, the same way ADR-003 names itself "deliberately incomplete by design."

Shapes G (an ASCII-art arithmetic diagram) and K's raw markdown table (SPIKE-001) are not
addressed by this schema directly — per SPIKE-004, the LLM tier parses them directly into the
schema fields above (e.g. a table row's columns become `assignment` facts) without needing a
dedicated pre-parser, unlike every other tier.

### 2.3 Workflow architecture: pure Effect, single-shot LLM calls — an MVP scoping choice

The extraction workflow — extract, critique, revise, escalate — is implemented as a composed
`Effect` pipeline, with each individual LLM call (extraction, critique) a single-shot,
schema-constrained request, not a multi-step agent with tool access, and not built on an agentic
framework (Mastra, Vercel AI SDK) or `@effect/ai`.

**This is a starting-point scoping choice for this MVP, not a general position that agentic
techniques don't belong in this project.** "Hard-code a fixed workflow" and "let one monolithic
agent do everything" are not the only two options — established agentic-workflow patterns mix
techniques (tool-using subagents inside an otherwise-authored pipeline, multi-agent critique
panels, retrieval-augmented prompting, and more), and nothing here forecloses adopting one of
those later (§4). For now, three reasons converge on the simpler shape:

1. The workflow's control flow (§2.4/§2.5) is authored upfront by this ADR, not decided
   dynamically by an LLM at runtime, for *this* design — a workflow-orchestration problem, which
   `Effect` already solves generally (typed errors, retries, concurrent fan-out) without needing
   an agentic framework's help to implement the specific loop this ADR specifies.
2. `@effect/ai` (and every `@effect/ai-*` provider package) peer-depends on `effect@^3.22.x`,
   incompatible with this repo's `effect` 4.x pin regardless of which 4.x prerelease is in use —
   confirmed by [SPIKE-004](../spikes/SPIKE-004-llm-based-extraction/SPIKE.md) and generalized in
   `CLAUDE.md`'s dependency notes into a standing pattern to check for any `@effect/*` package.
   This is the main reason richer, `Effect`-idiomatic agentic composition isn't adopted now —
   not a judgment that it wouldn't be useful (§4).
3. A full agentic framework would still need hand-wrapping to reach `@openrouter/sdk` the way
   this project already hand-wraps external capabilities (`src/solver/solve.ts`'s treatment of
   `node:child_process`) — trading "wrap a thin client" for "wrap a bigger, more opinionated
   surface," without eliminating the wrapping work, for whatever benefit that framework would add
   today.

Concretely: `@openrouter/sdk` (zero peer dependencies, a thin API client — confirmed by
SPIKE-004) is hand-wrapped in `Effect.tryPromise`, the same pattern `src/solver/solve.ts` already
uses for `node:child_process` since `@effect/platform`'s `Command` module has the same
incompatibility. Retries/timeouts use `Effect`'s own `Schedule`/`Effect.retry`/`Effect.timeout`;
provider and critic failures are modeled as tagged errors (§2.6), not thrown exceptions.

### 2.4 Critic loop: LLM fidelity critique as the hard gate

Resolves Open Question 7.3 by rejecting round-trip solver validation as the mechanism (Context)
and adopting a **fidelity critic** instead: a second, schema-constrained LLM call given both the
original prose and a candidate `ExtractedCsp`, judging whether the extraction is an isomorphic,
faithful translation — every clue represented, nothing invented, nothing misinterpreted. This
directly operationalizes RFC-003 Goal 4 ("make wrong or partial extractions detectable... rather
than guessing silently").

Illustrative critic output shape (taxonomy is the decision — accept/reject plus actionable
feedback on reject — exact fields are implementation's call, same convention as 2.2/2.6):

```ts
interface FidelityCritique {
  readonly accepted: boolean
  readonly issues: readonly string[]
}
```

For each extraction attempt, within a model tier (§2.5):

1. Extract `ExtractedCsp` from the prose.
2. Critique: the critic model receives the original prose and the candidate `ExtractedCsp`,
   returns a `FidelityCritique`.
3. If `accepted`, done — return the `ExtractedCsp`.
4. If not, **revise**: re-prompt the *same* model tier with the original prose, the previous
   `ExtractedCsp`, and the critique's `issues` — informed revision, not a blind retry. This is
   the mechanism SPIKE-004's evidence does *not* rule out (§3): SPIKE-004 showed re-prompting an
   identical model with *identical* input doesn't help, but never tested re-prompting with new
   information (the critique).
5. Repeat steps 2-4 up to **2 revision rounds per tier** (3 total attempts per tier: 1 initial +
   2 informed revisions) — a concrete starting bound, not an empirically-tuned one (§4).

If a tier's revision rounds are exhausted without an `accepted` critique, escalate to the next
model tier (§2.5) and repeat the same extract-critique-revise process there. If the top tier's
rounds are also exhausted, the extraction is rejected and flagged (a typed `CriticRejected`
error, §2.6, carrying every attempt's `ExtractedCsp` and critique) for manual review — never
silently accepted, per RFC-003 Goal 4.

The critic runs on the *same* model tier as the extractor for a given attempt, not a separately
chosen "judge" model (§3) — escalating to a materially different tier on repeated rejection is
this design's mechanism for getting a second, less-correlated opinion, rather than paying for
tier diversity on every single attempt.

Resolves Open Question 7.2 (acceptable failure mode): **informed revision, then escalate**,
carrying the critique forward as the "something else" 7.2 asked about — neither blind
self-correction nor an immediate reject-only policy.

### 2.5 Model routing: cheap-first, escalate on critic rejection

Resolves the cost-control goal from the RFC-003 discussion that led to this ADR. Extraction
attempts start on a cheap model tier (`google/gemini-2.5-flash-lite` per SPIKE-004's pricing);
exhausting that tier's revision rounds (§2.4) without an accepted critique triggers escalation to
a frontier tier (`anthropic/claude-sonnet-4.5`), which gets its own full extract-critique-revise
cycle. SPIKE-004 found both models performed similarly well on the tested sample, so escalation
is expected to be the exception path, keeping average cost low — a testable expectation once real
usage volume exists, not a guarantee (§4). Model identifiers are configuration reachable through
`@openrouter/sdk`'s single client, not hard-coded architecture — swapping either tier's specific
model doesn't require a design change. The two model identifiers above are this configuration's
defaults, overridable via the CLI flags/environment variables
[ADR-003](ADR-003-cli-interface.md) §2.6 decides (`--model`/`ZEBRA_MODEL` for this tier,
`--frontier-model`/`ZEBRA_FRONTIER_MODEL` for the other) — OpenRouter itself is an
implementation detail from a CLI user's perspective, not something this project's own interface
should require knowing about. No third escalation tier is decided here; that's future work if
two tiers prove insufficient.

### 2.6 Error model

Mirrors `src/solver/types.ts`'s tagged-error convention (same idiom), independent of
`SolverError` itself — this pipeline's errors are about extraction and critique, not solving,
which stays a separate, optional, downstream concern (§4) with its own existing error handling.
The decision is the three-category error taxonomy (provider failure, schema violation, critic
rejection) — the shape below illustrates it; exact field names and typing are implementation's
call, not fixed by this ADR:

```ts
class ProviderError extends Data.TaggedError("ProviderError")<{ readonly message: string }> {}
class SchemaViolation extends Data.TaggedError("SchemaViolation")<{ readonly raw: string }> {}
class CriticRejected extends Data.TaggedError("CriticRejected")<{
  readonly attempts: readonly { readonly model: string; readonly extractedCsp: ExtractedCsp; readonly critique: FidelityCritique }[]
}> {}

type ExtractionError = ProviderError | SchemaViolation | CriticRejected
```

`SchemaViolation` is a safety net, not an expected path — `strict: true` structured output should
prevent it, but the pipeline models it honestly rather than assuming it can't happen.
`CriticRejected` carries every attempt's model, `ExtractedCsp`, and `FidelityCritique` (not just
the last), so a rejected extraction is genuinely diagnosable for manual review, not a bare
failure.

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
- **Round-trip solver validation as the critic mechanism** (this ADR's own original design).
  Rejected (Context): solvability and translation fidelity are orthogonal. A faithful extraction
  of a genuinely unsatisfiable or under-constrained prose should legitimately fail to solve
  uniquely — gating trust on solve outcome would reject correct extractions of ill-posed prose,
  and could accept incorrect ones that happen to solve uniquely by coincidence. More
  fundamentally, the solver never sees the source prose, so it structurally cannot detect
  misinterpretation — only a critic with access to both can.
- **Blind same-model re-prompting on failure**, instead of informed revision. Rejected:
  SPIKE-004's failure mode was same-model, same-input, run-to-run divergence with no new
  information between attempts — re-prompting the identical model with identical input has no
  principled reason to behave differently. This is distinct from the adopted mechanism (2.4),
  which re-prompts with the critic's specific feedback — new information the blind case lacked,
  and something SPIKE-004 never actually tested.
- **A self-consistency/referential-integrity validation layer on `ExtractedCsp`** (checking that
  constraint-referenced values are members of their own declared domains). Rejected: this is
  linting, not extraction, and out of scope for an extraction function. The failure mode it would
  catch is already handled, for free, downstream: if `ExtractedCsp` is ever compiled
  ([ADR-005](ADR-005-extractedcsp-mzn-compiler.md)) and solved, MiniZinc's own type system
  rejects an out-of-domain value the same way it would for any hand-written `.mzn` with a type
  error, surfacing as the already-existing `ModelSyntaxError` (`src/solver/types.ts`). No new
  validation component is needed to duplicate that.
- **Self-consistency sampling** (N parallel extraction attempts on the same model, majority-vote)
  as a secondary critic signal. Superseded by the fidelity critic (2.4): a direct semantic
  judgment against the source prose catches more, and more specifically, than agreement-across-
  samples alone would.
- **A separately-chosen "judge" model for critique**, distinct from whichever tier extracted.
  Rejected for now (2.4): adds cost and complexity with no evidence yet that same-tier
  self-critique is insufficient — tier escalation already provides a materially different model's
  perspective when same-tier revision doesn't converge, without paying for cross-model critique
  on every attempt.
- **An agentic framework (Mastra, Vercel AI SDK), or a richer agentic pattern generally (tool-
  using subagents, multi-agent critique panels), for the workflow.** Deferred, not rejected
  outright (2.3): this ADR's workflow's control flow is authored upfront for its own specific
  loop, and either named framework would still need hand-wrapping to reach `@openrouter/sdk`
  today, trading one integration surface for a larger one — but the real blocker is `@effect/ai`'s
  incompatibility with this repo's `effect` 4.x pin, not a belief that agentic techniques are the
  wrong tool here. Revisit once that's resolved (§4).
- **`@effect/ai`.** Rejected (2.3): peer-depends on `effect@^3.22.x`, incompatible with this
  repo's `effect` 4.x pin regardless of prerelease (confirmed by SPIKE-004).
- **Always use the frontier model; skip cost-tiering.** Rejected (2.5): SPIKE-004 found the cheap
  model matched frontier quality on most tested shapes, with no evidenced accuracy justification
  for paying frontier price on every call.
- **Trust schema-constrained output directly; no critic loop.** Rejected outright: SPIKE-004's
  core finding directly refutes this — schema validity provably does not guarantee semantic
  correctness.

## 4. Consequences

- This ADR's single-shot, pure-`Effect`, no-agentic-framework shape (§2.3) is a starting point
  scoped to this MVP, not a permanent architectural stance. Richer agentic patterns — tool-using
  extraction subagents, multi-agent critique panels, retrieval-augmented few-shot prompting drawn
  from the validated-example corpus this section already motivates, or some mix of these — remain
  a live option this ADR deliberately doesn't foreclose. The concrete trigger to reassess is
  `@effect/ai` (or an equivalent `Effect`-idiomatic agent framework) landing support for `effect`
  4.x, removing the peer-dependency blocker (§2.3 point 2) that's the actual reason this ADR
  doesn't adopt one now — not evidence that the simpler shape is wrong, just that it's what's
  buildable today without hand-wrapping a framework this project doesn't otherwise need.
- Every extraction this pipeline accepts has been independently fidelity-checked by a second LLM
  call against the source prose — a meaningful second opinion, but not a formal guarantee the way
  solver validation would have been: the critic is itself an LLM and can share blind spots with
  the extractor, especially within the same model tier. Escalating to a materially different
  tier on repeated rejection (2.5) mitigates, but doesn't eliminate, that correlation risk.
- Unlike this ADR's original design, the critic loop (2.4) has **no dependency** on
  [ADR-005](ADR-005-extractedcsp-mzn-compiler.md)'s compiler — compiling and solving are not part
  of the trust gate, and the critic loop itself is independently implementable/testable without
  ADR-005 existing. Whether *other* consumers of this ADR's output (e.g.
  [ADR-003](ADR-003-cli-interface.md) §2.6's `extract` CLI, which compiles by default before
  printing) depend on ADR-005 is their own decision, made after trust is already established —
  not a dependency of the critic loop this ADR decides.
- Each extraction attempt now costs at least two LLM calls (extract + critique) rather than one,
  before any revision or escalation — a real cost increase over the originally-estimated
  per-attempt cost (RFC-003 Appendix §9.4), separate from the escalation-rate question below.
- Network dependency and per-call $ cost (RFC-003 Appendix §9.4) remain real runtime
  requirements. Open Question 7.4 (offline/CI testability) is **not** resolved by this ADR — a
  live test suite still needs network access or mocking/caching, neither designed here.
- Rejected extractions (escalation exhausted) need a defined manual-review/reporting surface —
  this ADR names the typed error (2.6) but doesn't design the human-facing workflow around it.
  The data available for that review is richer than a solver-based design would have produced:
  every attempt's actual `ExtractedCsp` and the critic's specific `issues`, not just a solve
  outcome.
- Every critic-*accepted* (prose, `ExtractedCsp`, critique) triple is a natural candidate to
  accumulate into a growing validated corpus — directly serving the local-first/distillation
  direction raised alongside this decision, and doubling as future CI fixtures (partially
  answering Open Question 7.4). This ADR does not commit to building that accumulation system;
  it's expected, motivated follow-up work, and whether it extends this ADR or becomes its own
  future RFC/ADR is an open scoping question, not decided here.
- The `ExtractedCsp` representation (2.2) is a new schema this project now owns, coordinated with
  both the MiniZinc compilation target ([ADR-002](ADR-002-adopt-minizinc-solver.md) §2.5,
  concretely realized by [ADR-005](ADR-005-extractedcsp-mzn-compiler.md)) and the
  still-undesigned graph-representation compiler (RFC-003 Non-Goal) — future ADRs touching either
  consumer need to respect this shape, not redesign it independently.
- Cheap-model-first (2.5) assumes escalation is the exception path based on SPIKE-004's small
  sample; real usage volume may reveal a higher escalation rate than expected, eroding the
  intended cost savings — worth monitoring once built, not assumed indefinitely.
- Whether feedback-informed same-tier revision (2.4) actually converges better than immediately
  escalating to a different tier is itself untested — SPIKE-004 only tested blind re-prompting
  (which doesn't help) and cold escalation (which does); informed revision is a new, reasonable
  mechanism adopted on reasoning, not evidence. The 2-round-per-tier bound (2.4) is a starting
  point; a follow-up spike measuring real convergence rates could inform whether it should change.
- This ADR does not decide CLI exposure — implemented separately in
  [ADR-003](ADR-003-cli-interface.md) §2.6.
- Open Question 7.6 is addressed at the representation level (`derivedRule`'s nested `then`,
  admitting derived variables and non-boolean outcomes) but not empirically re-validated against
  `PZL-0011` specifically by this ADR — worth confirming once implemented.

## 5. Related

- RFCs: RFC-003
- Specs: _(populated automatically by the speckit ADR-link hook once `/speckit-specify`
  references this ADR)_
