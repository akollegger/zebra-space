# Research: Natural-Language Puzzle to Solvable CSP Extraction

Two genuine unknowns remained after ADR-004/ADR-005/ADR-003 §2.6 — everything else those ADRs
already settled concretely enough to design against directly. Verified hands-on against this
repo's actual pinned `effect@4.0.0-rc.110` and the `@openrouter/sdk` client SPIKE-004 already
exercised, consistent with how prior specs in this repo did their own due diligence.

## Finding 1: the critic loop is a recursive state machine, not `Effect.retry`

`Effect.retry`/`Schedule` (confirmed present at this pin: `Effect.retry`, `Effect.timeout`,
`Schedule.recurs`, `Schedule.exponential` are all defined functions, checked directly against
`node_modules/effect`) are built for retrying the *same* effect on failure, optionally with
backoff — they don't thread evolving state between attempts. ADR-004 §2.4's revision step needs
exactly that: each attempt after the first carries the *previous* `ExtractedCsp` and the critic's
`issues` forward as new input, not a mechanical repeat of the first attempt.

**Decision**: the critic loop (extract → critique → accept/revise/escalate) is a hand-written
recursive `Effect.gen` function, parameterized by attempt count and revision history — not a
`Schedule`-driven retry. `Effect.retry`/`Schedule.exponential` remain the right tool one layer
down, for transient-failure retries on the raw `@openrouter/sdk` call itself (e.g. a rate-limit
or transient network error), independent of the critic's own accept/revise/escalate decisions.
`Effect.timeout` wraps each individual model call, per ADR-004 §2.3.

**Alternatives considered**: driving the whole loop with `Schedule.recurs(2)` and folding
revision state through a `Ref` — rejected as more indirection than a plain recursive function for
a bound (2 revisions/tier) this small and this ADR-004-specific; a `Ref`-based fold buys nothing
here that explicit recursion doesn't already give directly and more readably.

## Finding 2: this feature's tests need a mocking boundary — the repo's live-invocation testing
convention (used for MiniZinc) doesn't transfer

