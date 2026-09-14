// Zero-cost smoke test for tool-call.ts + clue-schema.ts against the same stub server the real
// pipeline's CLI tests use — no real API call, no spend. Not part of the spike's findings; a
// throwaway sanity check run once while building, kept here in case it's useful again.
import { startStubServer } from "../../../../../tests/extraction/support/stub-server.ts"
import { generateClueTools } from "./clue-schema.ts"
import { requestClueTool } from "./tool-call.ts"

const vocab = {
  entities: [{ id: "H1", type: "House" }, { id: "H2", type: "House" }],
  domains: [{ variable: "color", entityType: "House", values: ["Red", "Blue"] }],
}
const tools = generateClueTools(vocab)

const stub = await startStubServer((exchange) => {
  exchange.respondWithJson({ kind: "assignment", entity: "H1", variable: "color", value: "Red" })
})
process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = stub.baseUrl
process.env.OPENROUTER_API_KEY = "test-key"

const result = await requestClueTool({
  model: "test-model",
  systemPrompt: "test",
  userPrompt: "test",
  schemaName: "assignment",
  jsonSchema: tools["assignment__color"],
})
console.log("valid case:", JSON.stringify(result))
await stub.close()

// Now test rejection of an invented value the enum doesn't declare.
const stub2 = await startStubServer((exchange) => {
  exchange.respondWithJson({ kind: "assignment", entity: "H1", variable: "color", value: "Green" })
})
process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = stub2.baseUrl
const result2 = await requestClueTool({
  model: "test-model",
  systemPrompt: "test",
  userPrompt: "test",
  schemaName: "assignment",
  jsonSchema: tools["assignment__color"],
})
console.log("invented-value case:", JSON.stringify(result2))
await stub2.close()

if (result.ok !== true) throw new Error("expected valid case to pass")
if (result2.ok !== false || result2.reason !== "structural") throw new Error("expected invented value to be rejected structurally")
console.log("SMOKE TEST PASSED")
