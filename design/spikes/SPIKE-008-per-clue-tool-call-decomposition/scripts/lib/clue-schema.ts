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

// --- Entity-scoping fix (SPIKE-008 §6 Conclusion's recommended next step, 2026-09-15) --------
//
// The billed comparison run found this generator's biggest structural weakness wasn't
// out-of-vocabulary values (proven foreclosed by the zero-cost smoke test) but IN-vocabulary
// CROSS-DOMAIN confusion: a single global `entityEnum`/`valueEnum` let a model pair one
// domain's `variable` with a DIFFERENT domain's `entity`/`value` — e.g. `{variable: "house",
// entity: "animal_cat"}`, which src/compiler/compile.ts's real solver-time check
// (renderVariableRef, compile.ts:263-278) rejects only at solve time, not at schema-decode
// time. The fix mirrors compile.ts's own `isScalar` rule exactly (compile.ts:183: `isScalar:
// entityIds.length <= 1` — a domain with 0 or 1 matching entities needs no entity reference at
// all; 2+ requires one, scoped to THAT domain's own entityType): generate one schema
// ALTERNATIVE per domain (`variable` fixed to a literal, `entity`/`value` scoped to that one
// domain), rather than one flat schema with independent global enums — the same "closed union
// of concrete shapes, no free-floating cross-references" principle SPIKE-005 already found
// works reliably under tool calling.

/** This domain's own entities (by its declared `entityType`) — mirrors compile.ts's own
 * `isScalar` computation (entityIds.length <= 1) so schema-time scoping matches solve-time
 * expectations exactly. */
function entitiesOfDomain(vocab: Vocabulary, domain: Domain): readonly string[] {
  return vocab.entities.filter((e) => e.type === domain.entityType).map((e) => e.id)
}

/** The `entity` field's schema for ONE specific domain: `null`-only when compile.ts would
 * treat it as scalar (renderVariableRef returns the bare variable name and never reads
 * `entity` at all in that case — compile.ts:273), otherwise an enum of exactly that domain's
 * own entities (never any other domain's). */
function entityFieldForDomain(vocab: Vocabulary, domain: Domain): Record<string, unknown> {
  const entities = entitiesOfDomain(vocab, domain)
  return entities.length <= 1 ? { type: "null" } : enumOf(entities)
}

/**
 * A `variableRef` operand, now scoped PER DOMAIN via one `anyOf` alternative per declared
 * domain — `variable` fixed to that domain's own name (a single-value enum, not a shared free
 * choice), `entity` scoped to that domain's own entities via `entityFieldForDomain` (mirrors
 * ArithmeticExpression's variableRef in src/extraction/types.ts:82-93, but closed rather than
 * a free string, and — as of this fix — closed PER DOMAIN rather than globally).
 */
