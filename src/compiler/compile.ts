import { Effect } from "effect"
import type {
  ArithmeticExpression,
  DerivedCondition,
  Domain,
  ExtractedConstraint,
  ExtractedCsp,
  RuleTableOperand,
} from "../extraction/types.ts"
import { CompileError } from "./types.ts"

// ADR-005: ExtractedCsp -> .mzn compiler. Verified against a real `minizinc` install (not just
// read from docs): `all_different` (not `alldifferent`) requires `include "globals.mzn";`;
// enum-valued vars use `enum X = {...}; var X: v;`; reified implication is plain
// `constraint (cond) -> (then);`; `abs`/enum `!=` work as expected.

function sanitizeIdentifier(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_")
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`
}

function isIntegerLiteral(value: string): boolean {
  return /^-?\d+$/.test(value)
}

/** Numeric strings render as MiniZinc int literals; everything else as a sanitized enum member. */
function renderScalar(value: string | number): string {
  if (typeof value === "number") return String(value)
  return isIntegerLiteral(value) ? value : sanitizeIdentifier(value)
}

interface CompiledDomain {
  readonly domain: Domain
  readonly entityIds: readonly string[]
  readonly isScalar: boolean
  readonly isNumeric: boolean
  readonly entityTypeEnumName: string
  readonly valuesEnumName: string
}

/**
 * One entityType enum name per distinct `entityType` string — computed once, up front, rather
 * than per domain, because two domains can share an entityType (e.g. "color" and "position" both
 * over "house") and must resolve to the exact same enum name (`renderDeclarations` dedupes by
 * this name; if two domains sharing an entityType computed it independently and only one
 * happened to collide with its own variable name, they'd disagree and the entity ids would end
 * up declared as members of two different enums — itself a fresh "identifier already defined").
 *
 * MiniZinc's enum-type names, member names, and top-level variable names all share one
 * identifier namespace — a type can't also be one of its own members, and can't be the same
 * identifier as an array variable indexed by it. An LLM will readily name an entity the same as
 * its own type (e.g. an entity "player" of type "player", observed live on PZL-0003), or name a
 * variable the same as its entityType, either of which would otherwise emit `enum player =
 * {player, ...};` or `array[position] of var ...: position;` — both rejected by `minizinc` as
 * "identifier already defined". Disambiguate only when a real collision is detected, so the
 * common (non-colliding) case keeps its plain, readable name.
 */
function computeEntityTypeEnumNames(csp: ExtractedCsp): ReadonlyMap<string, string> {
  const names = new Map<string, string>()
  for (const entityType of new Set(csp.domains.map((d) => d.entityType))) {
    const base = sanitizeIdentifier(entityType)
    const sanitizedEntityIds = csp.entities
      .filter((entity) => entity.type === entityType)
      .map((entity) => sanitizeIdentifier(entity.id))
    const collidesWithAnyVariable = csp.domains.some(
      (d) => d.entityType === entityType && sanitizeIdentifier(d.variable) === base,
    )
    names.set(entityType, sanitizedEntityIds.includes(base) || collidesWithAnyVariable ? `${base}_Type` : base)
  }
  return names
}

function analyzeDomains(csp: ExtractedCsp): readonly CompiledDomain[] {
  const entityTypeEnumNames = computeEntityTypeEnumNames(csp)
  return csp.domains.map((domain) => {
    const entityIds = csp.entities.filter((entity) => entity.type === domain.entityType).map((entity) => entity.id)
    return {
      domain,
      entityIds,
      // A domain over exactly one entity compiles to a plain scalar var, not a degenerate
      // 1-element array — matches this project's own hand-written reference convention
      // (catalog/mzn/PZL-0004-whodunit.mzn's `var Suspect: culprit;`, not an array).
      isScalar: entityIds.length <= 1,
      isNumeric: domain.values.length > 0 && domain.values.every(isIntegerLiteral),
      entityTypeEnumName: entityTypeEnumNames.get(domain.entityType)!,
      // Named by VALUE CONTENT, not by the owning domain's variable name: MiniZinc enum member
      // identifiers share one global namespace, so two domains with the same vocabulary (e.g.
      // two independent "Yes"/"No" criteria) must resolve to the SAME enum declaration, or the
      // second declaration's members collide with the first's ("identifier `Yes' already
      // defined"). Sharing one enum for an identical value set is correct MiniZinc practice, not
      // a workaround.
      valuesEnumName: `Values_${domain.values.map(sanitizeIdentifier).join("_")}`,
    }
  })
}

