# Data Model: Natural-Language Puzzle to Solvable CSP Extraction

Concrete shapes for spec.md's Key Entities (Puzzle, Extraction, Solvable Model, Validation
Outcome), consolidating ADR-004 §2.2/§2.4/§2.6 and ADR-005 §2.4/§2.5's refinements into the single
canonical form `src/extraction/types.ts` owns. Every ADR that introduced a shape explicitly left
exact field names/typing as "implementation's call" (only the taxonomy is the decision) — this is
that call, made once, not forked between an extraction-only and a compiler-only type module.

**Defined as `effect`'s own `Schema.Struct`/`Schema.Union` values, not plain TypeScript
interfaces** (research.md Finding 3) — one definition per shape yields the inferred TypeScript
type (`Schema.Schema.Type<typeof X>`), the JSON Schema sent to OpenRouter's structured-output
`responseFormat` (via `Schema.toJsonSchemaDocument`), and the runtime decoder that validates the
LLM's response (via `Schema.decodeUnknownEffect`, surfacing a `ParseError` on mismatch) — all from
the same source of truth, and `effect`-idiomatic (Principle II) rather than a bolted-on
validation library. The illustrative `interface`/`type` blocks below show the shape each `Schema`
value decodes to; the actual declarations in `src/extraction/types.ts` are the `Schema` values
themselves.

## `ExtractedCsp` (ADR-004 §2.2)

The solver-agnostic intermediate representation an accepted extraction produces — spec.md's
"Solvable Model" entity, pre-compilation.

```ts
const Entity = Schema.Struct({
  id: Schema.String,
  type: Schema.String
})

const Domain = Schema.Struct({
  variable: Schema.String,
  entityType: Schema.String,
  values: Schema.Array(Schema.String)
})

const ExtractedCsp = Schema.Struct({
  entities: Schema.Array(Entity),
  domains: Schema.Array(Domain),
  constraints: Schema.Array(ExtractedConstraint)
})
```

Decodes to (illustrative):

```ts
interface ExtractedCsp {
  readonly entities: readonly Entity[]
  readonly domains: readonly Domain[]
  readonly constraints: readonly ExtractedConstraint[]
}
```

**Validation rules**: `domains[].entityType` and `constraints[].*` entity/variable references are
expected to correspond to declared `entities`/`domains` entries, but this module does not enforce
that as a referential-integrity check — ADR-004 §3 rejected a self-consistency/linting layer here
on purpose; a genuinely inconsistent reference surfaces downstream as MiniZinc's own
`ModelSyntaxError` (`src/solver/types.ts`) if and when the extraction is compiled and solved.

## `ExtractedConstraint` (ADR-004 §2.2, six-kind taxonomy)

A `Schema.Union` of six tagged `Schema.Struct`s, matching this taxonomy exactly (verified
directly, research.md Finding 3: unions of tagged structs and the `then` self-reference below
both produce correct JSON Schema — `anyOf` for the union, `$defs`/`$ref` for the recursion):

```ts
const ExtractedConstraint = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("assignment"), entity: Schema.String, variable: Schema.String, value: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("allDifferent"), variable: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("adjacency"), relation: Schema.String, a: Schema.String, b: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("relation"), name: Schema.String, a: Schema.String, b: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("derivedRule"),
    appliesTo: Schema.String,
    condition: DerivedCondition,
    then: Schema.Array(Schema.suspend((): typeof ExtractedConstraint => ExtractedConstraint))
  }),
  Schema.Struct({ kind: Schema.Literal("arithmetic"), expression: ArithmeticExpression, comparator: Schema.String, target: Schema.Union([Schema.String, Schema.Number]) })
])
```

Decodes to (illustrative):

```ts
type ExtractedConstraint =
  | { readonly kind: "assignment"; readonly entity: string; readonly variable: string; readonly value: string }
  | { readonly kind: "allDifferent"; readonly variable: string }
  | { readonly kind: "adjacency"; readonly relation: string; readonly a: string; readonly b: string }
  | { readonly kind: "relation"; readonly name: string; readonly a: string; readonly b: string }
  | { readonly kind: "derivedRule"; readonly appliesTo: string; readonly condition: DerivedCondition; readonly then: readonly ExtractedConstraint[] }
  | { readonly kind: "arithmetic"; readonly expression: ArithmeticExpression; readonly comparator: string; readonly target: string | number }
```

`derivedRule.condition` and `arithmetic.expression` are typed here per ADR-005's refinement
(§2.4/§2.5) rather than ADR-004 §2.2's original free-text/loose placeholders — ADR-005 §4
explicitly names this as the first concrete refinement of `ExtractedCsp`, licensed by ADR-004 §2.2
itself, and states future work should treat it as current. There is deliberately no separate
"extraction-era" loose type kept alongside it. The `then` field's `Schema.suspend` is required
because `ExtractedConstraint` refers to itself — a plain `Schema.Array(ExtractedConstraint)`
reference would throw at module-evaluation time before the `const` binding exists.

## `DerivedCondition` (ADR-005 §2.4)

Discriminates `derivedRule`'s two compilation modes structurally, not by string-inspecting prose:

```ts
const DerivedCondition = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("relation"), name: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("comparison"), variable: Schema.String, operator: Schema.String, value: Schema.Union([Schema.String, Schema.Number]) })
])
```

Decodes to (illustrative):

```ts
type DerivedCondition =
  | { readonly kind: "relation"; readonly name: string }
  | { readonly kind: "comparison"; readonly variable: string; readonly operator: string; readonly value: string | number }
```

