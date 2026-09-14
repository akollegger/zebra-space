// Zero-cost regression test (PR #28 review): filterConstraints previously only walked
// derivedRule.thenConstraints, missing variable references inside the rule's own CONDITION
// (comparison.variable, expressionComparison.expression, and "and"'s nested conditions) — those
// survived the filter and only failed later, less specifically, inside compile().
import { filterConstraints, type TaggedConstraint } from "./filter.ts"
import type { Vocabulary } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/clue-schema.ts"

const vocabulary: Vocabulary = {
  entities: [{ id: "e1", type: "event" }],
  domains: [{ variable: "known-variable", entityType: "event", values: ["a", "b"] }],
}
const survivingClueIndices = new Set([0, 1, 2])

const tagged: TaggedConstraint[] = [
  // A "comparison" condition referencing an UNKNOWN variable.
  {
    clueIndex: 0,
    constraint: {
      kind: "derivedRule",
      appliesTo: "event",
      condition: { kind: "comparison", variable: "unknown-variable", operator: "=", value: "x" },
      thenConstraints: [{ kind: "assignment", entity: "e1", variable: "known-variable", value: "a" }],
    },
  },
  // An "expressionComparison" condition whose expression references an unknown variable.
  {
    clueIndex: 1,
    constraint: {
      kind: "derivedRule",
      appliesTo: "event",
      condition: { kind: "expressionComparison", expression: { kind: "variableRef", variable: "another-unknown", entity: null }, operator: ">", value: 5 },
      thenConstraints: [{ kind: "assignment", entity: "e1", variable: "known-variable", value: "a" }],
    },
  },
  // Fully valid — condition references the declared variable.
  {
    clueIndex: 2,
    constraint: {
      kind: "derivedRule",
      appliesTo: "event",
      condition: { kind: "comparison", variable: "known-variable", operator: "=", value: "a" },
      thenConstraints: [{ kind: "assignment", entity: "e1", variable: "known-variable", value: "b" }],
    },
  },
]

const { kept, dropped } = filterConstraints(tagged, vocabulary, survivingClueIndices)
console.log("kept:", kept.length, "dropped:", dropped.length)
console.log(JSON.stringify(dropped, null, 1))

if (kept.length !== 1) throw new Error(`REGRESSION: expected only the valid derivedRule to survive, got ${kept.length} kept`)
if (dropped.length !== 2) throw new Error(`REGRESSION: expected both condition-referencing-unknown-variable rules to be dropped, got ${dropped.length}`)
console.log("FILTER-CONDITION SMOKE TEST PASSED")
