// Zero-cost regression test (PR #28 review): a failed vocabulary-proposal tool call (prose,
// invalid JSON, structural rejection) must be recorded as a FAILURE, not silently collapsed into
// the same empty-arrays shape a legitimate vocabulary-free clue produces.
import { proposeVocabulary } from "./propose-vocabulary.ts"
import { extractWithReconciliation } from "./vocabulary-reconciled-extract.ts"
import { createServer } from "node:http"

// Direct unit check: a stub that replies in prose (no tool call at all).
const stub1 = createServer((req, res) => {
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({
      id: "x", object: "chat.completion", created: 0, model: "test-model", system_fingerprint: null,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Sure, here is some prose instead of a tool call." } }],
    }))
  })
})
await new Promise<void>((resolve) => stub1.listen(0, "127.0.0.1", () => resolve()))
const address1 = stub1.address() as { port: number }
process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = `http://127.0.0.1:${address1.port}`
process.env.OPENROUTER_API_KEY = "test-key"

const { proposal } = await proposeVocabulary("test-model", 0, "1. Some clue.")
stub1.close()
console.log("direct proposal:", JSON.stringify(proposal))
if (proposal.failed === undefined) throw new Error("REGRESSION: a prose (non-tool-call) response was not marked as failed")
if (proposal.entityMentions.length !== 0 || proposal.domainMentions.length !== 0) throw new Error("expected empty arrays alongside the failure marker")

// End-to-end check: extractWithReconciliation surfaces the failure via failedProposals.
const stub2 = createServer((req, res) => {
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({
      id: "x", object: "chat.completion", created: 0, model: "test-model", system_fingerprint: null,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "prose, no tool call" } }],
    }))
  })
})
await new Promise<void>((resolve) => stub2.listen(0, "127.0.0.1", () => resolve()))
const address2 = stub2.address() as { port: number }
process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = `http://127.0.0.1:${address2.port}`

const result = await extractWithReconciliation("1. The red house is house 1.", "test-model")
stub2.close()
console.log("failedProposals:", JSON.stringify(result.failedProposals))
if (result.failedProposals.length !== 1) throw new Error(`REGRESSION: expected 1 failed proposal to be surfaced, got ${result.failedProposals.length}`)

console.log("FAILED-PROPOSAL SMOKE TEST PASSED")