function findDomain(compiled: readonly CompiledDomain[], variable: string): CompiledDomain | undefined {
  return compiled.find((c) => c.domain.variable === variable)
}

function renderDeclarations(compiled: readonly CompiledDomain[]): string {
  const lines: string[] = []
  const declaredEntityEnums = new Set<string>()
  const declaredValueEnums = new Set<string>()

  for (const c of compiled) {
    if (!c.isScalar && !declaredEntityEnums.has(c.entityTypeEnumName)) {
      lines.push(`enum ${c.entityTypeEnumName} = {${c.entityIds.map(sanitizeIdentifier).join(", ")}};`)
      declaredEntityEnums.add(c.entityTypeEnumName)
    }
    if (!c.isNumeric && !declaredValueEnums.has(c.valuesEnumName)) {
      lines.push(`enum ${c.valuesEnumName} = {${c.domain.values.map(sanitizeIdentifier).join(", ")}};`)
      declaredValueEnums.add(c.valuesEnumName)
    }
  }

  for (const c of compiled) {
    const valueType = c.isNumeric
      ? `${Math.min(...c.domain.values.map(Number))}..${Math.max(...c.domain.values.map(Number))}`
      : c.valuesEnumName
    const variableName = sanitizeIdentifier(c.domain.variable)
    lines.push(
      c.isScalar
        ? `var ${valueType}: ${variableName};`
        : `array[${c.entityTypeEnumName}] of var ${valueType}: ${variableName};`,
    )
  }

  return lines.join("\n")
}

/** A domain-array reference, entity-indexed only when the domain isn't a scalar. */
function renderVariableRef(
  compiled: readonly CompiledDomain[],
  variable: string,
  entity?: string,
): Effect.Effect<string, CompileError> {
  const domainInfo = findDomain(compiled, variable)
  if (domainInfo === undefined) {
    return Effect.fail(new CompileError({ reason: `Unknown variable "${variable}" — no matching domain declared.` }))
  }
  const name = sanitizeIdentifier(variable)
  if (domainInfo.isScalar) return Effect.succeed(name)
  if (entity === undefined) {
    return Effect.fail(
      new CompileError({ reason: `Variable "${variable}" is entity-indexed but no entity was given.` }),
    )
  }
  // A leaked, never-substituted entity placeholder (e.g. "$this"/"$outer" used in a
  // fact-driven derivedRule, which only substitutes "$a"/"$b", or either used somewhere with no
  // enclosing rule to bind them at all) would otherwise sanitize into a plausible-looking but
  // undeclared MiniZinc identifier (e.g. "_outer") and fail only later, cryptically, at the
  // `minizinc` CLI. Fail loudly here instead — no real entity id is ever "$"-prefixed.
  if (entity.startsWith("$")) {
    return Effect.fail(
      new CompileError({
        reason:
          `Entity placeholder "${entity}" for variable "${variable}" was never substituted with a real ` +
          `entity — "$a"/"$b" only resolve inside a fact-driven derivedRule's thenConstraints, and ` +
          `"$this"/"$outer" only inside a variable-conditioned derivedRule's (nested one level for ` +
          `"$outer"). Used outside that shape, it has nothing to bind to.`,
      }),
    )
  }
  return Effect.succeed(`${name}[${sanitizeIdentifier(entity)}]`)
}

/**
 * Arity is checked here rather than in the schema: JSON Schema could express it with
 * minItems/maxItems, but the required count depends on `op`, and a per-operator schema branch
 * would multiply the union's size for no gain. A wrong count is a loud CompileError. `abs` takes
 * exactly 1; `-`/`/` take exactly 2 (order-sensitive, ambiguous for more); `+`/`*`/`min`/`max`
 * are associative and take 2 or more — a multi-term sum is one node with every term as an
 * operand, not a deeply nested binary tree.
 */
