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

Extracting a computable CSP from a puzzle's prose clues admits at least five candidate strategies
(RFC-003 §5.2), evaluated empirically by four spikes (`design/spikes/`) rather than left as
guesses. The evidence converges cleanly enough to decide:

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

**Why not round-trip solver validation**: solvability and translation correctness are
orthogonal. A faithful extraction of a prose puzzle that is genuinely contradictory, as written,
*should* compile to `Unsatisfiable` —
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

### 2.1 Extraction strategy: schema-constrained LLM extraction via a forced tool call

Adopt LLM-based extraction (RFC-003 §5.2/§9.4) as the primary strategy: a **single** LLM request
that returns the entire `ExtractedCsp` in one response, structurally constrained by a JSON Schema.
That schema is delivered as a **forced function/tool call** — `tools` declaring exactly one
function whose `parameters` is the schema, plus `tool_choice` naming that function — and the
extraction is read from the resulting tool call's arguments. Not a `response_format`
structured-output request, and not free-form prompting.

**Tool calling here is a delivery mechanism, not an agentic loop**, and the difference is the
whole point: the model is forced to make exactly one call to one function, in one turn, and the
pipeline reads its arguments. It never chooses *whether* or *which* tool to call, never makes a
second call, and never incrementally constructs the CSP via separate
`addEntity`/`addDomain`/`addConstraint`-style calls. §2.3's "control flow is authored upfront"
property is fully preserved.

**Forced tool calling, not `response_format`, is the delivery mechanism.**
[SPIKE-005](../spikes/SPIKE-005-tool-calling-conventions/SPIKE.md) tested both mechanisms across
13 models x 8 schema shapes (208 probes against the live API) and found:

- `response_format` produced **3 hard rejections and 74/104 conforming results**; forced tool
  calling produced **zero rejections and 89/104**.
- Both of this ADR's own §2.5 default tiers failed under `response_format`, in two different ways:
  Gemini rejects a recursive-`$ref` schema outright (reproduced on all three Gemini models), and
  Anthropic returns HTTP 200 with conversational prose that ignores the schema entirely
  (reproduced on both Sonnet and Haiku). Under tool calling both Anthropic models score 8/8 — so
  this was a mechanism failure, not a model-capability one.
- Provider-declared capability metadata is not a usable substitute for testing: all 13 sampled
  models except one declare `structured_outputs`, including every model that then failed.

Rule-based, JS-native-NLP, and small-model tiers are not adopted as the primary strategy (§3) —
GLiNER2 (9.3) remains the leading candidate for a future local-first tier (§4), not rejected
outright.

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

The decision is the constraint taxonomy below (drawn from SPIKE-001's shapes, per the rationale
after the listing — originally six kinds, seven since `linkedAttributes` was added, nine since
`ruleTable`/`ruleTableConstraint` was) — not the exact TypeScript syntax. The shape below is
illustrative only — field names and precise typing are implementation's call:

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
  | { readonly kind: "linkedAttributes"; readonly entityType: string; readonly attributes: readonly { readonly variable: string; readonly value: string }[] }
  | { readonly kind: "allDifferent"; readonly variable: string }
  | { readonly kind: "adjacency"; readonly relation: string; readonly a: string; readonly b: string }
  | { readonly kind: "relation"; readonly name: string; readonly a: string; readonly b: string }
  | { readonly kind: "derivedRule"; readonly appliesTo: string; readonly condition: string; readonly then: readonly ExtractedConstraint[] }
  | { readonly kind: "arithmetic"; readonly expression: string; readonly comparator: string; readonly target: string | number }
  | { readonly kind: "ruleTable"; readonly name: string; readonly a: string; readonly b: string }
  | { readonly kind: "ruleTableConstraint"; readonly table: string; readonly a: RuleTableOperand; readonly b: RuleTableOperand }

// Either side of a ruleTableConstraint — a declared variable's value, or a known constant.
type RuleTableOperand =
  | { readonly kind: "variableRef"; readonly variable: string; readonly entity: string | null }
  | { readonly kind: "literal"; readonly value: string }
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

