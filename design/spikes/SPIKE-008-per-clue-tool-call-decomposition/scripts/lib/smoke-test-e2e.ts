// Zero-cost end-to-end smoke test: per-clue extraction -> compile -> solve, against a stub
// server, on a tiny synthetic 2-entity/1-domain puzzle. Proves the whole loop (vocabulary call,
// two per-clue calls, assembly, compile, solve) works before any real API spend.
import { createServer } from "node:http"
import { extractPerClue } from "./per-clue-extract.ts"
import { compile } from "../../../../../src/compiler/compile.ts"
import { solve } from "../../../../../src/solver/solve.ts"
import { Effect } from "effect"

const PROSE = `Two houses stand in a row, numbered 1 and 2.

1. The red house is house 1.
2. The blue house is not house 1.

Which house is blue?`

let callIndex = 0
const server = createServer((req, res) => {
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", () => {
    const parsed = JSON.parse(body)
    const toolChoice = parsed.tool_choice
    const forcedName = typeof toolChoice === "object" ? toolChoice?.function?.name : undefined
    callIndex += 1
    let toolCalls: unknown[]
    if (forcedName === "ExtractedVocabulary") {
      toolCalls = [{ id: "c1", type: "function", function: { name: "ExtractedVocabulary", arguments: JSON.stringify({
        entities: [{ id: "H1", type: "House" }, { id: "H2", type: "House" }],
        domains: [{ variable: "color", entityType: "House", values: ["Red", "Blue"] }],
      }) } }]
    } else if (callIndex === 2) {
      // Clue 1: "The red house is house 1." -> linkedAttributes (no entity named directly by id,
      // "house 1" resolves to H1 only via positional convention - use assignment since H1 IS the
      // known id here for this synthetic test).
      toolCalls = [{ id: "c2", type: "function", function: { name: "assignment", arguments: JSON.stringify({ kind: "assignment", entity: "H1", variable: "color", value: "Red" }) } }]
    } else {
      // Clue 2: "The blue house is not house 1." -> arithmetic !=
      toolCalls = [{ id: "c3", type: "function", function: { name: "arithmetic", arguments: JSON.stringify({
        kind: "arithmetic",
        expression: { kind: "variableRef", variable: "color", entity: "H1" },
        comparator: "!=",
        target: "Blue",
      }) } }]
    }
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({
      id: "x", object: "chat.completion", created: 0, model: "test-model", system_fingerprint: null,
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: toolCalls } }],
    }))
  })
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
const address = server.address() as { port: number }
process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = `http://127.0.0.1:${address.port}`
process.env.OPENROUTER_API_KEY = "test-key"

const result = await extractPerClue(PROSE, "test-model")
console.log("extraction:", JSON.stringify(result, null, 1))

const mzn = await Effect.runPromise(compile(result.extractedCsp))
console.log("--- MZN ---\n" + mzn)

const solveResult = await Effect.runPromise(solve({ model: mzn }))
console.log("--- SOLVE ---", JSON.stringify(solveResult))

server.close()
// This synthetic 2-clue puzzle is deliberately underconstrained (no allDifferent between H1/H2)
// — MultiplySatisfiable is the CORRECT outcome here, not a mechanism failure. The point of this
// smoke test is proving compile succeeded at all (a wrong assembly would throw a CompileError
// long before reaching the solver), which it did.
if (solveResult._tag !== "MultiplySatisfiable" && solveResult._tag !== "UniquelySolvable") {
  throw new Error(`expected a solved outcome (this puzzle is intentionally underconstrained), got ${solveResult._tag}`)
}
console.log("E2E SMOKE TEST PASSED — total calls:", result.totalCalls, "decomposable:", result.decomposable)
