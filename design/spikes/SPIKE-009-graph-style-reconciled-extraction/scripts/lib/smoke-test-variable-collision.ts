// Zero-cost regression test for the variable-name-collision fix (live 2026-09-15, PZL-0010:
// MiniZinc rejected the compiled model with "identifier `arrival_order' already defined" because
// reconciliation had produced two different domains — for entity types "vehicle" and "car" — that
// both got the literal variable name "arrival-order").
import { reconcile } from "./reconcile.ts"
import type { VocabularyProposal } from "./propose-vocabulary.ts"

const proposals: VocabularyProposal[] = [
  { clueIndex: 0, entityMentions: [{ surfaceForm: "vehicle a", typeGuess: "vehicle" }], domainMentions: [{ attributeNameGuess: "arrival-order", entityTypeGuess: "vehicle", valueMentioned: "first", isOrderingHint: false }] },
  { clueIndex: 1, entityMentions: [{ surfaceForm: "car b", typeGuess: "car" }], domainMentions: [{ attributeNameGuess: "arrival-order", entityTypeGuess: "car", valueMentioned: "second", isOrderingHint: false }] },
]

const { vocabulary } = reconcile(proposals)
console.log(JSON.stringify(vocabulary.domains, null, 1))

const variableNames = vocabulary.domains.map((d) => d.variable)
const uniqueNames = new Set(variableNames)
if (uniqueNames.size !== variableNames.length) {
  throw new Error(`REGRESSION: duplicate domain variable names: ${variableNames.join(", ")}`)
}
console.log("VARIABLE-COLLISION SMOKE TEST PASSED — all domain variable names are unique")
