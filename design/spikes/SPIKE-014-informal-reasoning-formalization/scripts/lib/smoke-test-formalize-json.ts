// Zero-cost offline proof of the `formalize-json` variant's VERIFICATION segment (compile ->
// solve -> grade) — no network, no LLM call. `formalizeToExtractedCsp` itself (the one new,
// network-touching call) is proven live in a small dry-run instead, the same split every prior
// spike in this line has used (offline tests for deterministic plumbing, a live dry-run before
// any billed sweep). This confirms a hand-built, already-known-correct ExtractedCsp for PZL-0002
// — as if Stage 2 had already returned exactly this — compiles, solves uniquely, and grades
// MATCH against the real eval/answer-keys.json, via the SAME sequence run-formalize-json.ts uses.
//
// Run: node design/spikes/SPIKE-014-informal-reasoning-formalization/scripts/lib/smoke-test-formalize-json.ts

import { Effect } from "effect"
import { compile } from "../../../../../src/compiler/compile.ts"
import { solve } from "../../../../../src/solver/solve.ts"
import { extractedCspJsonSchema } from "../../../../../src/extraction/types.ts"
import { loadAnswerKeys } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { gradeSolved, recoverEntityKeyedArrays } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/grade.ts"
import type { ExtractedCsp } from "../../../../../src/extraction/types.ts"

let failures = 0
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ok: ${label}`)
  else {
    failures += 1
    console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

function testSchemaWiresUp() {
  console.log("\n=== extractedCspJsonSchema (the real production schema) imports and looks sane ===")
  check("has a properties object", typeof extractedCspJsonSchema.properties === "object")
  const props = extractedCspJsonSchema.properties as Record<string, unknown>
  check("declares entities/domains/constraints", "entities" in props && "domains" in props && "constraints" in props)
}

async function testHandBuiltPzl0002FormalizationCompilesSolvesAndMatches() {
  console.log("\n=== PZL-0002: a hand-built, already-known-correct ExtractedCsp (as if formalize-json returned it) compiles/solves/grades MATCH ===")
  // PZL-0002's own clues: the Cat lives in the Red house; the Red house is the middle house; the
  // Blue house is directly left of the Red house; the Dog lives in the Blue house. Unique answer:
  // house1=Blue/Dog, house2=Red/Cat, house3=Green/Zebra.
  const csp: ExtractedCsp = {
    entities: [
      { id: "house1", type: "house" },
      { id: "house2", type: "house" },
      { id: "house3", type: "house" },
    ],
    domains: [
      { variable: "color", entityType: "house", values: ["Blue", "Red", "Green"] },
      { variable: "animal", entityType: "house", values: ["Dog", "Cat", "Zebra"] },
      // adjacency needs a shared numeric positional domain (compile.ts's own requirement,
      // confirmed live here — SPIKE-012's smoke-test-shape.ts hit the same thing) — house1/2/3
      // have no inherent position otherwise, since "house1"/"house2" are just entity ids.
      { variable: "position", entityType: "house", values: ["1", "2", "3"] },
    ],
    constraints: [
      { kind: "assignment", entity: "house1", variable: "position", value: "1" },
      { kind: "assignment", entity: "house2", variable: "position", value: "2" },
      { kind: "assignment", entity: "house3", variable: "position", value: "3" },
      // Domains don't imply an automatic all-different bijection across entities (confirmed
      // live here) — every house's color/animal needs its own explicit assignment, matching
      // SPIKE-012's own smoke-test-shape.ts fixture exactly, not just the two houses a clue
      // names directly.
      { kind: "assignment", entity: "house2", variable: "color", value: "Red" },
      { kind: "assignment", entity: "house2", variable: "animal", value: "Cat" },
      { kind: "assignment", entity: "house1", variable: "color", value: "Blue" },
      { kind: "assignment", entity: "house3", variable: "color", value: "Green" },
      { kind: "adjacency", relation: "directly left of", a: "house1", b: "house2", variable: null },
      { kind: "assignment", entity: "house1", variable: "animal", value: "Dog" },
      { kind: "assignment", entity: "house3", variable: "animal", value: "Zebra" },
    ],
  }

  const mzn = await Effect.runPromise(compile(csp))
  check("compiles", mzn.length > 0)
  const result = await Effect.runPromise(solve({ model: mzn }))
  check("solves uniquely", result._tag === "UniquelySolvable", result._tag)
  if (result._tag !== "UniquelySolvable") return

  const answerKeys = await loadAnswerKeys()
  const recovered = { ...result, assignment: recoverEntityKeyedArrays("PZL-0002", result.assignment, csp) }
  const graded = gradeSolved("PZL-0002", answerKeys["PZL-0002"], recovered)
  check("grades MATCH against the real answer key", graded.verdict === "MATCH", JSON.stringify(graded))
}

async function main() {
  testSchemaWiresUp()
  await testHandBuiltPzl0002FormalizationCompilesSolvesAndMatches()
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
