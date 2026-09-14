import { createServer } from "node:http"
import { proposeVocabulary } from "./propose-vocabulary.ts"

const server = createServer((req, res) => {
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({
      id: "x", object: "chat.completion", created: 0, model: "test-model", system_fingerprint: null,
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [
        { id: "c1", type: "function", function: { name: "proposeVocabulary", arguments: JSON.stringify({
          entityMentions: [{ surfaceForm: "house 2", typeGuess: "house", canonicalIdGuess: "house2" }, { surfaceForm: "house 3", typeGuess: "house", canonicalIdGuess: "house3" }],
          domainMentions: [{ attributeNameGuess: "position", entityTypeGuess: "house", valueMentioned: "adjacent", isOrderingHint: true }],
        }) } },
      ] } }],
    }))
  })
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
const address = server.address() as { port: number }
process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = `http://127.0.0.1:${address.port}`
process.env.OPENROUTER_API_KEY = "test-key"

const { proposal, costUsd } = await proposeVocabulary("test-model", 2, "3. House 2 is directly left of house 3.")
console.log(JSON.stringify({ proposal, costUsd }, null, 1))
server.close()

if (proposal.entityMentions.length !== 2) throw new Error("expected 2 entity mentions")
if (proposal.domainMentions[0]?.isOrderingHint !== true) throw new Error("expected isOrderingHint true")
console.log("PROPOSE-VOCABULARY SMOKE TEST PASSED")