**`linkedAttributes` is a taxonomy addition: implementation testing exposed a gap in the original
six-kind taxonomy — the `assignment` kind's own motivating example doesn't actually fit
`assignment`'s shape.** [SPIKE-001](../spikes/SPIKE-001-catalog-clue-audit/SPIKE.md)'s shape A
("Attribute-assignment") is literally "The Englishman lives in the red house" — but that clue
never names *which* house. `assignment`'s `entity` field requires a known entity id, which this
clue doesn't supply; running the full pipeline against real catalog puzzles (not SPIKE-004's
small structural sample) surfaced this as an actual extraction failure, not a theoretical gap —
`arithmetic` and `derivedRule` have the same problem, since every kind that touches a domain
variable assumes a resolvable entity.

The fix is not entity resolution (recognizing which house "the green house" refers to across
clues) — that work turns out to be unnecessary, not just hard. `linkedAttributes` states that
*some* entity of `entityType` has every listed `variable = value` simultaneously, existentially
quantified, with no entity ever named — the solver performs the binding as a side effect of
solving, not extraction. Verified directly against a real `minizinc` install: for two
already-declared domain arrays that are each bijections over the same entity set (as `allDifferent`
domains are), `constraint forall(e in EntityType)(var1[e] = val1 <-> var2[e] = val2);` correctly
binds an unnamed shared entity and solves to the expected assignment. This is the general form
shape A actually needs; `assignment`'s entity-indexed form remains correct for clues that *do*
supply a resolvable entity (an ordinal — "the first house" — or a previously-bound one).
`linkedAttributes` does not address relational chaining ("the Chesterfields smoker lives next to
the fox owner," which binds two *different*, both-unnamed entities via `adjacency` rather than
direct co-occurrence) — a harder, related case this ADR does not resolve, left as a follow-up
(§4).

