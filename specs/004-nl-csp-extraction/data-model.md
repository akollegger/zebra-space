# Data Model: Natural-Language Puzzle to Solvable CSP Extraction

Concrete shapes for spec.md's Key Entities (Puzzle, Extraction, Solvable Model, Validation
Outcome), consolidating ADR-004 §2.2/§2.4/§2.6 and ADR-005 §2.4/§2.5's refinements into the single
canonical form `src/extraction/types.ts` owns. Every ADR that introduced a shape explicitly left
exact field names/typing as "implementation's call" (only the taxonomy is the decision) — this is
that call, made once, not forked between an extraction-only and a compiler-only type module.

**Defined as `effect`'s own `Schema.Struct`/`Schema.Union` values, not plain TypeScript
interfaces** (research.md Finding 3) — one definition per shape yields the inferred TypeScript
type, the JSON Schema sent as the forced tool call's `parameters` (ADR-004 §2.1, via
`toProviderSchema`), and the runtime decoder that validates the response (via
`Schema.decodeUnknownEffect`) — all from the same source of truth, and `effect`-idiomatic
(Principle II) rather than a bolted-on validation library.

**Recursion is depth-bounded, not `Schema.suspend`-based** (ADR-004 §2.7, SPIKE-005). A suspended
schema necessarily emits `$defs`/`$ref`, which some providers silently mangle into bare strings
under tool calling. `src/extraction/types.ts` therefore builds the recursive shapes with
depth-parameterized constructors (`MAX_NESTING_DEPTH`, currently 2), producing a cycle-free schema
that inlines cleanly, and `assertProviderSafeSchema` fails loudly if a `$ref`, `$defs`, or nullable
nested object ever reaches the emitted payload. The TypeScript types stay fully recursive — only
the schema is bounded, which is the safe direction.

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

## `ExtractedConstraint` (ADR-004 §2.2, seven-kind taxonomy)

A `Schema.Union` of seven tagged `Schema.Struct`s, built by a depth-parameterized constructor so
the recursive `derivedRule` member is expanded inline rather than via `$ref` (ADR-004 §2.7):

```ts
const ExtractedConstraint = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("assignment"), entity: Schema.String, variable: Schema.String, value: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("linkedAttributes"),
    entityType: Schema.String,
    attributes: Schema.Array(Schema.Struct({ variable: Schema.String, value: Schema.String })),
  }),
  Schema.Struct({ kind: Schema.Literal("allDifferent"), variable: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("adjacency"), relation: Schema.String, a: Schema.String, b: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("relation"), name: Schema.String, a: Schema.String, b: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("derivedRule"),
    appliesTo: Schema.String,
    condition: DerivedCondition,
    thenConstraints: Schema.Array(makeExtractedConstraint(depth - 1))
  }),
  Schema.Struct({ kind: Schema.Literal("arithmetic"), expression: ArithmeticExpression, comparator: Schema.String, target: Schema.Union([Schema.String, Schema.Number]) })
])
```

Decodes to (illustrative):

```ts
type ExtractedConstraint =
  | { readonly kind: "assignment"; readonly entity: string; readonly variable: string; readonly value: string }
  | { readonly kind: "linkedAttributes"; readonly entityType: string; readonly attributes: readonly { readonly variable: string; readonly value: string }[] }
  | { readonly kind: "allDifferent"; readonly variable: string }
  | { readonly kind: "adjacency"; readonly relation: string; readonly a: string; readonly b: string }
  | { readonly kind: "relation"; readonly name: string; readonly a: string; readonly b: string }
  | { readonly kind: "derivedRule"; readonly appliesTo: string; readonly condition: DerivedCondition; readonly thenConstraints: readonly ExtractedConstraint[] }
  | { readonly kind: "arithmetic"; readonly expression: ArithmeticExpression; readonly comparator: string; readonly target: string | number }
```