function renderArithmeticExpr(
  compiled: readonly CompiledDomain[],
  expr: ArithmeticExpression,
): Effect.Effect<string, CompileError> {
  switch (expr.kind) {
    case "variableRef":
      return renderVariableRef(compiled, expr.variable, expr.entity ?? undefined)
    case "literal":
      return Effect.succeed(String(expr.value))
    case "binaryOp": {
      if (expr.op === "abs") {
        if (expr.operands.length !== 1) {
          return Effect.fail(
            new CompileError({ reason: `Operator "abs" takes exactly 1 operand, got ${expr.operands.length}.` }),
          )
        }
        return renderArithmeticExpr(compiled, expr.operands[0]!).pipe(Effect.map((operand) => `abs(${operand})`))
      }
      if (expr.op === "-" || expr.op === "/") {
        if (expr.operands.length !== 2) {
          return Effect.fail(
            new CompileError({
              reason: `Operator "${expr.op}" takes exactly 2 operands, got ${expr.operands.length}.`,
            }),
          )
        }
        return Effect.all([
          renderArithmeticExpr(compiled, expr.operands[0]!),
          renderArithmeticExpr(compiled, expr.operands[1]!),
        ]).pipe(Effect.map(([left, right]) => `(${left} ${expr.op} ${right})`))
      }
      // "+" | "*" | "min" | "max" — associative, 2 or more operands.
      if (expr.operands.length < 2) {
        return Effect.fail(
          new CompileError({
            reason: `Operator "${expr.op}" takes at least 2 operands, got ${expr.operands.length}.`,
          }),
        )
      }
      return Effect.all(expr.operands.map((operand) => renderArithmeticExpr(compiled, operand))).pipe(
        Effect.map((rendered) =>
          expr.op === "min" || expr.op === "max" ? `${expr.op}([${rendered.join(", ")}])` : `(${rendered.join(` ${expr.op} `)})`,
        ),
      )
    }
  }
}

function isArithmeticExpressionTarget(
  target: string | number | ArithmeticExpression,
): target is ArithmeticExpression {
  return typeof target === "object"
}

/** `target` is usually a plain scalar, but may itself be a structured expression (ADR-005 §2.5). */
function renderTarget(
  compiled: readonly CompiledDomain[],
  target: string | number | ArithmeticExpression,
): Effect.Effect<string, CompileError> {
  return isArithmeticExpressionTarget(target) ? renderArithmeticExpr(compiled, target) : Effect.succeed(renderScalar(target))
}

function compileAssignment(
  compiled: readonly CompiledDomain[],
  c: Extract<ExtractedConstraint, { kind: "assignment" }>,
): Effect.Effect<string, CompileError> {
  return renderVariableRef(compiled, c.variable, c.entity).pipe(
    Effect.map((ref) => `constraint ${ref} = ${renderScalar(c.value)};`),
  )
}

function compileAllDifferent(
  compiled: readonly CompiledDomain[],
  c: Extract<ExtractedConstraint, { kind: "allDifferent" }>,
): Effect.Effect<string, CompileError> {
  const domainInfo = findDomain(compiled, c.variable)
  if (domainInfo === undefined) {
    return Effect.fail(new CompileError({ reason: `Unknown variable "${c.variable}".` }))
  }
  if (domainInfo.isScalar) {
    return Effect.fail(
      new CompileError({
        reason: `allDifferent requires an entity-indexed variable; "${c.variable}" has only one entity.`,
      }),
    )
  }
  return Effect.succeed(`constraint all_different(${sanitizeIdentifier(c.variable)});`)
}

/**
 * ADR-004 §2.2: some entity of `entityType` has every listed attribute simultaneously, with no
 * entity ever named. Compiles to a solver-time existential rather than anything resolved here —
 * `forall(e in T)(pivot <-> rest)` binds whichever entity satisfies the first attribute to every
 * other one, since each domain here is a bijection (all-different) over the same entity set.
 * Verified directly against a real `minizinc` install (design/adr/ADR-004 §2.2).
 */
function compileLinkedAttributesBody(
  compiled: readonly CompiledDomain[],
  c: Extract<ExtractedConstraint, { kind: "linkedAttributes" }>,
): Effect.Effect<string, CompileError> {
  if (c.attributes.length < 2) {
    return Effect.fail(
      new CompileError({
        reason: `linkedAttributes needs at least 2 attributes to link; got ${c.attributes.length}.`,
      }),
    )
  }

  const infos: CompiledDomain[] = []
  for (const attribute of c.attributes) {
    const domainInfo = findDomain(compiled, attribute.variable)
    if (domainInfo === undefined) {
      return Effect.fail(new CompileError({ reason: `Unknown variable "${attribute.variable}".` }))
    }
    if (domainInfo.domain.entityType !== c.entityType) {
      return Effect.fail(
        new CompileError({
          reason:
            `linkedAttributes entityType "${c.entityType}" doesn't match variable ` +
            `"${attribute.variable}"'s entityType "${domainInfo.domain.entityType}".`,
        }),
      )
    }
    if (domainInfo.isScalar) {
      return Effect.fail(
        new CompileError({
          reason: `linkedAttributes requires entity-indexed variables; entityType "${c.entityType}" has only one entity.`,
        }),
      )
    }
    infos.push(domainInfo)
  }

  const loopVar = "e"
  const exprs = c.attributes.map(
    (attribute) => `${sanitizeIdentifier(attribute.variable)}[${loopVar}] = ${renderScalar(attribute.value)}`,
  )
  const [pivot, ...rest] = exprs
  const body = rest.length === 1 ? `${pivot} <-> ${rest[0]}` : `${pivot} <-> (${rest.join(" /\\ ")})`
  return Effect.succeed(`forall(${loopVar} in ${infos[0]!.entityTypeEnumName})(${body})`)
}