function variableRefSchema(vocab: Vocabulary): Record<string, unknown> {
  if (vocab.domains.length === 0) {
    // No domains declared at all — degrade to the pre-fix global shape rather than emit an
    // empty anyOf (invalid JSON Schema with no alternatives to match).
    return {
      type: "object",
      properties: { kind: { type: "string", enum: ["variableRef"] }, variable: { type: "string" }, entity: { anyOf: [{ type: "string" }, { type: "null" }] } },
      required: ["kind", "variable", "entity"],
      additionalProperties: false,
    }
  }
  return {
    anyOf: vocab.domains.map((domain) => ({
      type: "object",
      properties: {
        kind: { type: "string", enum: ["variableRef"] },
        variable: { type: "string", enum: [domain.variable] },
        entity: entityFieldForDomain(vocab, domain),
      },
      required: ["kind", "variable", "entity"],
      additionalProperties: false,
    })),
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

  // assignment: same per-domain scoping as variableRefSchema, and for the same reason — entity
  // and value must both belong to the SAME domain as `variable`, not any domain's global union.
  // Unlike variableRef, assignment fixes a SPECIFIC entity's value (compile.ts:391), so a
  // scalar (<=1 entity) domain still needs an entity id when one exists (there's exactly one to
  // name) — entityFieldForDomain's null-for-scalar rule is about variableRef's *reference*
  // semantics, not assignment's *fixing* semantics, so assignment computes its own entity field
  // per domain instead of reusing that helper.
  //
  // Cannot be expressed as ONE tool with a top-level `anyOf` of per-domain alternatives: live
  // 2026-09-15, OpenAI's real function-calling validator rejects a top-level `anyOf` outright
  // ("schema must have type 'object' and not have 'oneOf'/'anyOf'/'allOf'/'enum'/'const'/'not'
  // at the top level") even with a sibling `type: "object"` — this restriction is specific to
  // the TOP-LEVEL tool-parameters document; nested anyOf (e.g. `arithmetic.expression`'s
  // ArithmeticExpression union, a property VALUE rather than the schema root) is unaffected and
  // already working. So each domain gets its OWN flat top-level tool
  // (`assignment__<variable>`) instead of one `assignment` tool with an internal union — the
  // emitted payload's `kind` field stays the literal `"assignment"` regardless, so assembly
  // (per-clue-extract.ts) needs no awareness of the split; only the outer tool NAME differs.
  const assignmentAlternatives: Record<string, unknown>[] =
    vocab.domains.length === 0
      ? [{ type: "object", properties: { kind: { type: "string", enum: ["assignment"] }, entity: { type: "string" }, variable: { type: "string" }, value: { type: "string" } }, required: ["kind", "entity", "variable", "value"], additionalProperties: false }]
      : vocab.domains.map((domain) => {
          const entities = entitiesOfDomain(vocab, domain)
          return {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["assignment"] },
              entity: entities.length > 0 ? enumOf(entities) : { type: "string", description: "No entity of this domain's type was declared in stage 1 — name one directly if the clue implies it." },
              variable: { type: "string", enum: [domain.variable] },
              value: enumOf(domain.values),
            },
            required: ["kind", "entity", "variable", "value"],
            additionalProperties: false,
          }
        })
  // One top-level tool per domain (or one generic tool when no domains were declared at all).
  const assignmentTools: Record<string, Record<string, unknown>> =
    vocab.domains.length === 0
      ? { assignment: assignmentAlternatives[0]! }
      : Object.fromEntries(vocab.domains.map((domain, i) => [`assignment__${domain.variable}`, assignmentAlternatives[i]!]))

  // linkedAttributes: each {variable, value} pair must also stay within one domain — reuses
  // the same per-domain alternative shape as assignment's variable+value pairing (entity is
  // deliberately absent here per the kind's own existential semantics, unaffected by this fix).
  const linkedAttributePair =
    vocab.domains.length === 0
      ? { type: "object", properties: { variable: { type: "string" }, value: { type: "string" } }, required: ["variable", "value"], additionalProperties: false }
      : { anyOf: vocab.domains.map((domain) => ({ type: "object", properties: { variable: { type: "string", enum: [domain.variable] }, value: enumOf(domain.values) }, required: ["variable", "value"], additionalProperties: false })) }

  const linkedAttributes = {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["linkedAttributes"] },
      entityType: enumOf([...new Set(vocab.entities.map((e) => e.type))]),
      attributes: {
        type: "array",
        items: linkedAttributePair,
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
  const thenMember = { anyOf: [...assignmentAlternatives, arithmetic, allDifferent, linkedAttributes] }

  // comparison: variable+value scoped per domain like assignment/linkedAttributes above
  // (value may also be a plain number for numeric domains, unaffected by the scoping fix).
  const comparisonCondition =
    vocab.domains.length === 0
      ? { type: "object", properties: { kind: { type: "string", enum: ["comparison"] }, variable: { type: "string" }, operator: { type: "string", enum: [...ARITHMETIC_COMPARATORS] }, value: { anyOf: [{ type: "string" }, { type: "number" }] } }, required: ["kind", "variable", "operator", "value"], additionalProperties: false }
      : {
          anyOf: vocab.domains.map((domain) => ({
            type: "object",
            properties: {
              kind: { type: "string", enum: ["comparison"] },
              variable: { type: "string", enum: [domain.variable] },
              operator: { type: "string", enum: [...ARITHMETIC_COMPARATORS] },
              value: { anyOf: [enumOf(domain.values), { type: "number" }] },
            },
            required: ["kind", "variable", "operator", "value"],
            additionalProperties: false,
          })),
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

  return { ...assignmentTools, linkedAttributes, allDifferent, adjacency, relation, arithmetic, ruleTable, ruleTableConstraint, derivedRule }
}
