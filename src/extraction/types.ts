import { Data, Schema } from "effect"

// data-model.md / ADR-004 §2.2 / ADR-005 §2.4 & §2.5. Defined as effect Schema values, not plain
// TS interfaces — one definition yields the inferred type, the JSON Schema sent to the provider
// as a forced tool call's `parameters` (ADR-004 §2.1), and the runtime decoder.
//
// ADR-004 §2.7 constrains what that emitted schema may contain: no `$ref`/`$defs`, and no
// nullable nested objects. Recursion is therefore built *depth-bounded* here rather than via
// `Schema.suspend` — a suspended schema necessarily emits `$defs`/`$ref`, which SPIKE-005 found
// is silently mangled into bare strings by some providers under tool calling. Bounded
// construction produces a cycle-free schema that inlines cleanly. `assertProviderSafeSchema`
// (below) enforces the rule so a regression can't ship quietly.

/**
 * How deep `derivedRule.thenConstraints` / `arithmetic` operand nesting may go in the *emitted*
 * schema (ADR-004 §2.7). Inlining trades `$ref` compatibility for schema size, and size is not
 * free: this schema is ~16k characters at depth 2 and ~25k at depth 3.
 *
 * 2 is chosen because SPIKE-001 found the catalog's actual nesting is shallow, so it is
 * sufficient, and it is the smaller payload. That is the whole rationale.
 *
 * It is explicitly NOT chosen on latency grounds. An earlier version of this comment claimed a
 * latency signal (depth 2 fast, depth 3 slow/timing out); further observation refuted it —
 * `gemini-2.5-flash-lite` has since both answered a depth-2 request in ~770ms and timed out on
 * one entirely. The variance is the model/provider's, not the schema size's, and that
 * unreliability is tracked against ADR-004 §2.5's default-model choice rather than worked around
 * here.
 */
export const MAX_NESTING_DEPTH = 2

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

// The TypeScript types stay fully recursive — consumers (notably src/compiler) reason about
// arbitrarily nested values. Only the *schema* is depth-bounded, which is the safe direction:
// anything the schema admits satisfies the type. Exceeding the bound fails loudly at decode
// time rather than being silently truncated (ADR-004 §2.7).
export type ArithmeticExpression =
  | { readonly kind: "variableRef"; readonly variable: string; readonly entity: string | null }
  | { readonly kind: "literal"; readonly value: number }
  | {
      readonly kind: "binaryOp"
      readonly op: "+" | "-" | "*" | "/" | "min" | "max" | "abs"
      // An operand *array*, not `left`/`right` with a nullable `right`. Two reasons, and the
      // second is why the earlier shape had to go: arity is expressed honestly (1 operand for
      // the unary `abs`, 2 for `-`/`/`, 2 or more for the associative `+`/`*`/`min`/`max` —
      // validated by the compiler), and — per ADR-004 §2.7 — `anyOf: [<object>, null]` is one of
      // the two shapes providers silently degrade to a bare string. A possibly-empty array is
      // the encoding that survives.
      readonly operands: readonly ArithmeticExpression[]
    }

const ARITHMETIC_LEAVES = [
  Schema.Struct({
    kind: Schema.Literal("variableRef"),
    variable: Schema.String,
    entity: Schema.NullOr(Schema.String),
  }).annotate({
    description:
      "References a domain variable. `entity` is null when the domain is scalar " +
      "(non-entity-indexed), or the specific entity id when the domain is entity-indexed and " +
      "this expression needs one particular entity's value (e.g. this cell's or this item's " +
      "own value) — mirrors the `assignment` constraint's `entity` field.",
  }),
  Schema.Struct({ kind: Schema.Literal("literal"), value: Schema.Number }),
] as const

function makeArithmeticExpression(depth: number): Schema.Codec<ArithmeticExpression> {
  const members =
    depth <= 0
      ? [...ARITHMETIC_LEAVES]
      : [
          ...ARITHMETIC_LEAVES,
          Schema.Struct({
            kind: Schema.Literal("binaryOp"),
            op: Schema.Literals(["+", "-", "*", "/", "min", "max", "abs"]),
            operands: Schema.Array(makeArithmeticExpression(depth - 1)),
          }),
        ]
  return Schema.Union(members).annotate({
    description:
      "A structured arithmetic expression (variable reference, numeric literal, or an operation " +
      "over its operands) — never a raw string to interpolate into generated MiniZinc source. " +
      "`abs` takes exactly one operand; `-`/`/` take exactly two; `+`/`*`/`min`/`max` are " +
      "associative and take two or more (e.g. a sum of several weighted terms is one `+` node " +
      "with all the terms as operands, not a deeply nested binary tree).",
  }) as Schema.Codec<ArithmeticExpression>
}