Shapes G (an ASCII-art arithmetic diagram) and K's raw markdown table (SPIKE-001) are not
addressed by this schema directly — per SPIKE-004, the LLM tier parses them directly into the
schema fields above (e.g. a table row's columns become `assignment` facts) without needing a
dedicated pre-parser, unlike every other tier.

**`ruleTable` is a second taxonomy addition, found the same way `linkedAttributes` was — running
the live pipeline (`eval/`'s harness, see `eval/README.md`) against a real catalog puzzle exposed
a shape the original seven-kind taxonomy had no home for.** PZL-0003 (Rock-Paper-Scissors) turns on
"paper beats rock, rock beats scissors, scissors beats paper" — a small, closed, static fact about
*values*, true regardless of which entity holds them. `relation` facts look superficially similar
but are about specific *entities* ("France shares a border with Spain"), consumed by
`derivedRule`'s fact-driven expansion (§2.4) over matching entity *pairs* — there is no existing
mechanism that expands per matching *value* pair instead. `ruleTable` fills this gap: one fact per
clue (`{name, a, b}`, structurally identical to `relation`'s shape but over domain values, not
entity ids), consumed by a paired `ruleTableConstraint` that requires two operands — each either a
declared variable's value or a known constant — to match some declared tuple. `ExtractedCsp`'s
taxonomy is now nine kinds, not seven; [ADR-005](ADR-005-extractedcsp-mzn-compiler.md) §2.3
documents how `ruleTableConstraint` compiles.

### 2.3 Workflow architecture: pure Effect, single-shot LLM calls — an MVP scoping choice

The extraction workflow — extract, critique, revise, escalate — is implemented as a composed
`Effect` pipeline, with each individual LLM call (extraction, critique) a single-shot,
schema-constrained request, not a multi-step agent that chooses its own control flow, and not
built on an agentic framework (Mastra, Vercel AI SDK) or `@effect/ai`.

(Note the wording care since §2.1's revision: "not agentic" here means the *model* never decides
what happens next — it does **not** mean "no tool calls." §2.1 now uses a forced single tool call
as its delivery mechanism precisely because that is the more reliably supported convention, while
leaving every control-flow decision in this pipeline's hands. "Uses tools" and "is an agent" are
independent properties, easy to conflate.)

Richer agentic patterns (tool-using subagents inside an otherwise-authored pipeline, multi-agent
critique panels, retrieval-augmented prompting) are deferred rather than rejected — see §3's "An
agentic framework..." entry for the reasoning, and §4 for revisiting once `@effect/ai`'s
peer-dependency conflict resolves.

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
attempts start on a cheap model tier (`openai/gpt-4o-mini`); exhausting that tier's revision
rounds (§2.4) without an accepted critique triggers escalation to a frontier tier
(`anthropic/claude-sonnet-4.5`), which gets its own full extract-critique-revise cycle. SPIKE-004
found both models performed similarly well on the tested sample, so escalation
is expected to be the exception path, keeping average cost low — a testable expectation once real
usage volume exists, not a guarantee (§4). Model identifiers are configuration reachable through
`@openrouter/sdk`'s single client, not hard-coded architecture — swapping either tier's specific
model doesn't require a design change. The two model identifiers above are this configuration's
defaults, overridable via the CLI flags/environment variables
[ADR-003](ADR-003-cli-interface.md) §2.6 decides (`--model`/`ZEBRA_MODEL` for this tier,
`--frontier-model`/`ZEBRA_FRONTIER_MODEL` for the other) — OpenRouter itself is an
implementation detail from a CLI user's perspective, not something the CLI's own interface
should require knowing about. No third escalation tier is decided here; that's future work if
two tiers prove insufficient.

**The default cheap tier was changed from `google/gemini-2.5-flash-lite`, on measured
reliability, not on [SPIKE-005](../spikes/SPIKE-005-tool-calling-conventions/SPIKE.md)'s own
sample.** SPIKE-005 found that *provider identity, not model size, dominates* structured-output
reliability (`openai/gpt-4o-mini` at $0.15/M scored 8/8 on both mechanisms tested;
`google/gemini-2.5-pro` at $1.25/M scored 5/8 on one) — but that was a schema-conformance sample,
not a decision to switch tiers on its own. The switch itself came from a second, live measurement
specifically targeting the current default: 4 identical extraction requests each. Gemini
2.5 Flash Lite returned 2 timeouts, one 18.9s response, and one 1.1s response; `openai/gpt-4o-mini`
returned 4 successes at ~1.5s each. `openai/gpt-4o-mini` is now the default cheap tier.

The tier switch settles whether cheap-first tiering itself is viable: it is — a cheap tier
clearly works, just not the original choice of *which* one. Reliability under load is now part
of what "cheap tier" needs to mean, alongside price and extraction quality (SPIKE-004's original
criteria). Whether tiering should stay cross-vendor is a separate, still-open question (§4).

### 2.6 Error model

Mirrors `src/solver/types.ts`'s tagged-error convention (same idiom), independent of
`SolverError` itself — this pipeline's errors are about extraction and critique, not solving,
which stays a separate, optional, downstream concern (§4) with its own existing error handling.
The decision is the three-category error taxonomy (provider failure, schema violation, critic
rejection) — the shape below is illustrative only, field names and typing are implementation's
call:

```ts
class ProviderError extends Data.TaggedError("ProviderError")<{ readonly message: string }> {}
class SchemaViolation extends Data.TaggedError("SchemaViolation")<{ readonly raw: string }> {}
class CriticRejected extends Data.TaggedError("CriticRejected")<{
  readonly attempts: readonly { readonly model: string; readonly extractedCsp: ExtractedCsp; readonly critique: FidelityCritique }[]
}> {}

type ExtractionError = ProviderError | SchemaViolation | CriticRejected
```

`SchemaViolation` was originally described here as "a safety net, not an expected path," on the
assumption that a `strict: true` schema request essentially guarantees conformance.
[SPIKE-005](../spikes/SPIKE-005-tool-calling-conventions/SPIKE.md) shows that assumption was
wrong: even under §2.1's revised mechanism and §2.7's encoding, non-conforming responses arrived
with HTTP 200 in a meaningful minority of probes (15 of 104 under the old mechanism, 8 of 104
under the new one). **`SchemaViolation` is a live, expected path** — the pipeline was right to
model it, and it should be treated as a normal outcome to report clearly rather than an
assertion-style "can't happen." Retrying a `SchemaViolation` is not decided here; today it
propagates, which is honest but likely worth revisiting once real usage shows how often it fires.
`CriticRejected` carries every attempt's model, `ExtractedCsp`, and `FidelityCritique` (not just
the last), so a rejected extraction is genuinely diagnosable for manual review, not a bare
failure.

### 2.7 Provider-compatible schema encoding

The JSON Schema sent to the provider (§2.1) **must avoid `$ref`/`$defs` entirely and must not use
a nullable nested object** (`anyOf: [<object>, null]`). Recursive structures are encoded by
inlining to a bounded depth, with the recursive edge as a possibly-empty **array** rather than a
nullable reference — `[]` denotes "no children" where `null` otherwise would.

This is a decision, not an implementation note, because it constrains what §2.2's representation
may look like *on the wire* and because getting it wrong fails silently.
[SPIKE-005](../spikes/SPIKE-005-tool-calling-conventions/SPIKE.md) isolated two independent traps,
both Google-specific but neither detectable without testing:

- **`$ref`**: under `response_format` a *recursive* `$ref` is rejected outright (HTTP 400) while a
  non-recursive one is fine; under tool calling **any** `$ref` is silently rendered as a bare
  string (`{"a":"foo","b":"bar"}` where two objects were required). The failure mode is worse
  under the mechanism §2.1 adopts, which is why this section exists alongside it.
- **Nullable nested objects**: `anyOf: [<object>, null]` is likewise degraded to a string.
  Discriminated unions of *objects* are fine, so this is nullability specifically, not unions —
  meaning §2.2's `ExtractedConstraint` union is safe as such regardless of how many kinds it has.

The combined encoding (inlined, depth-bounded, array edges, no nullable objects) scored 12/13
across the sampled models under tool calling, including all three Google models that failed every
other recursive shape tested. Bounding the depth is acceptable rather than merely expedient:
`derivedRule`'s nested constraint list and `arithmetic`'s operand nesting are both shallow in the
catalog's actual puzzles (SPIKE-001), and a depth overflow is a loud failure (the extraction
simply won't validate), not a silent truncation.

Note what this does **not** constrain: `ExtractedCsp`'s own logical shape (§2.2) is unchanged.
This is purely about its encoding for transmission, and a future consumer that doesn't go through
an LLM provider is unaffected.

## 3. Alternatives Considered

- **Sentence chunking + entity resolution** (extract each clue independently, then stitch the
  per-clue facts into one `ExtractedCsp` by resolving which anonymous entity each fact refers
  to). Rejected: the "resolution" step this needs is exactly `linkedAttributes`'s existential
  semantics (§2.2) done by hand instead of left to the solver — chunking would have application
  code reimplement, as an ad hoc algorithm, what `forall`/`<->` already does declaratively and
  correctly. It also doesn't touch this ADR's other real gaps (missing arithmetic operators, a
  small adjacency registry) and introduces a harder unaddressed case of its own (§2.2's closing
  note on relational chaining, which needs binding *two* anonymous entities, not one). Chunking
  may still be worth its own investigation for a different reason — whether per-clue extraction
  accuracy meaningfully beats whole-puzzle accuracy on longer puzzles — but that's a claim about
  accuracy under load, not expressiveness, and doesn't follow from this ADR's representational
  gap.
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
- **`response_format` JSON-Schema structured output as the delivery mechanism** — this ADR's own
  original choice. Rejected on evidence (2.1):
  [SPIKE-005](../spikes/SPIKE-005-tool-calling-conventions/SPIKE.md) measured 3 hard rejections
  and 74/104 conforming results against forced tool calling's 0 and 89/104, and found it failing
  on *both* of this ADR's own default model tiers, in two different ways. Its worst property isn't
  the lower success rate but the failure *mode*: Anthropic returns HTTP 200 with prose that
  ignores the schema, so the mechanism can fail without any error to catch.
- **Emitting MiniZinc or gram text directly from the LLM, skipping a JSON schema entirely** —
  raised as a candidate response to the schema-compatibility failures. Rejected *as a fix for
  those failures* (2.1/2.7): SPIKE-005 showed the mechanism and the schema encoding were the
  problem and that both are fixable, so a text target would be discarding
  `ExtractedCsp`'s solver-agnostic value (2.2) to solve a problem that no longer needs solving
  that way. Emitting gram specifically remains genuinely interesting on its own merits — it would
  address the constitution's graph-representation principle — but that is undesigned work
  deserving its own RFC/ADR.
- **An agentic framework (Mastra, Vercel AI SDK), or a richer agentic pattern generally
  (multi-step tool-using subagents, multi-agent critique panels, retrieval-augmented prompting),
  for the workflow (2.3).** Deferred, not rejected outright — and distinct from §2.1's forced
  single tool call, which is a delivery mechanism rather than an agentic pattern. "Hard-code a
  fixed workflow" and "let one monolithic agent do everything" are not the only two options, and
  nothing here forecloses adopting a richer pattern later (§4); for now, three reasons converge on
  the simpler shape. First, the workflow's control flow (§2.4/§2.5) is authored upfront rather
  than decided dynamically by an LLM at runtime — a workflow-orchestration problem `Effect`
  already solves generally (typed errors, retries, concurrent fan-out) without needing an agentic
  framework's help to implement this specific loop. Second, `@effect/ai` (and every
  `@effect/ai-*` provider package) peer-depends on `effect@^3.22.x`, incompatible with this repo's
  `effect` 4.x pin regardless of prerelease (confirmed by SPIKE-004, generalized in `CLAUDE.md`'s
  dependency notes into a standing pattern to check for any `@effect/*` package) — this is the
  real blocker, not a judgment that agentic techniques are the wrong tool here. Third, either
  named framework would still need hand-wrapping to reach `@openrouter/sdk` the way
  `src/solver/solve.ts` already hand-wraps `node:child_process` — trading one integration surface
  for a larger one, for whatever benefit that framework would add today. Revisit once the
  `@effect/ai` peer-dependency conflict resolves (§4).
