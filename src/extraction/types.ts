import { Data, Schema } from "effect"

// data-model.md / ADR-004 §2.2 / ADR-005 §2.4 & §2.5. Defined as effect Schema values, not plain
// TS interfaces — one definition yields the inferred type, the JSON Schema sent to OpenRouter's
// structured-output responseFormat, and the runtime decoder (research.md Finding 3).

export const Entity = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
})
export type Entity = Schema.Schema.Type<typeof Entity>

export const Domain = Schema.Struct({
  variable: Schema.String.annotate({
    description: "The decision-variable name this domain constrains, e.g. house-color.",
  }),
  entityType: Schema.String,
  values: Schema.Array(Schema.String),
}).annotate({
  description: "One decision-variable domain: the finite set of values an attribute can take.",
})
export type Domain = Schema.Schema.Type<typeof Domain>

export const DerivedCondition = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("relation"),
    name: Schema.String,
  }).annotate({
    description:
      "Fact-driven condition: true for entity pairs where the named `relation` constraint holds.",
  }),
  Schema.Struct({
    kind: Schema.Literal("comparison"),
    variable: Schema.String,
    operator: Schema.String,
    value: Schema.Union([Schema.String, Schema.Number]),
  }).annotate({
    description:
      "Variable-conditioned condition: compares an extracted domain variable against a value.",
  }),
])
export type DerivedCondition = Schema.Schema.Type<typeof DerivedCondition>

// Recursive schemas need their public type declared by hand first (not derived via
// `Schema.Schema.Type<typeof X>`), and the const annotated with that type explicitly — otherwise
// TS can't resolve `typeof X` while `X`'s own initializer is still being checked. This is the
// documented `Schema.suspend` pattern (effect's own Schema.d.ts `Tree` example), not a workaround.
export type ArithmeticExpression =
  | { readonly kind: "variableRef"; readonly variable: string }
  | { readonly kind: "literal"; readonly value: number }
  | {
      readonly kind: "binaryOp"
      readonly op: "+" | "-" | "min" | "max" | "abs"
      // Both null, not optional, and — for `left` — null despite always being populated in
      // valid data: OpenAI/OpenRouter strict structured output requires every field in
      // `required` — "absent" is expressed as null, not by omitting the key (research.md
      // Finding 3). `left` additionally *must* be nullable (not just `right`) for a structural
      // reason confirmed against the real Gemini backend, not just OpenAI's docs: a required,
      // non-nullable self-reference in a recursive schema is a "ref loop of required fields",
      // which Gemini's structured-output validator rejects outright ("ref loops are only
      // supported if they include optional or nullable property values, or a potentially-
      // zero-length array items") — `right`'s existing nullability doesn't cover `left`'s own,
      // separate recursive edge. `compile.ts` still fails loudly with a CompileError if `left`
      // is ever actually null, since that's not a valid `binaryOp` regardless of what the
      // schema must permit to satisfy this validator.
      readonly left: ArithmeticExpression | null
      readonly right: ArithmeticExpression | null
    }

export const ArithmeticExpression: Schema.Codec<ArithmeticExpression> = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("variableRef"), variable: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("literal"), value: Schema.Number }),
  Schema.Struct({
    kind: Schema.Literal("binaryOp"),
    op: Schema.Literals(["+", "-", "min", "max", "abs"]),
    left: Schema.NullOr(Schema.suspend((): Schema.Codec<ArithmeticExpression> => ArithmeticExpression)),
    right: Schema.NullOr(Schema.suspend((): Schema.Codec<ArithmeticExpression> => ArithmeticExpression)),
  }),
]).annotate({
  description:
    "A structured arithmetic expression (variable reference, numeric literal, or binary " +
    "operation) — never a raw string to interpolate into generated MiniZinc source.",
})

export type ExtractedConstraint =
  | { readonly kind: "assignment"; readonly entity: string; readonly variable: string; readonly value: string }
  | { readonly kind: "allDifferent"; readonly variable: string }
  | { readonly kind: "adjacency"; readonly relation: string; readonly a: string; readonly b: string }
  | { readonly kind: "relation"; readonly name: string; readonly a: string; readonly b: string }
  | {
      readonly kind: "derivedRule"
      readonly appliesTo: string
      readonly condition: DerivedCondition
      // Named `thenConstraints`, not `then` (ADR-004 §2.2's illustrative field name) — a bare
      // `then` key trips Biome's noThenProperty (thenable-duck-typing risk), and the ADR itself
      // says exact field names are implementation's call, not fixed by the decision.
      readonly thenConstraints: readonly ExtractedConstraint[]
    }
  | {
      readonly kind: "arithmetic"
      readonly expression: ArithmeticExpression
      readonly comparator: string
      readonly target: string | number
    }

