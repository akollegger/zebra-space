// SPIKE-008 sub-question 4: generate one small, closed JSON Schema tool per constraint kind,
// with every `variable`/`entity`/`value` field a closed `enum` populated from stage 1's
// vocabulary (an ExtractedVocabulary — entities + domains, already reliable at 865 chars),
// and `relation`/`comparator` fields closed enums drawn from src/compiler/compile.ts's own
// registries — rather than the free-string fields the monolithic ExtractedCsp schema uses
// (src/extraction/types.ts). This is what turns "reject an invented value" from a downstream
// compile-time check into something impossible to emit in the first place.
//
// Plain hand-built JSON Schema, not effect Schema — a spike doesn't need Schema's decoder
// machinery, only the wire shape `requestStructuredCompletion` sends as a forced tool call's
// `parameters` (src/extraction/provider.ts).

import type { Entity, Domain } from "../../../../../src/extraction/types.ts"

export interface Vocabulary {
  readonly entities: readonly Entity[]
  readonly domains: readonly Domain[]
}

// The eight adjacency phrases src/compiler/compile.ts:481-490's ADJACENCY_TEMPLATES registers —
// duplicated here (that const isn't exported) rather than widening the real pipeline's exports
// for a spike. If compile.ts's registry grows, this list drifts; noted in SPIKE.md Notes.
export const ADJACENCY_RELATIONS = [
  "immediately right of",
  "directly right of",
  "immediately left of",
  "directly left of",
  "immediately before",
  "immediately after",
  "next to",
  "adjacent to",
] as const

// compile.ts interpolates `comparator` verbatim into generated MiniZinc source
// (`constraint ${expr} ${c.comparator} ${target};`) — these six are the only binary predicates
// MiniZinc's grammar accepts there.
export const ARITHMETIC_COMPARATORS = ["=", "!=", "<", "<=", ">", ">="] as const

const ARITHMETIC_OPS = ["+", "-", "*", "/", "min", "max", "abs"] as const

function entityIds(vocab: Vocabulary): readonly string[] {
  return vocab.entities.map((e) => e.id)
}

function variableNames(vocab: Vocabulary): readonly string[] {
  return vocab.domains.map((d) => d.variable)
}

function allDomainValues(vocab: Vocabulary): readonly string[] {
  return [...new Set(vocab.domains.flatMap((d) => d.values))]
}

/** enum() with a documented fallback: an empty enum array is invalid JSON Schema, and a
 * genuinely empty vocabulary slice (e.g. no scalar domains exist) should still produce a valid,
 * if unusable, schema rather than crash the generator. */
function enumOf(values: readonly string[]): { readonly type: "string"; readonly enum: readonly string[] } {
  return { type: "string", enum: values.length > 0 ? values : ["__no_values_declared__"] }
}

/**
 * A `variableRef` operand, enum-scoped to this vocabulary: `variable` is any declared domain
 * name, `entity` is either an enum of declared entity ids or `null` (mirrors
 * ArithmeticExpression's variableRef in src/extraction/types.ts:82-93, but closed rather than
 * a free string).
 */
function variableRefSchema(vocab: Vocabulary): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["variableRef"] },
      variable: enumOf(variableNames(vocab)),
      entity: { anyOf: [enumOf(entityIds(vocab)), { type: "null" }] },
    },
    required: ["kind", "variable", "entity"],
    additionalProperties: false,
  }
}

function literalNumberSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: { kind: { type: "string", enum: ["literal"] }, value: { type: "number" } },
    required: ["kind", "value"],
    additionalProperties: false,
  }
}

/** One level of arithmetic expression nesting (variableRef | literal | binaryOp-of-leaves) —
 * shallower than the monolith's depth-2 bound (types.ts:29), since a single per-clue call needs
 * far less structural headroom than a whole-puzzle document. Widen if this spike's sample
 * needs deeper nesting (logged in Notes if so). */
function arithmeticExpressionSchema(vocab: Vocabulary): Record<string, unknown> {
  const leaf = { anyOf: [variableRefSchema(vocab), literalNumberSchema()] }
  return {
    anyOf: [
      variableRefSchema(vocab),
      literalNumberSchema(),
      {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["binaryOp"] },
          op: { type: "string", enum: [...ARITHMETIC_OPS] },
          operands: { type: "array", items: leaf },
        },
        required: ["kind", "op", "operands"],
        additionalProperties: false,
      },
    ],
  }
}

/** Every generated tool's `parameters` document — one per constraint kind, built from the
 * fixed vocabulary. Kind names match src/extraction/types.ts's ExtractedConstraint union
 * exactly, so assembly produces a plain ExtractedCsp with no translation step. `derivedRule`'s
 * `thenConstraints` is deliberately restricted to the four kinds src/compiler/compile.ts's own
 * `compileThenConstraint` (compile.ts:899-914) already accepts inside a reified implication
 * (assignment/arithmetic/allDifferent/linkedAttributes) — tighter than the monolith's schema,
 * which admits all nine kinds there and relies on a runtime CompileError to reject the other
 * five. relation/ruleTable are declared here for completeness (a puzzle might need one) but are
 * emitted only when a clue is a bare fact, never a per-clue "constraint" in the constraining
 * sense — the harness still assembles them into the CSP the same way.
 */
