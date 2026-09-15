// Zero-cost end-to-end smoke test of the full orchestration (segment -> inventory -> group ->
// shape -> per-clue classify+fill -> assemble -> compile -> solve) against a stub HTTP server —
// proves the WIRING across every stage (data flows correctly, per-clue two-step typing works),
// complementing smoke-test-shape.ts's separate, more thorough proof that group.ts/shape.ts's
// deterministic vocabulary construction itself matches real puzzle shapes.
//
// Run: node --env-file-if-exists=.env design/spikes/SPIKE-012-graph-shaped-per-clue-pipeline/scripts/lib/smoke-test-e2e.ts

import { createServer } from "node:http"
import { Effect } from "effect"
import { extractGraphPipeline } from "./graph-pipeline-extract.ts"
import { compile } from "../../../../../src/compiler/compile.ts"
import { solve } from "../../../../../src/solver/solve.ts"

const PROSE = `Three houses stand in a row, numbered 1, 2, and 3.

1. House 1 is red.
2. House 3 is directly right of house 2.`

function toolNamesOf(parsed: { tools?: readonly { function: { name: string } }[] }): readonly string[] {
  return (parsed.tools ?? []).map((t) => t.function.name)
}

const server = createServer((req, res) => {
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", () => {
    const parsed = JSON.parse(body)
    const names = toolNamesOf(parsed)
    const userPrompt: string = parsed.messages?.find((m: { role: string }) => m.role === "user")?.content ?? ""
    let toolName: string
    let args: unknown

    if (names.includes("list_mentions")) {
      toolName = "list_mentions"
      args = { mentions: ["House 1", "house 2", "House 3", "red"] }
    } else if (names.includes("group_mentions")) {
      toolName = "group_mentions"
      args = { groups: [{ label: "house", member_indices: [0, 1, 2] }, { label: "color", member_indices: [3] }] }
    } else if (names.includes("classify_shape")) {
      toolName = "classify_shape"
      args = {
        classifications: [
          { group_index: 0, role: "entityAxis", entity_axis_group_index: null },
          { group_index: 1, role: "domainValues", entity_axis_group_index: 0 },
        ],
        entity_axes_needing_synthesized_ordering: [0],
      }
    } else if (names.includes("classify_clue")) {
      toolName = "classify_clue"
      args = { template: userPrompt.includes("directly right of") ? "adjacency" : "assignment" }
    } else if (names.some((n) => n.startsWith("assignment__"))) {
      toolName = names.find((n) => n.startsWith("assignment__"))!
      args = { kind: "assignment", entity: "House_1", variable: "color", value: "red" }
    } else if (names.includes("adjacency")) {
      toolName = "adjacency"
      args = { kind: "adjacency", relation: "directly right of", a: "House_3", b: "house_2", variable: "house_position" }
    } else {
      throw new Error(`smoke test: unhandled tool set: ${names.join(", ")}`)
    }

    res.writeHead(200, { "content-type": "application/json" })
    res.end(
      JSON.stringify({
        id: "x",
        object: "chat.completion",
        created: 0,
        model: "test-model",
        system_fingerprint: null,
        choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: toolName, arguments: JSON.stringify(args) } }] } }],
      }),
    )
  })
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
const address = server.address() as { port: number }
process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = `http://127.0.0.1:${address.port}`
process.env.OPENROUTER_API_KEY = "test-key"

const result = await extractGraphPipeline("test-model", PROSE)
server.close()

console.log("entities:", JSON.stringify(result.vocabulary.entities))
console.log("domains:", JSON.stringify(result.vocabulary.domains))
console.log("constraints:", JSON.stringify(result.extractedCsp.constraints))
console.log("total calls:", result.totalCalls, "stage breakdown:", JSON.stringify(result.stageBreakdown))

// Expected calls: 1 (inventory) + 1 (group) + 1 (shape) + 2 clues x 2 (classify + fill) = 7.
if (result.totalCalls !== 7) throw new Error(`expected 7 total calls, got ${result.totalCalls}`)
if (result.vocabulary.entities.length !== 3) throw new Error(`expected 3 house entities, got ${result.vocabulary.entities.length}`)
if (!result.vocabulary.domains.some((d) => d.variable === "house_position")) throw new Error("expected a synthesized house_position domain")
if (result.extractedCsp.constraints.length !== 2) throw new Error(`expected 2 constraints (1 assignment + 1 adjacency), got ${result.extractedCsp.constraints.length}`)

const mzn = await Effect.runPromise(compile(result.extractedCsp))
console.log(`--- MZN ---\n${mzn}`)
const solveResult = await Effect.runPromise(solve({ model: mzn }))
console.log("--- SOLVE ---", JSON.stringify(solveResult))
if (solveResult._tag === "Unsatisfiable") throw new Error("expected a satisfiable outcome")

console.log("\nE2E SMOKE TEST PASSED — full orchestration (inventory->group->shape->per-clue-typed) produced a compilable, solvable model")
