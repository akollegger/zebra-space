// Zero-cost regression test for the compiler-identifier-alignment fix (PR #28 review): two
// proposal strings differing ONLY in hyphen-vs-underscore punctuation ("arrival-order" vs
// "arrival_order") must be treated as the SAME identifier by reconciliation, because they both
// sanitize to the identical MiniZinc identifier once compile.ts processes them — an earlier
// hand-rolled sanitizer kept hyphens as a distinct allowed character and let these stay separate.
import { reconcile } from "./reconcile.ts"
import type { VocabularyProposal } from "./propose-vocabulary.ts"

const proposals: VocabularyProposal[] = [
  { clueIndex: 0, entityMentions: [{ surfaceForm: "car a", typeGuess: "car" }], domainMentions: [{ attributeNameGuess: "arrival-order", entityTypeGuess: "car", valueMentioned: "first", isOrderingHint: false }] },
  { clueIndex: 1, entityMentions: [{ surfaceForm: "car b", typeGuess: "car" }], domainMentions: [{ attributeNameGuess: "arrival_order", entityTypeGuess: "car", valueMentioned: "second", isOrderingHint: false }] },
]

const { vocabulary } = reconcile(proposals)
console.log(JSON.stringify(vocabulary.domains, null, 1))

const arrivalOrderDomains = vocabulary.domains.filter((d) => d.variable === "arrival_order")
if (arrivalOrderDomains.length !== 1) {
  throw new Error(`REGRESSION: expected "arrival-order" and "arrival_order" to merge into one domain, got ${arrivalOrderDomains.length}: ${JSON.stringify(vocabulary.domains)}`)
}
if (arrivalOrderDomains[0]!.values.length !== 2) {
  throw new Error(`expected both proposals' values to merge into one domain, got ${JSON.stringify(arrivalOrderDomains[0]!.values)}`)
}
console.log("PUNCTUATION-EQUIVALENCE SMOKE TEST PASSED — hyphen/underscore variants merge into one domain")
