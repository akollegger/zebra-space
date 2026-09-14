// Zero-cost offline test: synthetic VocabularyProposal fixtures reproducing the PZL-0001
// (adjacency with no shared ordering domain) and PZL-0010 (allDifferent/ordering attribute
// wrongly modeled as scalar — no entities ever independently proposed for it) failure shapes,
// confirming reconcile() closes both structurally.
import { reconcile } from "./reconcile.ts"
import type { VocabularyProposal } from "./propose-vocabulary.ts"

// --- PZL-0010-like: an ordering attribute with NO independently-proposed entities ------------
// Mirrors "allDifferent requires an entity-indexed variable; 'arrival-order' has only one
// entity." — three clues each assert one car's arrival-order value, no clue ever proposes a
// "vehicle" entity directly (only the values themselves are ever mentioned).
const pzl0010: VocabularyProposal[] = [
  { clueIndex: 0, entityMentions: [], domainMentions: [{ attributeNameGuess: "arrival-order", entityTypeGuess: "vehicle", valueMentioned: "red-car", isOrderingHint: true }] },
  { clueIndex: 1, entityMentions: [], domainMentions: [{ attributeNameGuess: "arrival-order", entityTypeGuess: "vehicle", valueMentioned: "blue-car", isOrderingHint: true }] },
  { clueIndex: 2, entityMentions: [], domainMentions: [{ attributeNameGuess: "arrival-order", entityTypeGuess: "vehicle", valueMentioned: "green-car", isOrderingHint: true }] },
]

const result0010 = reconcile(pzl0010)
console.log("=== PZL-0010-like ===")
console.log(JSON.stringify(result0010.vocabulary, null, 1))

const vehicleEntities = result0010.vocabulary.entities.filter((e) => e.type === "vehicle")
if (vehicleEntities.length !== 3) throw new Error(`expected 3 synthesized vehicle entities, got ${vehicleEntities.length}`)
const positionalDomain0010 = result0010.vocabulary.domains.find((d) => d.variable === "arrival-order-position")
if (positionalDomain0010 === undefined) throw new Error("expected a synthesized arrival-order-position domain")
if (positionalDomain0010.values.length !== 3) throw new Error(`expected 3 positional values, got ${positionalDomain0010.values.length}`)
console.log("PZL-0010-like: entity-indexed ordering domain correctly synthesized")

// --- PZL-0001-like: an adjacency/ordering hint with entities already named, but no shared ----
// ordered domain declared anywhere else for that type.
const pzl0001: VocabularyProposal[] = [
  { clueIndex: 0, entityMentions: [{ surfaceForm: "the chesterfields smoker", typeGuess: "house", canonicalIdGuess: "h_chesterfields" }], domainMentions: [{ attributeNameGuess: "smokes", entityTypeGuess: "house", valueMentioned: "Chesterfields", isOrderingHint: false }] },
  { clueIndex: 1, entityMentions: [{ surfaceForm: "the fox owner", typeGuess: "house", canonicalIdGuess: "h_fox" }], domainMentions: [{ attributeNameGuess: "pet", entityTypeGuess: "house", valueMentioned: "fox", isOrderingHint: false }] },
  {
    clueIndex: 2,
    entityMentions: [],
    domainMentions: [{ attributeNameGuess: "adjacency-check", entityTypeGuess: "house", valueMentioned: "next-to", isOrderingHint: true }],
  },
]

const result0001 = reconcile(pzl0001)
console.log("\n=== PZL-0001-like ===")
console.log(JSON.stringify(result0001.vocabulary, null, 1))

const positionalDomain0001 = result0001.vocabulary.domains.find((d) => d.variable === "adjacency-check-position")
if (positionalDomain0001 === undefined) throw new Error("expected a synthesized adjacency-check-position domain")
// Entities h_chesterfields/h_fox already existed (2 houses) — the synthesized positional domain
// should index THOSE, not invent new ones, since entitiesOfType("house") was non-empty.
if (positionalDomain0001.values.length !== 2) throw new Error(`expected positional domain sized to the 2 already-named houses, got ${positionalDomain0001.values.length}`)
console.log("PZL-0001-like: shared ordering domain correctly synthesized over already-named entities")

console.log("\nRECONCILE SMOKE TEST PASSED")
