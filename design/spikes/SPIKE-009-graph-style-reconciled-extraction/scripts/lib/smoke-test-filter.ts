import { filterConstraints, type TaggedConstraint } from "./filter.ts"
import type { Vocabulary } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/clue-schema.ts"

const vocabulary: Vocabulary = {
  entities: [{ id: "h1", type: "house" }, { id: "h2", type: "house" }],
  domains: [{ variable: "color", entityType: "house", values: ["Red", "Blue"] }],
}
const survivingClueIndices = new Set([0, 1])

const tagged: TaggedConstraint[] = [
  { clueIndex: 0, constraint: { kind: "assignment", entity: "h1", variable: "color", value: "Red" } },
  // References an entity NOT in the canonical vocabulary (a candidate that didn't survive reconciliation).
  { clueIndex: 1, constraint: { kind: "assignment", entity: "h_ghost", variable: "color", value: "Blue" } },
  // From a clue that never contributed anything to the surviving vocabulary at all.
  { clueIndex: 2, constraint: { kind: "assignment", entity: "h1", variable: "color", value: "Blue" } },
]

const { kept, dropped } = filterConstraints(tagged, vocabulary, survivingClueIndices)
console.log("kept:", JSON.stringify(kept))
console.log("dropped:", JSON.stringify(dropped, null, 1))

if (kept.length !== 1) throw new Error(`expected 1 kept constraint, got ${kept.length}`)
if (dropped.length !== 2) throw new Error(`expected 2 dropped constraints, got ${dropped.length}`)
console.log("FILTER SMOKE TEST PASSED")