function compileLinkedAttributes(
  compiled: readonly CompiledDomain[],
  c: Extract<ExtractedConstraint, { kind: "linkedAttributes" }>,
): Effect.Effect<string, CompileError> {
  return compileLinkedAttributesBody(compiled, c).pipe(Effect.map((body) => `constraint ${body};`))
}

// ADR-005 §2.3: relation names map to a positional arithmetic template via a small, explicit
// registry, not string-matching/inference — expected to grow as new phrasings are encountered
// (matching ADR-004 §2.2's own taxonomy growth expectation).
const ADJACENCY_TEMPLATES: Record<string, (a: string, b: string) => string> = {
  "immediately right of": (a, b) => `${a} = ${b} + 1`,
  "directly right of": (a, b) => `${a} = ${b} + 1`,
  "immediately left of": (a, b) => `${a} = ${b} - 1`,
  "directly left of": (a, b) => `${a} = ${b} - 1`,
  "immediately before": (a, b) => `${a} = ${b} - 1`,
  "immediately after": (a, b) => `${a} = ${b} + 1`,
  "next to": (a, b) => `abs(${a} - ${b}) = 1`,
  "adjacent to": (a, b) => `abs(${a} - ${b}) = 1`,
}

// Relation names come from an LLM, which varies formatting (spaces vs. underscores/hyphens) for
// the same phrasing (e.g. "immediately before" vs. "immediately_before") — normalize before
// registry lookup rather than growing the registry with every formatting variant.
function normalizeRelationName(name: string): string {
  return name.toLowerCase().replace(/[_-]+/g, " ").trim()
}

function compileAdjacency(
  compiled: readonly CompiledDomain[],
  c: Extract<ExtractedConstraint, { kind: "adjacency" }>,
): Effect.Effect<string, CompileError> {
  const template = ADJACENCY_TEMPLATES[normalizeRelationName(c.relation)]
  if (template === undefined) {
    return Effect.fail(new CompileError({ reason: `Unrecognized adjacency relation "${c.relation}".` }))
  }
  // Adjacency needs a single ordered domain shared by both entities (ADR-005 §2.3) — there's no
  // `variable` field on this constraint kind, so the positional domain is inferred from what's
  // shared. `Domain` carries no explicit "this one is ordered" flag, so when more than one domain
  // is shared (the common multi-attribute zebra-puzzle shape, e.g. color/drink/position all over
  // "house") numeric-ness is the only signal available to disambiguate the positional one from
  // categorical ones. But when exactly one domain is shared, there's nothing to disambiguate
  // against — accept it even if non-numeric (e.g. ordered-but-non-integer values like time slots
  // "9am"/"10am"/"11am", declared in their natural order).
  const shared = compiled.filter((d) => d.entityIds.includes(c.a) && d.entityIds.includes(c.b))
  const positional = shared.length === 1 ? shared : shared.filter((d) => d.isNumeric)
  if (positional.length !== 1) {
    return Effect.fail(
      new CompileError({
        reason: `Could not find a single positional domain shared by "${c.a}" and "${c.b}" for adjacency relation "${c.relation}".`,
      }),
    )
  }
  const domainInfo = positional[0]!
  const varName = sanitizeIdentifier(domainInfo.domain.variable)
  const rawRefA = `${varName}[${sanitizeIdentifier(c.a)}]`
  const rawRefB = `${varName}[${sanitizeIdentifier(c.b)}]`
  // A non-numeric domain renders as a MiniZinc enum, which doesn't support the templates' direct
  // arithmetic (+/-/abs) — cast to each value's ordinal position (its index within the domain's
  // own declared order) via `enum2int` so the arithmetic operates on plain integers instead.
  const refA = domainInfo.isNumeric ? rawRefA : `enum2int(${rawRefA})`
  const refB = domainInfo.isNumeric ? rawRefB : `enum2int(${rawRefB})`
  return Effect.succeed(`constraint ${template(refA, refB)};`)
}

