// Zero-cost end-to-end smoke test of the full orchestration (propose -> reconcile -> extract ->
// filter -> assemble -> compile -> solve) against a stub server. A synthetic 3-clue puzzle whose
// third clue is an ordering/adjacency clue with NO independently-declared position domain — the
// PZL-0001 shape — proving the whole pipeline, not just reconcile.ts in isolation, produces a
// compilable model where SPIKE-008's plain per-clue pipeline would have failed.
import { createServer } from "node:http"
import { Effect } from "effect"
import { extractWithReconciliation } from "./vocabulary-reconciled-extract.ts"
import { compile } from "../../../../../src/compiler/compile.ts"
import { solve } from "../../../../../src/solver/solve.ts"

const PROSE = `Three houses stand in a row.

1. The red house is house 1.
2. The blue house is house 2.
3. The green house is directly right of the blue house.`

let vocabCallIndex = 0
let constraintCallIndex = 0

const server = createServer((req, res) => {
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", () => {
    const parsed = JSON.parse(body)
    const toolNames: string[] = (parsed.tools ?? []).map((t: { function: { name: string } }) => t.function.name)
    const isVocabProposal = toolNames.includes("proposeVocabulary")
    let toolCalls: unknown[]

    if (isVocabProposal) {
      vocabCallIndex += 1
      const responses = [
        { entityMentions: [{ surfaceForm: "house 1", typeGuess: "house", canonicalIdGuess: "h1" }], domainMentions: [{ attributeNameGuess: "color", entityTypeGuess: "house", valueMentioned: "Red", isOrderingHint: false }] },
        { entityMentions: [{ surfaceForm: "house 2", typeGuess: "house", canonicalIdGuess: "h2" }], domainMentions: [{ attributeNameGuess: "color", entityTypeGuess: "house", valueMentioned: "Blue", isOrderingHint: false }] },
        { entityMentions: [{ surfaceForm: "the green house", typeGuess: "house" }], domainMentions: [{ attributeNameGuess: "color", entityTypeGuess: "house", valueMentioned: "Green", isOrderingHint: true }] },
      ]
      const args = responses[vocabCallIndex - 1]!
      toolCalls = [{ id: `v${vocabCallIndex}`, type: "function", function: { name: "proposeVocabulary", arguments: JSON.stringify(args) } }]
    } else {
      constraintCallIndex += 1
      // Constraint calls arrive AFTER all vocab calls (phase 1 then phase 3) — clue order
      // repeats: clue1(assignment h1=Red), clue2(assignment h2=Blue), clue3(adjacency).
      // Reconcile.ts assigns ids positionally within each type bucket in first-encountered
      // order (house1, house2, house3 — see reconcile.ts's mergeEntities) regardless of any
      // canonicalIdGuess text, so this mock must reference THOSE generated ids, not the
      // proposal-stage surface hints ("h1"/"h2") — house1 <- clue0's "h1", house2 <- clue1's
      // "h2", house3 <- clue2's "the green house".
      const assignmentToolName = toolNames.find((n) => n.startsWith("assignment__"))!
      const responses = [
        { toolName: assignmentToolName, args: { kind: "assignment", entity: "house1", variable: "color", value: "Red" } },
        { toolName: assignmentToolName, args: { kind: "assignment", entity: "house2", variable: "color", value: "Blue" } },
        { toolName: "adjacency", args: { kind: "adjacency", relation: "directly right of", a: "house3", b: "house2", variable: "color_position" } },
      ]
      const resp = responses[constraintCallIndex - 1]!
      toolCalls = [{ id: `c${constraintCallIndex}`, type: "function", function: { name: resp.toolName, arguments: JSON.stringify(resp.args) } }]
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

const result = await extractWithReconciliation(PROSE, "test-model")
console.log(JSON.stringify(result, null, 1))
server.close()

const mzn = await Effect.runPromise(compile(result.extractedCsp))
console.log("--- MZN ---\n" + mzn)
const solveResult = await Effect.runPromise(solve({ model: mzn }))
console.log("--- SOLVE ---", JSON.stringify(solveResult))

if (result.totalCalls !== 6) throw new Error(`expected 6 total calls (3 vocab + 3 constraint), got ${result.totalCalls}`)
if (solveResult._tag !== "UniquelySolvable" && solveResult._tag !== "MultiplySatisfiable") {
  throw new Error(`expected a solved outcome, got ${solveResult._tag}`)
}
console.log("E2E SMOKE TEST PASSED — full orchestration produced a compilable model")