export const ArithmeticExpression = makeArithmeticExpression(MAX_NESTING_DEPTH)

export type ExtractedConstraint =
  | { readonly kind: "assignment"; readonly entity: string; readonly variable: string; readonly value: string }
  | {
      readonly kind: "linkedAttributes"
      readonly entityType: string
      readonly attributes: readonly { readonly variable: string; readonly value: string }[]
    }
  | { readonly kind: "allDifferent"; readonly variable: string }
  | { readonly kind: "adjacency"; readonly relation: string; readonly a: string; readonly b: string }
  | { readonly kind: "relation"; readonly name: string; readonly a: string; readonly b: string }
  | {
      readonly kind: "derivedRule"
      readonly appliesTo: string
      readonly condition: DerivedCondition
      readonly thenConstraints: readonly ExtractedConstraint[]
    }
  | {
      readonly kind: "arithmetic"
      readonly expression: ArithmeticExpression
      readonly comparator: string
      readonly target: string | number | ArithmeticExpression
    }

function nonRecursiveConstraints() {
  return [
    Schema.Struct({
      kind: Schema.Literal("assignment"),
      entity: Schema.String,
      variable: Schema.String,
      value: Schema.String,
    }).annotate({ description: "A single entity's variable is fixed to a specific value." }),
    Schema.Struct({
      kind: Schema.Literal("linkedAttributes"),
      entityType: Schema.String,
      attributes: Schema.Array(
        Schema.Struct({ variable: Schema.String, value: Schema.String }),
      ),
    }).annotate({
      description:
        "Some entity of entityType has every listed variable=value simultaneously — no entity " +
        'is ever named; the solver determines which one. Use this for POSITIVE co-occurrence ' +
        'clues like "The Englishman lives in the red house" — never for exclusion/negation ' +
        '("X is not Y"), which is `arithmetic` with comparator "!=" instead — and instead of ' +
        '`assignment`, which requires a specific, already-known entity (e.g. an ordinal like ' +
        '"the first house", or a house ' +
        "identified by an earlier clue).",
    }),
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
        'An ordering/positional relation between two entities (e.g. "immediately right of", ' +
        '"next to") over an ordered/numeric domain.',
    }),
    Schema.Struct({
      kind: Schema.Literal("relation"),
      name: Schema.String,
      a: Schema.String,
      b: Schema.String,
    }).annotate({
      description:
        'A named fact between two entities (e.g. "shares a border with"), consumed by a paired ' +
        "derivedRule rather than producing a constraint by itself.",
    }),
    Schema.Struct({
      kind: Schema.Literal("arithmetic"),
      expression: ArithmeticExpression,
      comparator: Schema.String,
      target: Schema.Union([Schema.String, Schema.Number, ArithmeticExpression]),
    }).annotate({
      description:
        "A numeric or enum-valued comparison (e.g. equality, inequality, threshold) between an " +
        "expression and a target. `target` is usually a plain value (string/number), but may " +
        "itself be a structured expression when the clue compares two computed quantities " +
        '(e.g. "the sum of these three cells equals the sum of those three cells", or one ' +
        "entity's value against another's).",
    }),
  ]
}

function makeExtractedConstraint(depth: number): Schema.Codec<ExtractedConstraint> {
  const members =
    depth <= 0
      ? nonRecursiveConstraints()
      : [
          ...nonRecursiveConstraints(),
          Schema.Struct({
            kind: Schema.Literal("derivedRule"),
            appliesTo: Schema.String,
            condition: DerivedCondition,
            thenConstraints: Schema.Array(makeExtractedConstraint(depth - 1)),
          }).annotate({
            description:
              "A rule applied when its condition holds: either expanded at compile time over " +
              "`relation` facts, or compiled to a solver-time reified implication over domain " +
              "variables.",
          }),
        ]
  return Schema.Union(members) as Schema.Codec<ExtractedConstraint>
}

export const ExtractedConstraint = makeExtractedConstraint(MAX_NESTING_DEPTH)

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

// --- Provider-safe JSON Schema emission (ADR-004 §2.7) ---------------------------------------

/** Raised when a schema we were about to send violates ADR-004 §2.7's encoding rules. */
export class UnsafeSchemaError extends Error {
  // Declared explicitly rather than as a constructor parameter property — tsconfig's
  // `erasableSyntaxOnly` (which is what lets this repo run TS directly under node) forbids those.
  readonly violations: readonly string[]

