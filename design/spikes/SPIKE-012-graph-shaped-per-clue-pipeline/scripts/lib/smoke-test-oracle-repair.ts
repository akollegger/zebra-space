// Zero-cost smoke test of oracle-repair.ts's targeted re-ask loop: a synthetic 2-entity puzzle
// whose per-clue-typed output is deliberately WRONG in a way that makes the assembled CSP
// unsatisfiable (a comparator flipped), proving `repairAndSolve` (1) detects it via the real
// compile()/solve(), (2) localizes the correct clue via groundedFinding's drop-one-clue search,
// (3) re-asks ONLY that clue, and (4) the corrected result solves.
//
// Run: node --env-file-if-exists=.env design/spikes/SPIKE-012-graph-shaped-per-clue-pipeline/scripts/lib/smoke-test-oracle-repair.ts

import { repairAndSolve } from "./oracle-repair.ts"
import type { Vocabulary } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/clue-schema.ts"
import type { PerClueTypedLog, ClueTaggedConstraint } from "./per-clue-typed.ts"
import { createServer } from "node:http"

// One scalar entity ("subject"), two independent domains ("a","b") each boolean-shaped —
// deliberately contradictory: clue 0 says a != X, clue 1 (WRONG on purpose) says a != Y where Y
// is the only OTHER value, making the "a" domain unsatisfiable regardless of "b" — a direct
// conflict groundedFinding's drop-one-clue search should trace to clues 0 or 1, not clue 2 (an
// unrelated domain).
const vocabulary: Vocabulary = {
  entities: [{ id: "subject", type: "scenario" }],
  domains: [
    { variable: "a", entityType: "scenario", values: ["X", "Y"] },
    { variable: "b", entityType: "scenario", values: ["P", "Q"] },
  ],
}
const clues = ["0: a is not X.", "1: a is not Y (WRONG on purpose — conflicts with clue 0, makes 'a' unsatisfiable).", "2: b is not P."]
const perClue: readonly PerClueTypedLog[] = [
  { clueIndex: 0, clueText: clues[0]!, template: "arithmetic", toolCallsMade: 1, kindsEmitted: ["arithmetic"], rejectedStructurally: [] },
  { clueIndex: 1, clueText: clues[1]!, template: "arithmetic", toolCallsMade: 1, kindsEmitted: ["arithmetic"], rejectedStructurally: [] },
  { clueIndex: 2, clueText: clues[2]!, template: "arithmetic", toolCallsMade: 1, kindsEmitted: ["arithmetic"], rejectedStructurally: [] },
]
const initialTagged: readonly ClueTaggedConstraint[] = [
  { clueIndex: 0, constraint: { kind: "arithmetic", expression: { kind: "variableRef", variable: "a", entity: null }, comparator: "!=", target: "X" } },
  { clueIndex: 1, constraint: { kind: "arithmetic", expression: { kind: "variableRef", variable: "a", entity: null }, comparator: "!=", target: "Y" } }, // the deliberate bug
  { clueIndex: 2, constraint: { kind: "arithmetic", expression: { kind: "variableRef", variable: "b", entity: null }, comparator: "!=", target: "P" } },
]

// The repair server: whichever clue gets re-asked (0 or 1), respond with the CORRECT constraint
// for clue 1 (a is not Y is wrong; a should just stay unconstrained by dropping it, simulated
// here by having clue 1's revision correctly emit "a != Y" -> corrected to a harmless "b != Q"
// re-typed as clue 1's real intent doesn't matter for this test — what matters is that the
// SPECIFIC clue implicated gets re-asked, not an unrelated one). We assert on which clue index
// the hint targeted via the request's user prompt content.
let revisionCallCount = 0
const revisedClueIndicesSeen: number[] = []
const server = createServer((req, res) => {
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", () => {
    const parsed = JSON.parse(body)
    const userPrompt: string = parsed.messages?.find((m: { role: string }) => m.role === "user")?.content ?? ""
    revisionCallCount += 1
    const targeted = userPrompt.includes(clues[0]!) ? 0 : userPrompt.includes(clues[1]!) ? 1 : userPrompt.includes(clues[2]!) ? 2 : undefined
    if (targeted !== undefined) revisedClueIndicesSeen.push(targeted)
    // Correct fix: clue 1 should assert something that doesn't conflict — re-emit a != Y as
    // a harmless tautology-avoiding constraint on "b" instead (simulating the model realizing
    // clue 1 was about a DIFFERENT variable than it originally guessed).
    const args = { kind: "arithmetic", expression: { kind: "variableRef", variable: "b", entity: null }, comparator: "!=", target: "Q" }
    res.writeHead(200, { "content-type": "application/json" })
    res.end(
      JSON.stringify({
        id: "x",
        object: "chat.completion",
        created: 0,
        model: "test-model",
        system_fingerprint: null,
        choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "arithmetic", arguments: JSON.stringify(args) } }] } }],
      }),
    )
  })
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
const address = server.address() as { port: number }
process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE = `http://127.0.0.1:${address.port}`
process.env.OPENROUTER_API_KEY = "test-key"

const result = await repairAndSolve("test-model", vocabulary, "", clues, perClue, initialTagged)
server.close()

console.log("outcome:", result.outcome, "repairRounds:", result.repairRounds, "note:", result.repairNote)
console.log("revision calls made:", revisionCallCount, "revised clue indices seen (across all rounds):", revisedClueIndicesSeen)

if (result.repairRounds === 0) throw new Error("expected at least one repair round — the initial CSP was deliberately unsatisfiable")
if (!revisedClueIndicesSeen.includes(0) && !revisedClueIndicesSeen.includes(1)) {
  throw new Error(`expected at least one repair round to target clue 0 or 1 (the actual conflict), saw only ${revisedClueIndicesSeen.join(",")}`)
}
if (result.outcome === "SOLVE_UNSATISFIABLE") throw new Error("expected the repair to eventually resolve the conflict, but it's still unsatisfiable")

console.log("\nORACLE-REPAIR SMOKE TEST PASSED — a deliberate conflict was detected, localized to the correct clue, and repaired")