/**
 * Fact-driven expansion (ADR-005 §2.4 mode 1): for every `relation` fact matching the rule's
 * condition name, instantiate the rule's `then` constraints once per matching (a, b) pair.
 * `then` entries reference the pair via the sentinel targets `"$a"`/`"$b"` (this compiler's own
 * convention for "the same expression's variable, evaluated at the other placeholder entity" —
 * ADR-005 §2.4 leaves this substitution mechanism as implementation's call, only naming the
 * general algorithm and citing `color[a] != color[b]` as the worked example this realizes).
 */
function compileFactDrivenRule(
  compiled: readonly CompiledDomain[],
  csp: ExtractedCsp,
  rule: Extract<ExtractedConstraint, { kind: "derivedRule" }>,
  relationName: string,
): Effect.Effect<string, CompileError> {
  const facts = csp.constraints.filter(
    (c): c is Extract<ExtractedConstraint, { kind: "relation" }> => c.kind === "relation" && c.name === relationName,
  )
  return Effect.forEach(facts, (fact) =>
    Effect.forEach(rule.thenConstraints, (thenConstraint) => compileFactDrivenThen(compiled, thenConstraint, fact)),
  ).pipe(Effect.map((groups) => groups.flat().join("\n")))
}

function compileFactDrivenThen(
  compiled: readonly CompiledDomain[],
  thenConstraint: ExtractedConstraint,
  fact: { readonly a: string; readonly b: string },
): Effect.Effect<string, CompileError> {
  if (thenConstraint.kind !== "arithmetic" || thenConstraint.expression.kind !== "variableRef") {
    return Effect.fail(
      new CompileError({
        reason:
          `Fact-driven derivedRule "then" constraints must be an arithmetic constraint over a ` +
          `variableRef (got kind "${thenConstraint.kind}").`,
      }),
    )
  }
  const variable = thenConstraint.expression.variable
  const target = thenConstraint.target

  const rightEffect =
    target === "$a" || target === "$b"
      ? renderVariableRef(compiled, variable, target === "$a" ? fact.a : fact.b)
      : renderTarget(compiled, target)

  return Effect.all([renderVariableRef(compiled, variable, fact.a), rightEffect]).pipe(
    Effect.map(([left, right]) => `constraint ${left} ${thenConstraint.comparator} ${right};`),
  )
}

/** Placeholders a derivedRule's `thenConstraints` uses to refer to entities that are never
 * named by id, only bound by an enclosing rule's condition — mode 2's analogue of mode 1's
 * `$a`/`$b` (`compileFactDrivenThen`). `SELF_ENTITY_TOKEN` ("the entity currently satisfying
 * *this* rule's condition") covers self-referential zebra clues ("if a house is green, its
 * position = ivory's position + 1"). `OUTER_ENTITY_TOKEN` ("the entity satisfying the
 * *enclosing* rule's condition") covers the one-level-deeper case a nested derivedRule needs —
 * e.g. "whoever smokes Chesterfields lives next to whoever owns the fox," where neither house is
 * ever named, each is only identified by its own attribute. Models reach for both spontaneously
 * (observed verbatim in eval output, the latter as an ad hoc value-derived name); until this fix
 * neither was ever interpreted, and nested derivedRule was rejected outright. Depth is bounded to
 * these two levels by `MAX_NESTING_DEPTH` (types.ts) — a derivedRule nested inside a derivedRule
 * can itself only contain non-recursive (leaf) thenConstraints. */
const SELF_ENTITY_TOKEN = "$this"
const OUTER_ENTITY_TOKEN = "$outer"

type EntityTokenMap = Readonly<Record<string, string>>

function substituteEntityTokens(expr: ArithmeticExpression, tokens: EntityTokenMap): ArithmeticExpression {
  switch (expr.kind) {
    case "variableRef":
      return expr.entity !== null && expr.entity in tokens ? { ...expr, entity: tokens[expr.entity]! } : expr
    case "literal":
      return expr
    case "binaryOp":
      return { ...expr, operands: expr.operands.map((operand) => substituteEntityTokens(operand, tokens)) }
  }
}