  constructor(violations: readonly string[]) {
    super(
      `Refusing to send a JSON Schema that violates ADR-004 §2.7: ${violations.join("; ")}. ` +
        "Some providers silently mangle these shapes into bare strings rather than rejecting " +
        "them, so this is caught before the request rather than after.",
    )
    this.violations = violations
    this.name = "UnsafeSchemaError"
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Resolves any `$ref`/`$defs` a schema still contains. Safe to run to completion because the
 * schemas above are depth-bounded rather than `suspend`-recursive, so the reference graph is
 * acyclic — this would not terminate on a genuinely cyclic schema, which is precisely the shape
 * ADR-004 §2.7 forbids.
 */
function inlineRefs(node: unknown, defs: Record<string, unknown>): unknown {
  if (Array.isArray(node)) return node.map((item) => inlineRefs(item, defs))
  if (!isRecord(node)) return node

  const ref = node.$ref
  if (typeof ref === "string") {
    const name = ref.replace(/^#\/\$defs\//, "")
    const target = defs[name]
    if (target === undefined) throw new UnsafeSchemaError([`unresolvable $ref "${ref}"`])
    const { $ref: _dropped, ...siblings } = node
    return { ...(inlineRefs(target, defs) as Record<string, unknown>), ...inlineRefs(siblings, defs) as Record<string, unknown> }
  }

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === "$defs") continue
    out[key] = inlineRefs(value, defs)
  }
  return out
}

/** Collects ADR-004 §2.7 violations, described by JSON-pointer-ish path for actionable errors. */
function findViolations(node: unknown, path = "#"): string[] {
  if (Array.isArray(node)) return node.flatMap((item, i) => findViolations(item, `${path}/${i}`))
  if (!isRecord(node)) return []

  const found: string[] = []
  if (typeof node.$ref === "string") found.push(`$ref at ${path}`)
  if (node.$defs !== undefined) found.push(`$defs at ${path}`)

  // A nullable *object* — `anyOf: [{type:"object"...}, {type:"null"}]` — is the second shape
  // providers degrade to a string. A nullable scalar is fine, so check the union's members.
  if (Array.isArray(node.anyOf)) {
    const members = node.anyOf.filter(isRecord)
    const hasNull = members.some((m) => m.type === "null")
    const hasObject = members.some((m) => m.type === "object" || m.properties !== undefined)
    if (hasNull && hasObject) found.push(`nullable object (anyOf with null + object) at ${path}`)
  }

  for (const [key, value] of Object.entries(node)) {
    found.push(...findViolations(value, `${path}/${key}`))
  }
  return found
}

/** Throws `UnsafeSchemaError` if `schema` violates ADR-004 §2.7. Exported for direct testing. */
export function assertProviderSafeSchema(schema: unknown): void {
  const violations = findViolations(schema)
  if (violations.length > 0) throw new UnsafeSchemaError(violations)
}

/**
 * The JSON Schema payload for a forced tool call's `function.parameters` (ADR-004 §2.1),
 * dereferenced and then verified against §2.7's encoding rules.
 */
export function toProviderSchema(schema: Schema.Schema<unknown>): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(schema)
  const inlined = inlineRefs(document.schema, document.definitions) as Record<string, unknown>
  assertProviderSafeSchema(inlined)
  return inlined
}

export const extractedCspJsonSchema = toProviderSchema(ExtractedCsp)
export const fidelityCritiqueJsonSchema = toProviderSchema(FidelityCritique)

// ADR-004 §2.6 error taxonomy, mirroring src/solver/types.ts's tagged-error convention.
// Independent of SolverError — this pipeline's errors are about extraction and critique, not
// solving.

export class ProviderError extends Data.TaggedError("ProviderError")<{
  readonly message: string
}> {}

/**
 * The provider refused the request because of the *schema* we sent, rather than the prompt or
 * credentials. Distinct from ProviderError because the remedy is completely different — the user
 * can't fix it by retrying or checking their key, but they can by choosing another model
 * (ADR-004 §2.7 / SPIKE-005).
 */
export class SchemaRejected extends Data.TaggedError("SchemaRejected")<{
  readonly model: string
  readonly providerMessage: string
}> {}

/**
 * The provider returned successfully but its payload doesn't match the schema. Two distinct
 * causes share this error because the remedy is the same (retry, or use a different model):
 * the model called the tool with non-conforming arguments, or it ignored the forced tool call
 * and answered in prose. `detail` says which — carried as a formatted string rather than a
 * `Schema.SchemaError` so both causes are representable without a fake value for the one that
 * has no decode error to report.
 */
export class SchemaViolation extends Data.TaggedError("SchemaViolation")<{
  readonly model: string
  readonly raw: string
  readonly detail: string
}> {}

export interface ExtractionAttempt {
  readonly model: string
  readonly extractedCsp: ExtractedCsp
  readonly critique: FidelityCritique
}

export class CriticRejected extends Data.TaggedError("CriticRejected")<{
  readonly attempts: readonly ExtractionAttempt[]
}> {}

export type ExtractionError = ProviderError | SchemaRejected | SchemaViolation | CriticRejected
