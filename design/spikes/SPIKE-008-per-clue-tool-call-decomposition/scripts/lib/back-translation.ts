// SPIKE-008 sub-question 5 (back-translation critic): render each assembled constraint back
// into a plain English sentence — a deterministic, stripped-down mirror of
// src/compiler/compile.ts's per-kind dispatch, English instead of MiniZinc — so a critic call
// judges "does this sentence match clue N" (NL-vs-NL) instead of today's "does this JSON blob
// match this whole prose" (JSON-vs-prose). The renderer itself is pure and needs no LLM call;
// only the actual judging call does (built here but not yet invoked — see SPIKE.md Notes on
// what's pending a spend go-ahead).

import type { ArithmeticExpression, ExtractedConstraint } from "../../../../../src/extraction/types.ts"

function renderExpr(expr: ArithmeticExpression): string {
  switch (expr.kind) {
    case "variableRef":
      return expr.entity === null ? expr.variable : `${expr.entity}'s ${expr.variable}`
    case "literal":
      return String(expr.value)
    case "binaryOp": {
      const rendered = expr.operands.map(renderExpr)
      switch (expr.op) {
        case "abs":
          return `the absolute difference of (${rendered.join(", ")})`
        case "min":
          return `the lowest of (${rendered.join(", ")})`
        case "max":
          return `the highest of (${rendered.join(", ")})`
        default:
          return rendered.join(` ${expr.op} `)
      }
    }
  }
}

function renderTarget(target: string | number | ArithmeticExpression): string {
  if (typeof target === "object") return renderExpr(target)
  return String(target)
}

const COMPARATOR_WORDS: Record<string, string> = {
  "=": "equals", "!=": "does not equal", "<": "is less than", "<=": "is at most", ">": "is more than", ">=": "is at least",
}

/**
 * Renders ONE constraint as an English sentence. Only the kinds src/compiler/compile.ts's own
 * `compileThenConstraint` restriction allows nested inside a derivedRule (assignment/arithmetic/
 * allDifferent/linkedAttributes) are handled inside `derivedRule` itself, mirroring that same
 * restriction (compile.ts:899-914) rather than reimplementing every kind recursively.
 */
export function renderConstraintAsEnglish(c: ExtractedConstraint): string {
  switch (c.kind) {
    case "assignment":
      return `${c.entity}'s ${c.variable} is ${c.value}.`
    case "linkedAttributes":
      return `Some ${c.entityType} has ${c.attributes.map((a) => `${a.variable} = ${a.value}`).join(" and ")} at the same time.`
    case "allDifferent":
      return `Every entity has a different ${c.variable}.`
    case "adjacency":
      return `${c.a} is ${c.relation} ${c.b}${c.variable !== null ? ` (ordered by ${c.variable})` : ""}.`
    case "relation":
      return `${c.a} relates to ${c.b} via "${c.name}".`
    case "arithmetic":
      return `${renderExpr(c.expression)} ${COMPARATOR_WORDS[c.comparator] ?? c.comparator} ${renderTarget(c.target)}.`
    case "ruleTable":
      return `As a fixed rule, "${c.a}" and "${c.b}" are related under "${c.name}".`
    case "ruleTableConstraint": {
      const side = (op: typeof c.a) => (op.kind === "literal" ? op.value : op.entity === null ? op.variable : `${op.entity}'s ${op.variable}`)
      return `${side(c.a)} and ${side(c.b)} must satisfy the "${c.table}" rule.`
    }
    case "derivedRule": {
      const condText =
        c.condition.kind === "relation"
          ? `whenever the "${c.condition.name}" relation holds`
          : c.condition.kind === "comparison"
            ? `whenever ${c.condition.variable} ${COMPARATOR_WORDS[c.condition.operator] ?? c.condition.operator} ${renderTarget(c.condition.value)}`
            : c.condition.kind === "expressionComparison"
              ? `whenever ${renderExpr(c.condition.expression)} ${COMPARATOR_WORDS[c.condition.operator] ?? c.condition.operator} ${renderTarget(c.condition.value)}`
              : "whenever all of several conditions hold"
      const thenText = c.thenConstraints.map(renderConstraintAsEnglish).join(" ")
      return `For each ${c.appliesTo}, ${condText}: ${thenText}`
    }
  }
}
