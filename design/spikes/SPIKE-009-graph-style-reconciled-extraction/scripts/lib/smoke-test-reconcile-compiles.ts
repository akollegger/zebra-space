// Zero-cost: confirms a PZL-0010-like reconciled vocabulary actually COMPILES (the real
// src/compiler/compile.ts) with an allDifferent over the synthesized positional domain — the
// exact construct that failed pre-reconciliation ("allDifferent requires an entity-indexed
// variable; 'arrival-order' has only one entity").
import { Effect } from "effect"
import { reconcile } from "./reconcile.ts"
import { compile } from "../../../../../src/compiler/compile.ts"
import { solve } from "../../../../../src/solver/solve.ts"
import type { ExtractedConstraint } from "../../../../../src/extraction/types.ts"

const proposals = [
  { clueIndex: 0, entityMentions: [], domainMentions: [{ attributeNameGuess: "arrival-order", entityTypeGuess: "vehicle", valueMentioned: "red-car", isOrderingHint: true }] },
  { clueIndex: 1, entityMentions: [], domainMentions: [{ attributeNameGuess: "arrival-order", entityTypeGuess: "vehicle", valueMentioned: "blue-car", isOrderingHint: true }] },
  { clueIndex: 2, entityMentions: [], domainMentions: [{ attributeNameGuess: "arrival-order", entityTypeGuess: "vehicle", valueMentioned: "green-car", isOrderingHint: true }] },
]

const { vocabulary } = reconcile(proposals)
const entityIds = vocabulary.entities.map((e) => e.id)

const constraints: ExtractedConstraint[] = [
  { kind: "allDifferent", variable: "arrival_order_position" },
  ...entityIds.map((id, i): ExtractedConstraint => ({ kind: "assignment", entity: id, variable: "arrival_order_position", value: String(i + 1) })),
]

const csp = { entities: vocabulary.entities, domains: vocabulary.domains, constraints }
const mzn = await Effect.runPromise(compile(csp))
console.log("--- MZN ---\n" + mzn)

const solveResult = await Effect.runPromise(solve({ model: mzn }))
console.log("--- SOLVE ---", JSON.stringify(solveResult))
// The point here is that compile() succeeded at all — the exact thing that previously failed
// ("allDifferent requires an entity-indexed variable; 'arrival-order' has only one entity").
// This synthetic fixture never constrains "arrival-order" itself (no assignment linking each
// vehicle to a car name), so MultiplySatisfiable is the CORRECT solver outcome, not a mechanism
// failure — a real extraction would also emit those assignment constraints.
if (solveResult._tag !== "MultiplySatisfiable" && solveResult._tag !== "UniquelySolvable") {
  throw new Error(`expected a solved outcome (this fixture is intentionally under-constrained on "arrival-order"), got ${solveResult._tag}`)
}

console.log("RECONCILE-COMPILES SMOKE TEST PASSED — the pre-reconciliation failure (allDifferent on a scalar variable) no longer occurs")