- **Always use the frontier model; skip cost-tiering.** Rejected (2.5): SPIKE-004 found the cheap
  model matched frontier quality on most tested shapes, with no evidenced accuracy justification
  for paying frontier price on every call.
- **Trust schema-constrained output directly; no critic loop.** Rejected outright: SPIKE-004's
  core finding directly refutes this — schema validity provably does not guarantee semantic
  correctness.

## 4. Consequences

- **`src/extraction/types.ts` needs a schema post-processing step it doesn't have.**
  `Schema.toJsonSchemaDocument` emits `$defs`/`$ref` by default for both unions and
  `Schema.suspend` recursion, which §2.7 now forbids on the wire. The `effect` `Schema` values
  stay the source of truth for the TypeScript type *and* the runtime decoder; only the emitted
  JSON Schema needs dereferencing/inlining before it is sent. This is real follow-up work, and it
  reduces (but does not eliminate) the appeal of a library owning the provider-compatibility layer
  — the alternative to writing that pass is adopting something that already has one.
- **`ArithmeticExpression`'s nullable `left` should be reverted and re-modelled.** It was added
  during implementation specifically to appease Gemini's ref-loop rejection; SPIKE-005 shows it is
  both insufficient (nullable nested objects fail on their own) and unnecessary (the array
  encoding solves it). An operand *array* — length 1 for the unary `abs`, 2 for binary operators —
  is both §2.7-compatible and a more honest model of the domain than "a second operand that is
  sometimes null." A pleasant outcome worth noting: the compatibility constraint pushed toward a
  better representation rather than away from one.