function substituteEntityTokensInTarget(
  target: string | number | ArithmeticExpression,
  tokens: EntityTokenMap,
): string | number | ArithmeticExpression {
  return isArithmeticExpressionTarget(target) ? substituteEntityTokens(target, tokens) : target
}

/** Substitutes entity-placeholder tokens throughout one `thenConstraints` entry with concrete
 * entities. Scoped to the constraint kinds that reference a specific entity at all
 * (assignment, arithmetic) — a nested `derivedRule` is deliberately left untouched here; its own
 * tokens are resolved when `compileNestedVariableConditionedRule` compiles it. */
function substituteEntityTokensInConstraint(c: ExtractedConstraint, tokens: EntityTokenMap): ExtractedConstraint {
  switch (c.kind) {
    case "assignment":
      return c.entity in tokens ? { ...c, entity: tokens[c.entity]! } : c
    case "arithmetic":
      return {
        ...c,
        expression: substituteEntityTokens(c.expression, tokens),
        target: substituteEntityTokensInTarget(c.target, tokens),
      }
    default:
      return c
  }
}

/**
 * A derivedRule nested inside another derivedRule's `thenConstraints` — the two-anonymous-
 * entities relational-chaining pattern (ADR-004 §2.2/`eval/README.md`'s previously-unaddressed
 * gap). Compiles to a `forall` boolean expression (not top-level `constraint` statements, which
 * can't nest inside the outer implication's parens): `forall(e in EntityEnum)((innerCond) ->
 * (innerBody))`, with `SELF_ENTITY_TOKEN` bound to the forall's own generator variable and
 * `OUTER_ENTITY_TOKEN` bound to the already-concrete entity the enclosing rule is reifying over.
 */
function compileNestedVariableConditionedRule(
  compiled: readonly CompiledDomain[],
  rule: Extract<ExtractedConstraint, { kind: "derivedRule" }>,
  outerEntityId: string,
): Effect.Effect<string, CompileError> {
  if (rule.condition.kind !== "comparison") {
    return Effect.fail(
      new CompileError({
        reason: 'A derivedRule nested inside a "then" list must have a variable-conditioned ("comparison") condition.',
      }),
    )
  }
  const condition = rule.condition
  const domainInfo = findDomain(compiled, condition.variable)
  if (domainInfo === undefined) {
    return Effect.fail(
      new CompileError({ reason: `Unknown variable "${condition.variable}" — no matching domain declared.` }),
    )
  }
  if (domainInfo.isScalar) {
    return Effect.fail(
      new CompileError({
        reason: `A nested derivedRule's condition variable "${condition.variable}" must be entity-indexed, not scalar.`,
      }),
    )
  }

  const generatorVar = sanitizeIdentifier(`${domainInfo.entityTypeEnumName}_e`)
  const tokens: EntityTokenMap = { [SELF_ENTITY_TOKEN]: generatorVar, [OUTER_ENTITY_TOKEN]: outerEntityId }

  return renderVariableRef(compiled, condition.variable, generatorVar).pipe(
    Effect.flatMap((conditionRef) => {
      const conditionExpr = `${conditionRef} ${condition.operator} ${renderScalar(condition.value)}`
      const substituted = rule.thenConstraints.map((thenConstraint) =>
        substituteEntityTokensInConstraint(thenConstraint, tokens),
      )
      // Depth-bounded (MAX_NESTING_DEPTH): these are leaf constraints, never another derivedRule.
      return Effect.forEach(substituted, (thenConstraint) => compileConstraintBody(compiled, thenConstraint)).pipe(
        Effect.map(
          (thenBodies) =>
            `forall(${generatorVar} in ${domainInfo.entityTypeEnumName})(` +
            `${thenBodies.map((body) => `(${conditionExpr}) -> (${body})`).join(" /\\ ")})`,
        ),
      )
    }),
  )
}

/** Dispatches one `thenConstraints` entry: a nested `derivedRule` compiles via
 * `compileNestedVariableConditionedRule` (needs the enclosing rule's bound entity for
 * `OUTER_ENTITY_TOKEN`); everything else via the shared `compileConstraintBody`. */