`tests/solver/solve.test.ts` invokes the real `minizinc` CLI directly — safe because it's a free,
local, deterministic toolchain dependency (no network, no cost, no secret). Extraction's
equivalent — a real call to `@openrouter/sdk` — is none of those things: it costs real money per
call, requires a live `OPENROUTER_API_KEY`, and (per SPIKE-004's own core finding) is not
deterministic between runs. Following the MiniZinc precedent as-is would make `pnpm test`/CI
either require a paid, secret-gated live dependency on every run, or be flaky by the exact
mechanism SPIKE-004 exists to document. This is RFC-003/ADR-004's already-named Open Question 7.4
(offline/CI testability), left unresolved at the ADR level — resolving it enough to write tests
is this plan's job.

**Decision**: two-tier test strategy, mirroring the "hard local prerequisite vs. optional live
check" split CLAUDE.md's Commands section already documents for MiniZinc, but skippable instead
of required, since network/cost shouldn't be a default CI cost:
- `tests/extraction/*.test.ts` (default, runs in every `pnpm test`/CI invocation): exercises the
  critic-loop control flow (accept/revise/escalate/reject, attempt-count bounds, error taxonomy)
  against a stubbed provider boundary — the same seam `@openrouter/sdk`'s isolation already
  creates (ADR-004 §2.3: it's hand-wrapped in `Effect.tryPromise`, a natural substitution point).
  Deterministic, free, no network.
- `tests/extraction/live.test.ts` (opt-in): a small number of real calls against the actual
  seed-catalog stratified sample SPIKE-004 already used, skipped automatically when
  `OPENROUTER_API_KEY` is absent from the environment rather than failing the suite — this is the
  one place this feature's own real accuracy (SC-002) gets checked against the real service, but
  it's explicitly not a hard gate every contributor must pay for.

**Alternatives considered**: recorded request/response fixtures (VCR-style replay). Rejected for
this iteration — worth revisiting once real usage produces a natural corpus to record from (the
validated-example corpus ADR-004 §4 already names as future work would be the natural source),
but building a fixture-recording harness now, before that corpus exists, is premature relative to
what this feature actually needs to ship.

## Finding 3: `effect`'s own `Schema`/`JsonSchema` modules replace what `@effect/ai` would have
given us — no new dependency needed for schema generation or validation

`@effect/ai` is ruled out (incompatible peer dependency on `effect@^3.22.x`, CLAUDE.md), but two
of the things it would have provided — generating the JSON Schema for a structured-output
request, and validating the model's response against it — turn out to already be available in
the pinned `effect@4.0.0-rc.110` itself, via its `Schema` and `JsonSchema` modules (both
confirmed present and exercised directly, not assumed from documentation):

- **JSON Schema generation**: `Schema.toJsonSchemaDocument(mySchema)` produces a
  `Document<"draft-2020-12">`; piping it through `JsonSchema.toDocumentDraft07(doc)` yields
  draft-07 if that's what a given provider expects. Verified directly against a `Schema.Struct`
  (flat object), a `Schema.Union` of tagged structs (the shape `ExtractedConstraint`'s six-kind
  taxonomy needs), and a **recursive** schema via `Schema.suspend` (the shape `derivedRule.then:
  ExtractedConstraint[]` needs, being self-referential) — the recursive case correctly emits
  `$defs`/`$ref` rather than infinitely inlining. Every case produced `additionalProperties:
  false` and all fields listed in `required` by default — exactly what OpenAI-style strict
  structured output requires. (The delivery *mechanism* changed later — ADR-004 §2.1 now sends
  the schema as a forced tool call's `parameters` rather than via `responseFormat` — but the
  generated schema is the same artifact either way.)
- **Response validation**: `Schema.decodeUnknownEffect(mySchema)` returns an `Effect` that
  succeeds with the decoded, typed value or fails with a `ParseError` — directly realizing
  ADR-004 §2.6's `SchemaViolation` case as an actual typed Effect failure, not a hand-rolled
  `JSON.parse` + manual field-by-field check.

**Decision**: define `ExtractedCsp`/`ExtractedConstraint`/`DerivedCondition`/
`ArithmeticExpression`/`FidelityCritique` (data-model.md) as `Schema.Struct`/`Schema.Union`
values in `src/extraction/types.ts`, once, rather than as plain TypeScript interfaces with a
separate hand-written JSON Schema and a separate hand-written validator. One definition yields
the inferred TypeScript type, the JSON Schema sent to OpenRouter, and the runtime decoder — and
it's `effect`-idiomatic (Principle II) by construction, not a bolted-on validation library.

**These caveats were later resolved — badly at first — and are worth reading with the outcome
attached.** The pass above verified schema *generation* in isolation, never round-tripping through
a real provider call. That gap mattered: [SPIKE-005](../../design/spikes/SPIKE-005-tool-calling-conventions/SPIKE.md)
later found that `Schema.toJsonSchemaDocument`'s `$defs`/`$ref` output — perfectly valid JSON
Schema — is *rejected outright* by Gemini and *silently mangled into bare strings* by several
providers under tool calling. The remedy is in ADR-004 §2.7 and is now implemented: recursion is
built depth-bounded (no `Schema.suspend`), any residual `$ref` is inlined, and
`assertProviderSafeSchema` refuses to send a violating payload.

The specific note about `ArithmeticExpression.right` needing `Schema.NullOr` was also wrong in the
end. Nullable *nested objects* turn out to be the second shape providers degrade to a string, so
`NullOr` was itself part of the problem; the shipped encoding uses an operand **array** instead.
Recorded rather than deleted because the mistake is instructive: "valid JSON Schema" and
"a schema this provider will honor" are different properties, and only the second one can be
established by testing against the provider.

**Alternatives considered**: `zod` + `zod-to-json-schema`. Rejected: would be a second schema/
validation library alongside `effect`'s own, when `effect`'s already covers the same need and is
already a pinned dependency — no evidenced gap `zod` fills that justifies the duplication.

## Finding 4: `Schema.annotate` descriptions ride along into the generated JSON Schema — a place
to document the constraint taxonomy without growing the system prompt

Verified directly: calling `.annotate({ description: "..." })` on a `Schema.Struct` or one of its
fields propagates that text into the corresponding `description` key of the JSON Schema
`Schema.toJsonSchemaDocument` produces (e.g. annotating `Domain`'s `variable` field surfaces
`"description": "..."` on that exact property in the emitted schema). Since this `description`
travels inside the schema payload sent to the model — today as a forced tool call's
`function.parameters` (ADR-004 §2.1) — it's a legitimate, low-effort place to explain
taxonomy-specific meaning the field/kind names alone don't carry — e.g. what a `derivedRule`
represents, or what shape an `adjacency.relation` name should take — without needing a longer
hand-written system prompt to carry that same explanation. Actual prompt content (system/user
prompt wording, whether few-shot examples are included, the revision prompt's exact template) is
still undecided — correctly left as implementation-level work (`tasks.md`), not something this
research or ADR-004 commits to, but this finding narrows how much of that work needs to live in
prompt text versus the schema itself.

## Confirmed from SPIKE-004 (not re-verified, cited directly)

- `@openrouter/sdk`'s `chat.send()` requires its arguments nested under a `chatRequest` key
  (`chat.send({ chatRequest: { model, messages, ... } })`) — the package's own README example is
  flat and wrong for the installed version. A real, easy-to-repeat mistake worth flagging again
  here for whoever writes `src/extraction/extract.ts`.
- SPIKE-004 used `responseFormat: { type: "json_schema", jsonSchema: { name, schema, strict: true } }`.
  **This is no longer the mechanism** — ADR-004 §2.1 was revised to a forced tool call after
  SPIKE-005 measured `responseFormat` as unreliable across providers (Anthropic accepts the
  request and ignores the schema entirely). The shipped call sends
  `tools: [{ type: "function", function: { name, parameters } }]` with
  `toolChoice: { type: "function", function: { name } }`, and reads the result from
  `choices[0].message.toolCalls[0].function.arguments`. Note the SDK's camelCase (`toolChoice`,
  `toolCalls`) versus the wire format's snake_case.
- `@openrouter/sdk` has zero peer dependencies — confirmed safe to add as a real root
  `package.json` dependency now (SPIKE-004 verified it in an isolated sub-package; this feature
  is what promotes it to the actual dependency tree).