export function generateClueTools(vocab: Vocabulary): Record<string, Record<string, unknown>> {
  const varRef = variableRefSchema(vocab)
  const expr = arithmeticExpressionSchema(vocab)
  const entityEnum = enumOf(entityIds(vocab))
  const variableEnum = enumOf(variableNames(vocab))
  const valueEnum = enumOf(allDomainValues(vocab))

  const assignment = {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["assignment"] },
      entity: entityEnum,
      variable: variableEnum,
      value: valueEnum,
    },
    required: ["kind", "entity", "variable", "value"],
    additionalProperties: false,
  }

  const linkedAttributes = {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["linkedAttributes"] },
      entityType: enumOf([...new Set(vocab.entities.map((e) => e.type))]),
      attributes: {
        type: "array",
        items: {
          type: "object",
          properties: { variable: variableEnum, value: valueEnum },
          required: ["variable", "value"],
          additionalProperties: false,
        },
      },
    },
    required: ["kind", "entityType", "attributes"],
    additionalProperties: false,
  }

  const allDifferent = {
    type: "object",
    properties: { kind: { type: "string", enum: ["allDifferent"] }, variable: variableEnum },
    required: ["kind", "variable"],
    additionalProperties: false,
  }

  const adjacency = {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["adjacency"] },
      relation: enumOf([...ADJACENCY_RELATIONS]),
      a: entityEnum,
      b: entityEnum,
      variable: { anyOf: [variableEnum, { type: "null" }] },
    },
    required: ["kind", "relation", "a", "b", "variable"],
    additionalProperties: false,
  }

  const relation = {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["relation"] },
      name: { type: "string", description: "A short, stable name for this named fact — reused across every clue asserting the same relation." },
      a: entityEnum,
      b: entityEnum,
    },
    required: ["kind", "name", "a", "b"],
    additionalProperties: false,
  }

  const arithmetic = {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["arithmetic"] },
      expression: expr,
      comparator: { type: "string", enum: [...ARITHMETIC_COMPARATORS] },
      target: { anyOf: [valueEnum, { type: "number" }, expr] },
    },
    required: ["kind", "expression", "comparator", "target"],
    additionalProperties: false,
  }

  const ruleTable = {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["ruleTable"] },
      name: { type: "string", description: "Shared name for every fact in this same static value-vs-value table." },
      a: valueEnum,
      b: valueEnum,
    },
    required: ["kind", "name", "a", "b"],
    additionalProperties: false,
  }

  const ruleTableOperand = { anyOf: [varRef, { type: "object", properties: { kind: { type: "string", enum: ["literal"] }, value: valueEnum }, required: ["kind", "value"], additionalProperties: false }] }

  const ruleTableConstraint = {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["ruleTableConstraint"] },
      table: { type: "string" },
      a: ruleTableOperand,
      b: ruleTableOperand,
    },
    required: ["kind", "table", "a", "b"],
    additionalProperties: false,
  }

  // Restricted "then" member — see the doc comment above for why only these four kinds.
  const thenMember = { anyOf: [assignment, arithmetic, allDifferent, linkedAttributes] }

  const comparisonCondition = {
    type: "object",
    properties: { kind: { type: "string", enum: ["comparison"] }, variable: variableEnum, operator: { type: "string", enum: [...ARITHMETIC_COMPARATORS] }, value: { anyOf: [valueEnum, { type: "number" }] } },
    required: ["kind", "variable", "operator", "value"],
    additionalProperties: false,
  }
  const expressionComparisonCondition = {
    type: "object",
    properties: { kind: { type: "string", enum: ["expressionComparison"] }, expression: expr, operator: { type: "string", enum: [...ARITHMETIC_COMPARATORS] }, value: { anyOf: [valueEnum, { type: "number" }] } },
    required: ["kind", "expression", "operator", "value"],
    additionalProperties: false,
  }
  const derivedCondition = {
    anyOf: [
      { type: "object", properties: { kind: { type: "string", enum: ["relation"] }, name: { type: "string" } }, required: ["kind", "name"], additionalProperties: false },
      comparisonCondition,
      expressionComparisonCondition,
      { type: "object", properties: { kind: { type: "string", enum: ["and"] }, conditions: { type: "array", items: { anyOf: [comparisonCondition, expressionComparisonCondition] } } }, required: ["kind", "conditions"], additionalProperties: false },
    ],
  }

  const derivedRule = {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["derivedRule"] },
      appliesTo: enumOf([...new Set(vocab.entities.map((e) => e.type))]),
      condition: derivedCondition,
      thenConstraints: { type: "array", items: thenMember },
    },
    required: ["kind", "appliesTo", "condition", "thenConstraints"],
    additionalProperties: false,
  }

  return { assignment, linkedAttributes, allDifferent, adjacency, relation, arithmetic, ruleTable, ruleTableConstraint, derivedRule }
}
