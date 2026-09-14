// Zero-cost regression test for the entity-type/domain-value identifier-collision fix (live
// 2026-09-15, PZL-0010: MiniZinc rejected "identifier `car' already defined" because an entity
// TYPE "car" and a domain VALUE "car" both sanitized to the same identifier).
import { reconcile } from "./reconcile.ts"
import type { VocabularyProposal } from "./propose-vocabulary.ts"

const proposals: VocabularyProposal[] = [
  // Entities of type "car".
  { clueIndex: 0, entityMentions: [{ surfaceForm: "car one", typeGuess: "car" }], domainMentions: [{ attributeNameGuess: "arrival-order", entityTypeGuess: "car", valueMentioned: "first", isOrderingHint: false }] },
  { clueIndex: 1, entityMentions: [{ surfaceForm: "car two", typeGuess: "car" }], domainMentions: [] },
  // A DIFFERENT domain whose VALUE is literally "car".
  { clueIndex: 2, entityMentions: [{ surfaceForm: "the pedestrian", typeGuess: "vehicle" }], domainMentions: [{ attributeNameGuess: "goes-before", entityTypeGuess: "vehicle", valueMentioned: "car", isOrderingHint: false }] },
]

const { vocabulary } = reconcile(proposals)
console.log(JSON.stringify(vocabulary, null, 1))

const entityTypeNames = new Set(vocabulary.entities.map((e) => e.type))
const allValueTokens = new Set(vocabulary.domains.flatMap((d) => d.values.map((v) => v.trim().toLowerCase())))
for (const type of entityTypeNames) {
  if (allValueTokens.has(type.toLowerCase())) throw new Error(`REGRESSION: entity type "${type}" still collides with a domain value`)
}
console.log("TYPE-VALUE COLLISION SMOKE TEST PASSED")
