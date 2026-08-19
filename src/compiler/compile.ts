import { Effect } from "effect"
import type {
  ArithmeticExpression,
  DerivedCondition,
  Domain,
  ExtractedConstraint,
  ExtractedCsp,
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

function analyzeDomains(csp: ExtractedCsp): readonly CompiledDomain[] {
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
      entityTypeEnumName: sanitizeIdentifier(domain.entityType),
      valuesEnumName: `${sanitizeIdentifier(domain.variable)}Values`,
    }
  })
}

function findDomain(compiled: readonly CompiledDomain[], variable: string): CompiledDomain | undefined {
  return compiled.find((c) => c.domain.variable === variable)
}

function renderDeclarations(compiled: readonly CompiledDomain[]): string {
  const lines: string[] = []
  const declaredEntityEnums = new Set<string>()

  for (const c of compiled) {
    if (!c.isScalar && !declaredEntityEnums.has(c.entityTypeEnumName)) {
      lines.push(`enum ${c.entityTypeEnumName} = {${c.entityIds.map(sanitizeIdentifier).join(", ")}};`)
      declaredEntityEnums.add(c.entityTypeEnumName)
    }
    if (!c.isNumeric) {
      lines.push(`enum ${c.valuesEnumName} = {${c.domain.values.map(sanitizeIdentifier).join(", ")}};`)
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
  return Effect.succeed(`${name}[${sanitizeIdentifier(entity)}]`)
}

function renderArithmeticExpr(
  compiled: readonly CompiledDomain[],
  expr: ArithmeticExpression,
): Effect.Effect<string, CompileError> {
  switch (expr.kind) {
    case "variableRef":
      return renderVariableRef(compiled, expr.variable)
    case "literal":
      return Effect.succeed(String(expr.value))
    case "binaryOp": {
      // Arity is checked here rather than in the schema: JSON Schema could express it with
      // minItems/maxItems, but the required count depends on `op`, and a per-operator schema
      // branch would multiply the union's size for no gain. A wrong count is a loud CompileError.
      const expected = expr.op === "abs" ? 1 : 2
      if (expr.operands.length !== expected) {
        return Effect.fail(
          new CompileError({
            reason: `Operator "${expr.op}" takes exactly ${expected} operand${expected === 1 ? "" : "s"}, got ${expr.operands.length}.`,
          }),
        )
      }
      if (expr.op === "abs") {
        return renderArithmeticExpr(compiled, expr.operands[0]!).pipe(
          Effect.map((operand) => `abs(${operand})`),
        )
      }
      return Effect.all([
        renderArithmeticExpr(compiled, expr.operands[0]!),
        renderArithmeticExpr(compiled, expr.operands[1]!),
      ]).pipe(
        Effect.map(([left, right]) =>
          expr.op === "min" || expr.op === "max"
            ? `${expr.op}(${left}, ${right})`
            : `${left} ${expr.op} ${right}`,
        ),
      )
    }
  }
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

function compileAdjacency(
  compiled: readonly CompiledDomain[],
  c: Extract<ExtractedConstraint, { kind: "adjacency" }>,
): Effect.Effect<string, CompileError> {
  const template = ADJACENCY_TEMPLATES[c.relation.toLowerCase()]
  if (template === undefined) {
    return Effect.fail(new CompileError({ reason: `Unrecognized adjacency relation "${c.relation}".` }))
  }
  // Adjacency needs a single, numeric, ordered domain shared by both entities (ADR-005 §2.3) —
  // there's no `variable` field on this constraint kind, so the positional domain is inferred as
  // the entities' one shared numeric domain.
  const positional = compiled.filter(
    (d) => d.isNumeric && d.entityIds.includes(c.a) && d.entityIds.includes(c.b),
  )
  if (positional.length !== 1) {
    return Effect.fail(
      new CompileError({
        reason: `Could not find a single numeric positional domain shared by "${c.a}" and "${c.b}" for adjacency relation "${c.relation}".`,
      }),
    )
  }
  const domainInfo = positional[0]!
  const varName = sanitizeIdentifier(domainInfo.domain.variable)
  const refA = `${varName}[${sanitizeIdentifier(c.a)}]`
  const refB = `${varName}[${sanitizeIdentifier(c.b)}]`
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
      : Effect.succeed(renderScalar(target))

  return Effect.all([renderVariableRef(compiled, variable, fact.a), rightEffect]).pipe(
    Effect.map(([left, right]) => `constraint ${left} ${thenConstraint.comparator} ${right};`),
  )
}

/** Variable-conditioned reified implication (ADR-005 §2.4 mode 2). */
function compileVariableConditionedRule(
  compiled: readonly CompiledDomain[],
  rule: Extract<ExtractedConstraint, { kind: "derivedRule" }>,
  condition: Extract<DerivedCondition, { kind: "comparison" }>,
): Effect.Effect<string, CompileError> {
  return renderVariableRef(compiled, condition.variable).pipe(
    Effect.flatMap((conditionRef) => {
      const conditionExpr = `${conditionRef} ${condition.operator} ${renderScalar(condition.value)}`
      return Effect.forEach(rule.thenConstraints, (thenConstraint) => compileConstraintBody(compiled, thenConstraint)).pipe(
        Effect.map((thenBodies) =>
          thenBodies.map((body) => `constraint (${conditionExpr}) -> (${body});`).join("\n"),
        ),
      )
    }),
  )
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
      return renderArithmeticExpr(compiled, c.expression).pipe(
        Effect.map((expr) => `${expr} ${c.comparator} ${renderScalar(c.target)}`),
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
  return renderArithmeticExpr(compiled, c.expression).pipe(
    Effect.map((expr) => `constraint ${expr} ${c.comparator} ${renderScalar(c.target)};`),
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