`derivedRule.condition` and `arithmetic.expression` are typed here per ADR-005's refinement
(§2.4/§2.5) rather than ADR-004 §2.2's original free-text/loose placeholders — ADR-005 §4
explicitly names this as the first concrete refinement of `ExtractedCsp`, licensed by ADR-004 §2.2
itself, and states future work should treat it as current. There is deliberately no separate
"extraction-era" loose type kept alongside it. The recursive member is named `thenConstraints`
rather than ADR-004 §2.2's illustrative `then`: a bare `then` key makes the object a "thenable"
that `await` and dynamic `import()` can mistake for a promise, which Biome's `noThenProperty`
rightly flags.

**`linkedAttributes` was added after the original six-kind taxonomy shipped** (ADR-004 §2.2,
§4 Consequences) — running the pipeline against real catalog puzzles, not just SPIKE-004's small
structural sample, found that no kind could express "some entity of a type has several
attributes simultaneously" without that entity already being named, which is how most classic
zebra-style clues ("The Englishman lives in the red house") actually read. It compiles to a
solver-time existential (`forall(e in T)(pivot <-> rest)`), verified directly against a real
`minizinc` install — no entity resolution happens in `src/compiler`; the solver performs the
binding as a side effect of solving.

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

## `ArithmeticExpression` (ADR-005 §2.5, encoding per ADR-004 §2.7)

```ts
type ArithmeticExpression =
  | { readonly kind: "variableRef"; readonly variable: string }
  | { readonly kind: "literal"; readonly value: number }
  | {
      readonly kind: "binaryOp"
      readonly op: "+" | "-" | "min" | "max" | "abs"
      readonly operands: readonly ArithmeticExpression[]
    }
```

Built by a depth-parameterized constructor (`makeArithmeticExpression`), not `Schema.suspend`.

A structured sub-shape, not a raw string interpolated into generated MiniZinc source (ADR-005
§2.5/§3). **Operands are an array, not `left`/`right` with a nullable `right`.** An earlier
revision used `left`/`right: Schema.NullOr(...)`, and even made `left` nullable too, specifically
to satisfy Gemini; SPIKE-005 showed that was both insufficient (nullable *nested objects* are
degraded to bare strings independently of `$ref`) and unnecessary (an array edge is the encoding
that survives — ADR-004 §2.7). The array is also the more honest model: `abs` takes exactly one
operand and every other operator exactly two, with `src/compiler/compile.ts` raising a
`CompileError` on a wrong count rather than the schema silently permitting a missing operand.

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
failures, not LLM response shapes to decode. Four cases rather than three: SPIKE-005 showed that
"the provider refused our schema" and "the provider answered but not in our schema" have
completely different remedies, so they are separate errors rather than one `ProviderError`:

```ts
class ProviderError extends Data.TaggedError("ProviderError")<{
  readonly message: string
}> {}

/** The provider refused the *schema itself* — a provider-compatibility problem, not a transient
 *  one. Retrying cannot help; choosing another model can (ADR-004 §2.7, SPIKE-005). */
class SchemaRejected extends Data.TaggedError("SchemaRejected")<{
  readonly model: string
  readonly providerMessage: string
}> {}

/** The provider answered, but not in the schema. Covers both "called the tool with
 *  non-conforming arguments" and "ignored the forced tool call and replied in prose" — `detail`
 *  says which. Carried as a string rather than a `Schema.SchemaError` so the prose case doesn't
 *  need a fabricated decode error. */
class SchemaViolation extends Data.TaggedError("SchemaViolation")<{
  readonly model: string
  readonly raw: string
  readonly detail: string
}> {}

class CriticRejected extends Data.TaggedError("CriticRejected")<{
  readonly attempts: readonly ExtractionAttempt[]
}> {}

interface ExtractionAttempt {
  readonly model: string
  readonly extractedCsp: ExtractedCsp
  readonly critique: FidelityCritique
}

type ExtractionError = ProviderError | SchemaRejected | SchemaViolation | CriticRejected
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

Every error above is rendered to a CLI user by `src/cli/subcommands/extract.ts` as a message that
names the cause *and* what to do about it, wrapped in `UserFacingError` so no JS stack trace is
appended (spec.md SC-003 requires the reported message alone to suffice).
