import { Effect } from "effect"
import { groundedFinding, type ClueTaggedConstraint } from "./grounded-critic.ts"
import type { ExtractedCsp } from "../../../../../src/extraction/types.ts"

// Two entities, one domain, one clue says H1=Red, a conflicting "clue" (index 1) says H1=Blue.
const csp: ExtractedCsp = {
  entities: [{ id: "H1", type: "House" }, { id: "H2", type: "House" }],
  domains: [{ variable: "color", entityType: "House", values: ["Red", "Blue"] }],
  constraints: [
    { kind: "assignment", entity: "H1", variable: "color", value: "Red" },
    { kind: "assignment", entity: "H1", variable: "color", value: "Blue" },
  ],
}
const tagged: ClueTaggedConstraint[] = [
  { clueIndex: 0, constraint: csp.constraints[0]! },
  { clueIndex: 1, constraint: csp.constraints[1]! },
]

const finding = await Effect.runPromise(groundedFinding(csp, tagged))
console.log(JSON.stringify(finding, null, 1))
if (finding.kind !== "unsatisfiable-conflict") throw new Error(`expected unsatisfiable-conflict, got ${finding.kind}`)
if (!finding.suspectClueIndices.includes(0) || !finding.suspectClueIndices.includes(1)) {
  throw new Error("expected both conflicting clues to be named as suspects")
}
console.log("GROUNDED CRITIC SMOKE TEST PASSED")
