import { generateClueTools } from "./clue-schema.ts"
import { requestClueConstraints } from "./tool-call.ts"

const vocab = {
  entities: [{ id: "H1", type: "House" }, { id: "H2", type: "House" }],
  domains: [{ variable: "color", entityType: "House", values: ["Red", "Blue"] }],
}
const tools = generateClueTools(vocab)

// Stub server's respondWithJson wraps ONE tool call keyed off request.schemaName. For a
// multi-tool request there's no single schemaName to key off (tool_choice is "required", not a
// named function), so respond with a raw tool_calls array directly via a small local stub —
// the shared stub-server helper assumes a single forced tool and doesn't fit this shape.
import { createServer } from "node:http"
const server = createServer((req, res) => {
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({
      id: "x", object: "chat.completion", created: 0, model: "test-model", system_fingerprint: null,
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [
        { id: "c1", type: "function", function: { name: "assignment", arguments: JSON.stringify({ kind: "assignment", entity: "H1", variable: "color", value: "Red" }) } },
      ] } }],
    }))
  })
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
const address = server.address() as { port: number }
process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = `http://127.0.0.1:${address.port}`
process.env.OPENROUTER_API_KEY = "test-key"

const result = await requestClueConstraints({
  model: "test-model",
  systemPrompt: "test",
  userPrompt: "The red house is house 1.",
  tools,
})
console.log(JSON.stringify(result, null, 1))
server.close()
if (!result.ok || result.calls.length !== 1 || !result.calls[0]!.ok) throw new Error("expected one valid assignment call")
console.log("MULTI-TOOL SMOKE TEST PASSED")
