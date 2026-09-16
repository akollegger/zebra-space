// Zero-cost offline proof of the `formalize-mzn` variant's VERIFICATION segment (solve ->
// grade, no compile() involved at all) — no network, no LLM call. `formalizeToMinizinc` itself
// is proven live in a small dry-run instead, same split as smoke-test-formalize-json.ts. This
// confirms a hand-written, already-known-correct MiniZinc model for PZL-0002 — as if Stage 2
// had already returned exactly this text — solves uniquely and grades MATCH against the real
// eval/answer-keys.json, WITHOUT any entity-keyed-array recovery step (there's no ExtractedCsp
// to recover from for this variant — grading works directly off whatever names the model chose).
//
// Run: node design/spikes/SPIKE-014-informal-reasoning-formalization/scripts/lib/smoke-test-formalize-mzn.ts

import { Effect } from "effect"
import { solve } from "../../../../../src/solver/solve.ts"
import { loadAnswerKeys } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { gradeSolved } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/grade.ts"

let failures = 0
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ok: ${label}`)
  else {
    failures += 1
    console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

async function testHandWrittenPzl0002MinizincSolvesAndMatches() {
  console.log("\n=== PZL-0002: a hand-written, already-known-correct MiniZinc model (as if formalize-mzn returned it) solves/grades MATCH ===")
  // Same fixture puzzle as smoke-test-formalize-json.ts, written directly as MiniZinc instead of
  // via ExtractedCsp+compile() — the point of this variant.
  const mzn = [
    'include "globals.mzn";',
    "enum Color = {Blue, Red, Green};",
    "enum Animal = {Dog, Cat, Zebra};",
    "array[1..3] of var Color: color;",
    "array[1..3] of var Animal: animal;",
    "constraint alldifferent(color);",
    "constraint alldifferent(animal);",
    "constraint color[2] = Red;",
    "constraint animal[2] = Cat;",
    "constraint color[1] = Blue;",
    "constraint animal[1] = Dog;",
  ].join("\n")

  const result = await Effect.runPromise(solve({ model: mzn }))
  check("solves uniquely", result._tag === "UniquelySolvable", result._tag)
  if (result._tag !== "UniquelySolvable") return

  const answerKeys = await loadAnswerKeys()
  // No recoverEntityKeyedArrays — grading works directly off the raw assignment, exactly as
  // run-formalize-mzn.ts does.
  const graded = gradeSolved("PZL-0002", answerKeys["PZL-0002"], result)
  check("grades MATCH against the real answer key", graded.verdict === "MATCH", JSON.stringify(graded))
}

async function main() {
  await testHandWrittenPzl0002MinizincSolvesAndMatches()
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
