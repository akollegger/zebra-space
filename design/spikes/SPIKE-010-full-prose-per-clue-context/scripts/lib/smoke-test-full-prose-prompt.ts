// Zero-cost regression test: fullProseClueSystemPrompt must include every clue's text (not just
// the target's) plus an unambiguous marker for which clue is the extraction target — the whole
// point of this spike's one change vs. SPIKE-008's per-clue prompt.
import { fullProseClueSystemPrompt } from "./full-prose-extract.ts"
import type { Vocabulary } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/clue-schema.ts"

const vocabulary: Vocabulary = {
  entities: [{ id: "house1", type: "house" }],
  domains: [{ variable: "color", entityType: "house", values: ["red", "blue"] }],
}
const clues = [
  "1. The red house is immediately left of the blue house.",
  "2. Chesterfields are smoked in the first house.",
  "3. The fox is kept in a house next to the horse.",
]

const prompt = fullProseClueSystemPrompt(vocabulary, "Five houses in a row.", clues, 2)

console.log(prompt)

if (!prompt.includes(clues[0]!)) throw new Error("REGRESSION: prompt is missing clue 0's text — full prose was not included")
if (!prompt.includes(clues[1]!)) throw new Error("REGRESSION: prompt is missing clue 1's text — full prose was not included")
if (!prompt.includes(clues[2]!)) throw new Error("REGRESSION: prompt is missing the target clue's own text")
if (!prompt.includes("<-- TARGET")) throw new Error("REGRESSION: prompt has no unambiguous target-clue marker")
if (!prompt.includes("[2] <-- TARGET")) throw new Error("REGRESSION: target marker is not attached to the correct clue index")
if (prompt.includes("[0] <-- TARGET") || prompt.includes("[1] <-- TARGET")) throw new Error("REGRESSION: a non-target clue was marked as the target")

console.log("FULL-PROSE-PROMPT SMOKE TEST PASSED")
