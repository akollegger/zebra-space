// Zero-cost regression test for the identifier-sanitization fix (live 2026-09-15: OpenAI
// rejected a tool name built from an unsanitized attributeNameGuess containing a space,
// "Invalid 'tools[4].function.name': string does not match pattern...^[a-zA-Z0-9_-]+$").
import { reconcile } from "./reconcile.ts"
import type { VocabularyProposal } from "./propose-vocabulary.ts"

const proposals: VocabularyProposal[] = [
  { clueIndex: 0, entityMentions: [{ surfaceForm: "the first person", typeGuess: "person type!" }], domainMentions: [{ attributeNameGuess: "smoking preference", entityTypeGuess: "person type!", valueMentioned: "Pipe", isOrderingHint: false }] },
  { clueIndex: 1, entityMentions: [{ surfaceForm: "another person", typeGuess: "person type!" }], domainMentions: [{ attributeNameGuess: "smoking preference", entityTypeGuess: "person type!", valueMentioned: "Cigar", isOrderingHint: true }] },
]

const { vocabulary } = reconcile(proposals)
console.log(JSON.stringify(vocabulary, null, 1))

const idPattern = /^[a-zA-Z0-9_-]+$/
for (const e of vocabulary.entities) {
  if (!idPattern.test(e.id)) throw new Error(`entity id "${e.id}" is not a safe identifier`)
  if (!idPattern.test(e.type)) throw new Error(`entity type "${e.type}" is not a safe identifier`)
}
for (const d of vocabulary.domains) {
  if (!idPattern.test(d.variable)) throw new Error(`domain variable "${d.variable}" is not a safe identifier`)
  if (!idPattern.test(d.entityType)) throw new Error(`domain entityType "${d.entityType}" is not a safe identifier`)
}
console.log("SANITIZE SMOKE TEST PASSED")