- **Provider capability declarations are not evidence.** Two failures (the recursive-`$ref`
  rejection, the silent `response_format` ignore) shipped before either was diagnosed by testing.
  The generalizable lesson — recorded here because it will recur — is that a mechanism which can
  fail with HTTP 200 (Anthropic ignoring `response_format`) is materially worse than one that
  fails loudly, independent of success rates.
- **`linkedAttributes` (§2.2) is a decided taxonomy addition, not yet implemented.** It hasn't
  reached `src/extraction/types.ts`, `src/compiler/compile.ts`, or the extraction prompt. Until it
  does, the pipeline cannot faithfully extract shape A's actual common form (co-occurring
  attributes with no named entity) — which is most of what a classic zebra puzzle's clue list is
  made of, not an edge case.
- **The gap `linkedAttributes` fixes was found by running real catalog puzzles through the live
  pipeline, not by the test suite.** `tests/extraction/*.test.ts` stubs the provider, so it
  validates the critic-loop *mechanism* — revision, escalation, error taxonomy — against
  whatever `ExtractedCsp` the stub is told to return; it cannot catch a representational gap in
  the taxonomy itself, since the stub never has to actually solve the extraction problem.
  `tests/extraction/live.test.ts` (SC-002, §2.5) checks aggregate accuracy against a 5-puzzle
  sample but wasn't run as part of finding this. Neither test tier is a substitute for
  occasionally running the real pipeline against a real puzzle end to end.
- **Relational chaining is resolved, not by a new constraint kind but by nesting `derivedRule`.**
  §2.2 named this gap directly: a clue like "the Chesterfields smoker lives next to the fox owner"
  needs two anonymous entities bound to each other, not one entity's attributes bound to each
  other via `linkedAttributes`. The resolution generalizes `derivedRule`'s existing per-entity
  reification instead of adding an eighth kind: nesting a second `derivedRule` inside the first
  one's `then` list, the outer condition picking out the first entity and the inner condition the
  second. [ADR-005](ADR-005-extractedcsp-mzn-compiler.md) §2.4 documents the compiled shape (a
  `forall` boolean expression, not top-level constraints, so it composes inside the outer
  implication) and the entity-placeholder convention (`$this`/`$outer`) this needed. Live-verified
  against a real `minizinc` install and confirmed via the eval harness before being called
  resolved, not assumed from the schema shape alone.