function compileThenConstraint(
  compiled: readonly CompiledDomain[],
  thenConstraint: ExtractedConstraint,
  outerEntityId: string | undefined,
): Effect.Effect<string, CompileError> {
  if (thenConstraint.kind === "derivedRule") {
    if (outerEntityId === undefined) {
      return Effect.fail(
        new CompileError({
          reason: 'A nested derivedRule needs an entity-indexed enclosing rule to bind "$outer" against.',
        }),
      )
    }
    return compileNestedVariableConditionedRule(compiled, thenConstraint, outerEntityId)
  }
  return compileConstraintBody(compiled, thenConstraint)
}

/** Variable-conditioned reified implication (ADR-005 §2.4 mode 2). */
function compileVariableConditionedRule(
  compiled: readonly CompiledDomain[],
  rule: Extract<ExtractedConstraint, { kind: "derivedRule" }>,
  condition: Extract<DerivedCondition, { kind: "comparison" }>,
): Effect.Effect<string, CompileError> {
  const domainInfo = findDomain(compiled, condition.variable)
  if (domainInfo === undefined) {
    return Effect.fail(
      new CompileError({ reason: `Unknown variable "${condition.variable}" — no matching domain declared.` }),
    )
  }

  if (domainInfo.isScalar) {
    return renderVariableRef(compiled, condition.variable).pipe(
      Effect.flatMap((conditionRef) => {
        const conditionExpr = `${conditionRef} ${condition.operator} ${renderScalar(condition.value)}`
        return Effect.forEach(rule.thenConstraints, (thenConstraint) =>
          compileThenConstraint(compiled, thenConstraint, undefined),
        ).pipe(
          Effect.map((thenBodies) =>
            thenBodies.map((body) => `constraint (${conditionExpr}) -> (${body});`).join("\n"),
          ),
        )
      }),
    )
  }

  // An entity-indexed condition variable: reify once per entity of its domain, substituting
  // SELF_ENTITY_TOKEN in thenConstraints with that entity (mirrors mode 1's per-relation-fact
  // $a/$b substitution in compileFactDrivenThen).
  return Effect.forEach(domainInfo.entityIds, (entityId) =>
    renderVariableRef(compiled, condition.variable, entityId).pipe(
      Effect.flatMap((conditionRef) => {
        const conditionExpr = `${conditionRef} ${condition.operator} ${renderScalar(condition.value)}`
        const substituted = rule.thenConstraints.map((thenConstraint) =>
          substituteEntityTokensInConstraint(thenConstraint, { [SELF_ENTITY_TOKEN]: entityId }),
        )
        return Effect.forEach(substituted, (thenConstraint) =>
          compileThenConstraint(compiled, thenConstraint, entityId),
        ).pipe(
          Effect.map((thenBodies) =>
            thenBodies.map((body) => `constraint (${conditionExpr}) -> (${body});`).join("\n"),
          ),
        )
      }),
    ),
  ).pipe(Effect.map((groups) => groups.join("\n")))
}

/** Renders one constraint's boolean body (no `constraint `/`;` wrapper) — reused by the
 * reified-implication mode above and by `compileTopLevelConstraint`'s top-level wrapping.
 */
function compileConstraintBody(
  compiled: readonly CompiledDomain[],
  c: ExtractedConstraint,
): Effect.Effect<string, CompileError> {
  switch (c.kind) {
    case "assignment":
      return renderVariableRef(compiled, c.variable, c.entity).pipe(
        Effect.map((ref) => `${ref} = ${renderScalar(c.value)}`),
      )
    case "arithmetic":
      return Effect.all([renderArithmeticExpr(compiled, c.expression), renderTarget(compiled, c.target)]).pipe(
        Effect.map(([expr, target]) => `${expr} ${c.comparator} ${target}`),
      )
    case "allDifferent":
      return Effect.succeed(`all_different(${sanitizeIdentifier(c.variable)})`)
    case "linkedAttributes":
      return compileLinkedAttributesBody(compiled, c)
    default:
      return Effect.fail(
        new CompileError({
          reason: `A "${c.kind}" constraint can't be used inside a reified implication's "then" list.`,
        }),
      )
  }
}

function compileDerivedRule(
  compiled: readonly CompiledDomain[],
  csp: ExtractedCsp,
  rule: Extract<ExtractedConstraint, { kind: "derivedRule" }>,
): Effect.Effect<string, CompileError> {
  return rule.condition.kind === "relation"
    ? compileFactDrivenRule(compiled, csp, rule, rule.condition.name)
    : compileVariableConditionedRule(compiled, rule, rule.condition)
}