export const ExtractedConstraint: Schema.Codec<ExtractedConstraint> = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("assignment"),
    entity: Schema.String,
    variable: Schema.String,
    value: Schema.String,
  }).annotate({ description: "A single entity's variable is fixed to a specific value." }),
  Schema.Struct({
    kind: Schema.Literal("allDifferent"),
    variable: Schema.String,
  }).annotate({ description: "Every entity's value for this variable must be distinct." }),
  Schema.Struct({
    kind: Schema.Literal("adjacency"),
    relation: Schema.String,
    a: Schema.String,
    b: Schema.String,
  }).annotate({
    description:
      "An ordering/positional relation between two entities (e.g. \"immediately right of\", " +
      "\"next to\") over an ordered/numeric domain.",
  }),
  Schema.Struct({
    kind: Schema.Literal("relation"),
    name: Schema.String,
    a: Schema.String,
    b: Schema.String,
  }).annotate({
    description:
      "A named fact between two entities (e.g. \"shares a border with\"), consumed by a " +
      "paired derivedRule rather than producing a constraint by itself.",
  }),
  Schema.Struct({
    kind: Schema.Literal("derivedRule"),
    appliesTo: Schema.String,
    condition: DerivedCondition,
    thenConstraints: Schema.Array(Schema.suspend((): Schema.Codec<ExtractedConstraint> => ExtractedConstraint)),
  }).annotate({
    description:
      "A rule applied when its condition holds: either expanded at compile time over " +
      "`relation` facts, or compiled to a solver-time reified implication over domain variables.",
  }),
  Schema.Struct({
    kind: Schema.Literal("arithmetic"),
    expression: ArithmeticExpression,
    comparator: Schema.String,
    target: Schema.Union([Schema.String, Schema.Number]),
  }).annotate({
    description:
      "A numeric or enum-valued comparison (e.g. equality, inequality, threshold) between an " +
      "expression and a target value.",
  }),
])

export const ExtractedCsp = Schema.Struct({
  entities: Schema.Array(Entity),
  domains: Schema.Array(Domain),
  constraints: Schema.Array(ExtractedConstraint),
}).annotate({
  description:
    "A solver-agnostic constraint satisfaction problem extracted from a natural-language " +
    "puzzle: its entities, each decision variable's domain, and the constraints among them.",
})
export type ExtractedCsp = Schema.Schema.Type<typeof ExtractedCsp>

export const FidelityCritique = Schema.Struct({
  accepted: Schema.Boolean,
  issues: Schema.Array(Schema.String),
}).annotate({
  description:
    "Whether a candidate ExtractedCsp is an isomorphic, faithful translation of the source " +
    "prose — every clue represented, nothing invented, nothing misinterpreted. `issues` lists " +
    "the specific mismatches found when `accepted` is false.",
})
export type FidelityCritique = Schema.Schema.Type<typeof FidelityCritique>

/**
 * The JSON Schema payload for OpenRouter's `responseFormat.jsonSchema.schema` (draft-2020-12,
 * with `$defs` inlined for recursive shapes like `derivedRule.then`) — research.md Finding 3.
 */
export function toResponseFormatSchema(schema: Schema.Schema<unknown>): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(schema)
  const result: Record<string, unknown> = { ...document.schema }
  if (Object.keys(document.definitions).length > 0) {
    result.$defs = document.definitions
  }
  return result
}

export const extractedCspJsonSchema = toResponseFormatSchema(ExtractedCsp)
export const fidelityCritiqueJsonSchema = toResponseFormatSchema(FidelityCritique)

// ADR-004 §2.6 error taxonomy, mirroring src/solver/types.ts's tagged-error convention.
// Independent of SolverError — this pipeline's errors are about extraction and critique, not
// solving.

export class ProviderError extends Data.TaggedError("ProviderError")<{
  readonly message: string
}> {}

export class SchemaViolation extends Data.TaggedError("SchemaViolation")<{
  readonly raw: string
  readonly schemaError: Schema.SchemaError
}> {}

export interface ExtractionAttempt {
  readonly model: string
  readonly extractedCsp: ExtractedCsp
  readonly critique: FidelityCritique
}

export class CriticRejected extends Data.TaggedError("CriticRejected")<{
  readonly attempts: readonly ExtractionAttempt[]
}> {}

export type ExtractionError = ProviderError | SchemaViolation | CriticRejected