- **The static-value-rule-table gap is resolved — see `ruleTable`/`ruleTableConstraint` in §2.2.**
  Found and fixed the same way as relational chaining: running `eval/`'s harness against PZL-0003
  surfaced the gap, and the fix (a new taxonomy pair, not a generalization of an existing kind)
  is now live-verified — PZL-0003 solves to its recorded answer key end to end.
- This ADR's single-shot, pure-`Effect`, no-agentic-framework shape (§2.3) is a starting point
  scoped to this MVP, not a permanent architectural stance. Richer agentic patterns — tool-using
  extraction subagents, multi-agent critique panels, retrieval-augmented few-shot prompting drawn
  from the validated-example corpus this section already motivates, or some mix of these — remain
  a live option this ADR deliberately doesn't foreclose. The concrete trigger to reassess is
  `@effect/ai` (or an equivalent `Effect`-idiomatic agent framework) landing support for `effect`
  4.x, removing the peer-dependency blocker (§3) that's the actual reason a richer framework
  isn't adopted now: it's what's buildable today without hand-wrapping a framework nothing else
  here needs.
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
- The `ExtractedCsp` representation (§2.2) is a new schema, coordinated with
  both the MiniZinc compilation target ([ADR-002](ADR-002-adopt-minizinc-solver.md) §2.5,
  concretely realized by [ADR-005](ADR-005-extractedcsp-mzn-compiler.md)) and the
  still-undesigned graph-representation compiler (RFC-003 Non-Goal) — future ADRs touching either
  consumer need to respect this shape, not redesign it independently.
- Cheap-model-first (2.5) assumes escalation is the exception path based on SPIKE-004's small
  sample; real usage volume may reveal a higher escalation rate than expected, eroding the
  intended cost savings — worth monitoring once built, not assumed indefinitely.
- Escalating *across vendors* (2.5) is a deliberate choice: a same-vendor cheap→frontier pair
  (e.g. `openai/gpt-4o-mini` → an OpenAI frontier model) would eliminate the
  provider-compatibility surface paid for twice (§2.7, §2.5) — but it trades directly against
  §2.4's rationale for escalation, which wants a **materially different, less-correlated** model
  as the second opinion. `openai/gpt-4o-mini` → `anthropic/claude-sonnet-4.5` keeps that
  property. The tension is unresolved: nothing here forces same-vendor tiering, and nothing here
  rules it out later if the compatibility surface proves costlier than the correlation risk.
- Whether feedback-informed same-tier revision (2.4) actually converges better than immediately
  escalating to a different tier is itself untested — SPIKE-004 only tested blind re-prompting
  (which doesn't help) and cold escalation (which does); informed revision is a new, reasonable
  mechanism adopted on reasoning, not evidence. The 2-round-per-tier bound (2.4) is a starting
  point; a follow-up spike measuring real convergence rates could inform whether it should change.
- This ADR does not decide CLI exposure — implemented separately in
  [ADR-003](ADR-003-cli-interface.md) §2.6.
- Open Question 7.6 is addressed at the representation level (`derivedRule`'s nested `then`,
  admitting derived variables and non-boolean outcomes), and the more precise gap running the live
  pipeline against PZL-0011 actually found — a `derivedRule` conditioned on the **conjunction** of
  multiple prior conditions ("if not denied by rules 1-2, **and** the requested amount is within
  policy limits, Approved"), which nesting (used for relational chaining, above) doesn't
  substitute for — is now resolved by a new `"and"` `DerivedCondition` variant (ADR-005 §2.4),
  live-verified against a real `minizinc` install with PZL-0011's full three-rule cascade solving
  to its true answer. What Open Question 7.6 does **not** resolve, and this ADR doesn't claim to:
  PZL-0011's critic-rejection detail also showed the model getting facts wrong ("states scores are
  below 600, which contradicts the provided information") independent of any schema limitation —
  raw prose comprehension, not representation, and outside what a schema/compiler fix can address.

## 5. Related

- RFCs: RFC-003
- Specs: _(populated automatically by the speckit ADR-link hook once `/speckit-specify`
  references this ADR)_