function compileArithmeticTopLevel(
  compiled: readonly CompiledDomain[],
  c: Extract<ExtractedConstraint, { kind: "arithmetic" }>,
): Effect.Effect<string, CompileError> {
  return Effect.all([renderArithmeticExpr(compiled, c.expression), renderTarget(compiled, c.target)]).pipe(
    Effect.map(([expr, target]) => `constraint ${expr} ${c.comparator} ${target};`),
  )
}

/** Renders one side of a `ruleTableConstraint`: a variable's value, or a known constant. */
function renderRuleTableOperand(
  compiled: readonly CompiledDomain[],
  operand: RuleTableOperand,
): Effect.Effect<string, CompileError> {
  return operand.kind === "literal"
    ? Effect.succeed(renderScalar(operand.value))
    : renderVariableRef(compiled, operand.variable, operand.entity ?? undefined)
}

/**
 * A static, entity-independent rule table (ADR-004 §2.2/eval's previously-unaddressed "no
 * universal rule table" gap) — e.g. rock-paper-scissors' "paper beats rock, rock beats scissors,
 * scissors beats paper". `ruleTable` facts (one tuple per clue, sharing `name`) declare the table;
 * this compiles the paired `ruleTableConstraint` into a disjunction over the declared tuples: the
 * two rendered operands must match SOME tuple's `a`/`b` values. Each disjunct's own `aRef`/`bRef`
 * are the same rendered expression across every tuple — only the tuple's literal values change —
 * so exactly the tuples that are actually true for the current assignment select it.
 */
function compileRuleTableConstraint(
  compiled: readonly CompiledDomain[],
  csp: ExtractedCsp,
  c: Extract<ExtractedConstraint, { kind: "ruleTableConstraint" }>,
): Effect.Effect<string, CompileError> {
  const tuples = csp.constraints.filter(
    (x): x is Extract<ExtractedConstraint, { kind: "ruleTable" }> => x.kind === "ruleTable" && x.name === c.table,
  )
  if (tuples.length === 0) {
    return Effect.fail(
      new CompileError({ reason: `Unknown rule table "${c.table}" — no matching "ruleTable" facts declared.` }),
    )
  }
  return Effect.all([renderRuleTableOperand(compiled, c.a), renderRuleTableOperand(compiled, c.b)]).pipe(
    Effect.map(
      ([aRef, bRef]) =>
        `constraint ${tuples
          .map((t) => `(${aRef} = ${renderScalar(t.a)} /\\ ${bRef} = ${renderScalar(t.b)})`)
          .join(" \\/ ")};`,
    ),
  )
}

function compileTopLevelConstraint(
  compiled: readonly CompiledDomain[],
  csp: ExtractedCsp,
  c: ExtractedConstraint,
): Effect.Effect<string, CompileError> {
  switch (c.kind) {
    case "assignment":
      return compileAssignment(compiled, c)
    case "linkedAttributes":
      return compileLinkedAttributes(compiled, c)
    case "allDifferent":
      return compileAllDifferent(compiled, c)
    case "adjacency":
      return compileAdjacency(compiled, c)
    case "relation":
      // Consumed by a paired derivedRule (fact-driven expansion) — produces no output itself.
      return Effect.succeed("")
    case "derivedRule":
      return compileDerivedRule(compiled, csp, c)
    case "arithmetic":
      return compileArithmeticTopLevel(compiled, c)
    case "ruleTable":
      // Consumed by a paired ruleTableConstraint — produces no output itself.
      return Effect.succeed("")
    case "ruleTableConstraint":
      return compileRuleTableConstraint(compiled, csp, c)
  }
}

/**
 * ExtractedCsp -> a complete, self-contained .mzn model string (ADR-005 §2.1). Fails with
 * CompileError on the first unrecognized/ambiguous construct (ADR-005 §2.3/§2.4) — never a
 * silent best-effort guess.
 */
export function compile(csp: ExtractedCsp): Effect.Effect<string, CompileError> {
  const compiled = analyzeDomains(csp)
  const declarations = renderDeclarations(compiled)
  const needsGlobals = csp.constraints.some((c) => c.kind === "allDifferent")

  return Effect.forEach(csp.constraints, (c) => compileTopLevelConstraint(compiled, csp, c)).pipe(
    Effect.map((lines) => {
      const header = needsGlobals ? 'include "globals.mzn";\n\n' : ""
      const body = lines.filter((line) => line.length > 0).join("\n")
      return `${header}${declarations}\n\n${body}\n\nsolve satisfy;\n`
    }),
  )
}
