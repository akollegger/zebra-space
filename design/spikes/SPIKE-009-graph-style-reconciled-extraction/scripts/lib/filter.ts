// SPIKE-009: the filtering step — applied after the per-clue constraint stage runs against the
// RECONCILED (not raw, not global-one-shot) vocabulary. Drops constraints that shouldn't have
// been assembled: ones whose fields don't resolve against the canonical vocabulary at all
// (defensive — synthesized domains, per reconcile.ts, are new territory), and ones from a clue
// whose only vocabulary contribution never survived reconciliation.

import type { Vocabulary } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/clue-schema.ts"
import type { ExtractedConstraint } from "../../../../../src/extraction/types.ts"

export interface TaggedConstraint {
  readonly clueIndex: number
  readonly constraint: ExtractedConstraint
}

function referencedIds(constraint: ExtractedConstraint): { readonly entities: readonly string[]; readonly variables: readonly string[] } {
  switch (constraint.kind) {
    case "assignment":
      return { entities: [constraint.entity], variables: [constraint.variable] }
    case "linkedAttributes":
      return { entities: [], variables: constraint.attributes.map((a) => a.variable) }
    case "allDifferent":
      return { entities: [], variables: [constraint.variable] }
    case "adjacency":
      return { entities: [constraint.a, constraint.b], variables: constraint.variable !== null ? [constraint.variable] : [] }
    case "relation":
      return { entities: [constraint.a, constraint.b], variables: [] }
    case "ruleTable":
      return { entities: [], variables: [] }
    case "ruleTableConstraint": {
      const side = (op: typeof constraint.a) => (op.kind === "variableRef" ? { entity: op.entity ?? undefined, variable: op.variable } : undefined)
      const a = side(constraint.a)
      const b = side(constraint.b)
      return { entities: [a?.entity, b?.entity].filter((x): x is string => x !== undefined), variables: [a?.variable, b?.variable].filter((x): x is string => x !== undefined) }
    }
    case "arithmetic": {
      const vars: string[] = []
      const entities: string[] = []
      const walk = (expr: typeof constraint.expression | typeof constraint.target): void => {
        if (typeof expr !== "object") return
        if (expr.kind === "variableRef") {
          vars.push(expr.variable)
          if (expr.entity !== null) entities.push(expr.entity)
        } else if (expr.kind === "binaryOp") {
          for (const operand of expr.operands) walk(operand)
        }
      }
      walk(constraint.expression)
      walk(constraint.target)
      return { entities, variables: vars }
    }
    case "derivedRule":
      // Placeholder entities ($this/$outer/$a/$b) are resolved at compile time, not here —
      // checking them against the canonical vocabulary would false-positive-reject every
      // derivedRule. Only check the rule's own thenConstraints' variables recursively.
      return constraint.thenConstraints.reduce(
        (acc, c) => {
          const r = referencedIds(c)
          return { entities: [...acc.entities, ...r.entities.filter((e) => !e.startsWith("$"))], variables: [...acc.variables, ...r.variables] }
        },
        { entities: [] as string[], variables: [] as string[] },
      )
  }
}

/**
 * Filters a list of clue-tagged constraints against the canonical vocabulary + the set of clue
 * indices reconciliation found to have survived (see reconcile.ts's ReconciliationResult).
 */
export function filterConstraints(
  tagged: readonly TaggedConstraint[],
  vocabulary: Vocabulary,
  survivingClueIndices: ReadonlySet<number>,
): { readonly kept: readonly TaggedConstraint[]; readonly dropped: readonly { readonly constraint: TaggedConstraint; readonly reason: string }[] } {
  const entityIds = new Set(vocabulary.entities.map((e) => e.id))
  const variableNames = new Set(vocabulary.domains.map((d) => d.variable))

  const kept: TaggedConstraint[] = []
  const dropped: { readonly constraint: TaggedConstraint; readonly reason: string }[] = []

  for (const item of tagged) {
    if (!survivingClueIndices.has(item.clueIndex)) {
      dropped.push({ constraint: item, reason: `clue ${item.clueIndex}'s vocabulary contribution never survived reconciliation` })
      continue
    }
    const { entities, variables } = referencedIds(item.constraint)
    const unknownEntity = entities.find((id) => !entityIds.has(id))
    const unknownVariable = variables.find((v) => !variableNames.has(v))
    if (unknownEntity !== undefined) {
      dropped.push({ constraint: item, reason: `references unknown entity "${unknownEntity}" not in the canonical vocabulary` })
      continue
    }
    if (unknownVariable !== undefined) {
      dropped.push({ constraint: item, reason: `references unknown variable "${unknownVariable}" not in the canonical vocabulary` })
      continue
    }
    kept.push(item)
  }

  return { kept, dropped }
}