`{ kind: "relation" }` → fact-driven expansion (compile-time, over paired `relation` fact data).
`{ kind: "comparison" }` → variable-conditioned reified implication (solver-time). An
unrecognized/ambiguous shape is a compiler-time error (ADR-005 §2.3/§2.4), never a best-effort
guess — this is enforced in `src/compiler/compile.ts`, not in this type itself, which only needs
to make the two modes representable.

## `ArithmeticExpression` (ADR-005 §2.5)

```ts
const ArithmeticExpression = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("variableRef"), variable: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("literal"), value: Schema.Number }),
  Schema.Struct({
    kind: Schema.Literal("binaryOp"),
    op: Schema.Literals(["+", "-", "min", "max", "abs"]),
    left: Schema.suspend((): typeof ArithmeticExpression => ArithmeticExpression),
    right: Schema.NullOr(Schema.suspend((): typeof ArithmeticExpression => ArithmeticExpression))
  })
])
```

Decodes to (illustrative):

```ts
type ArithmeticExpression =
  | { readonly kind: "variableRef"; readonly variable: string }
  | { readonly kind: "literal"; readonly value: number }
  | { readonly kind: "binaryOp"; readonly op: "+" | "-" | "min" | "max" | "abs"; readonly left: ArithmeticExpression; readonly right: ArithmeticExpression | null }
```

A structured sub-shape, not a raw string interpolated into generated MiniZinc source (ADR-005
§2.5/§3) — `abs` is unary (`right` is `null`), the rest binary. `right` is `Schema.NullOr`, not
`Schema.optional`, per research.md Finding 3's caveat: OpenAI-style strict structured output
requires every field to appear in `required`, expressing "not present" as `null` rather than
omitting the key — an `optional` field's default JSON Schema output doesn't satisfy that
constraint. This is the one place this ADR's original `right?` (optional) syntax doesn't carry
over unchanged into the `Schema` encoding; `src/compiler/compile.ts` treats `right: null` the same
way ADR-005 §2.5's `right` (absent) was always meant to be read for a unary `abs`.

## `FidelityCritique` (ADR-004 §2.4)

The critic's judgment of one `ExtractedCsp` attempt against the source prose — spec.md's
"Validation Outcome" entity.

```ts
const FidelityCritique = Schema.Struct({
  accepted: Schema.Boolean,
  issues: Schema.Array(Schema.String)
})
```

Decodes to (illustrative):

```ts
interface FidelityCritique {
  readonly accepted: boolean
  readonly issues: readonly string[]
}
```

`issues` is empty when `accepted` is `true`; non-empty and specific enough to drive the next
informed-revision attempt (ADR-004 §2.4 step 4) when `false`.

## Error taxonomy (ADR-004 §2.6)

Mirrors `src/solver/types.ts`'s tagged-error convention; independent of `SolverError`. These are
`Data.TaggedError` classes, not `Schema` values — they model *this pipeline's own* control-flow
failures, not LLM response shapes to decode, so `SchemaViolation` (below) is a thin wrapper around
the `ParseError` `Schema.decodeUnknownEffect` itself already produces (research.md Finding 3),
not a rebuild of what that decoder already reports:

```ts
class ProviderError extends Data.TaggedError("ProviderError")<{
  readonly message: string
}> {}

class SchemaViolation extends Data.TaggedError("SchemaViolation")<{
  readonly raw: string
  readonly parseError: ParseResult.ParseError
}> {}

class CriticRejected extends Data.TaggedError("CriticRejected")<{
  readonly attempts: readonly ExtractionAttempt[]
}> {}

interface ExtractionAttempt {
  readonly model: string
  readonly extractedCsp: ExtractedCsp
  readonly critique: FidelityCritique
}

type ExtractionError = ProviderError | SchemaViolation | CriticRejected
```

`CriticRejected.attempts` carries every attempt across both tiers and all revision rounds (ADR-004
§2.6) — the diagnosable record a rejected extraction needs for manual review, not just the last
attempt.

## Compiler error (ADR-005 §2.3/§2.4, surfaced only on the CLI's default/non-`--json` path)

```ts
class CompileError extends Data.TaggedError("CompileError")<{
  readonly reason: string
}> {}
```

Raised for an unrecognized `adjacency.relation` name (§2.3) or an unrecognized/ambiguous
`DerivedCondition` shape (§2.4) — fail-loud per RFC-003 Goal 4, never a silent best-effort guess.
`--json` output never reaches this error, since it bypasses compilation entirely (ADR-003 §2.6).

## Key entity cross-reference (spec.md)

| spec.md entity | Concrete type |
|---|---|
| Puzzle | A `catalog/puzzles/PZL-NNNN-*.md`-shaped file path, read as-is — no new type; passed straight through to `src/extraction/extract.ts` the same way `solve` passes file paths straight through (ADR-003 §2.2/§2.6). |
| Extraction | `ExtractedCsp`, plus (once accepted) the `model: string` tier that produced it — the pair returned by a successful `extract` Effect run. |
| Solvable Model | The compiled `.mzn` string `src/compiler/compile.ts` produces from an accepted `ExtractedCsp` (ADR-005 §2.1) — consumable by `src/solver/solve.ts`'s existing `SolveRequest.model`, unchanged. |
| Validation Outcome | `FidelityCritique`, and — on exhausted escalation — the full `CriticRejected` error's `attempts` list. |
