// Zero-cost offline proof of all four sub-question lib modules' plumbing — no network, no Jev
// call. Each module accepts an injectable `askFn` (jev-client.ts's `AskFn`) so a stub response
// can stand in for a real systemOne call; this only proves request/response wiring and scoring
// logic, never Jev's actual judgment quality (that needs live calls, run separately per module).
//
// Run: node design/spikes/SPIKE-016-typesafe-jev-evaluation/scripts/lib/smoke-test-jev.ts

import type { AskFn } from "./jev-client.ts"
import { classifyOutcomeFraming } from "./outcome-framing-gate.ts"
import { checkClueLocalization, extractConstraintLines } from "./per-clue-fidelity.ts"
import { judgeEquivalence } from "./pairwise-equivalence.ts"
import { judgeWellFormedDecomposed } from "./wellformed-decomposed.ts"

let failures = 0
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ok: ${label}`)
  else {
    failures += 1
    console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

function stubAsk(fixedNoulOrChoice: Record<string, { noul?: number; choice?: string; confidence?: number; probabilities?: Record<string, number> }>): AskFn {
  return (async (_state, questions) => {
    const answers: Record<string, unknown> = {}
    for (const name of Object.keys(questions)) {
      const q = questions[name]!
      const fixed = fixedNoulOrChoice[name]
      if (q.type === "noul") answers[name] = { type: "noul", noul: fixed?.noul ?? 0.9 }
      else if (q.type === "choice") {
        const choice = fixed?.choice ?? Object.keys(q.criteria)[0]!
        answers[name] = { type: "choice", choice, confidence: fixed?.confidence ?? 0.9, probabilities: fixed?.probabilities ?? { [choice]: 1 } }
      }
    }
    return { ok: true, result: { model: "stub", answers, usage: { input_tokens: 1, output_tokens: 1 } }, latencyMs: 1 } as never
  }) as AskFn
}

async function testPairwiseEquivalence() {
  console.log("\n=== pairwise-equivalence: plumbing ===")
  const stub = stubAsk({ sameValue: { noul: 0.95 } })
  const verdict = await judgeEquivalence({ a: "move", b: "action", contextHint: "a board game", source: "named-miss", expected: true }, stub)
  check("jevMatch true when noul >= 0.5", verdict.jevMatch === true)
  check("noul value passed through", verdict.noul === 0.95)
}

async function testWellFormedDecomposed() {
  console.log("\n=== wellformed-decomposed: AND-gate logic ===")
  const allTrue = stubAsk({ noLeftoverOldValue: { noul: 0.9 }, grammaticallyCorrect: { noul: 0.9 }, sameLogicalStructure: { noul: 0.9 } })
  const r1 = await judgeWellFormedDecomposed("orig", "sub", [{ oldValue: "a", newValue: "b" }], allTrue)
  check("all-true Nouls AND-gate to wellFormed=true", r1.wellFormed === true)

  const oneFalse = stubAsk({ noLeftoverOldValue: { noul: 0.9 }, grammaticallyCorrect: { noul: 0.1 }, sameLogicalStructure: { noul: 0.9 } })
  const r2 = await judgeWellFormedDecomposed("orig", "sub", [{ oldValue: "a", newValue: "b" }], oneFalse)
  check("one false Noul AND-gates to wellFormed=false", r2.wellFormed === false)
}

async function testOutcomeFramingGate() {
  console.log("\n=== outcome-framing-gate: response mapping ===")
  const stub = stubAsk({ framing: { choice: "cop", confidence: 0.8, probabilities: { determinate: 0.1, cop: 0.8, ambiguous: 0.05, subjective: 0.03, "non-problem": 0.02 } } })
  const result = await classifyOutcomeFraming("PZL-TEST", "some prose", "cop", stub)
  check("predicted class passed through", result.predicted === "cop")
  check("confidence passed through", result.confidence === 0.8)
}

async function testPerClueFidelityExtraction() {
  console.log("\n=== per-clue-fidelity: constraint-line extraction ===")
  const mzn = 'include "globals.mzn";\nenum X = {A, B};\nconstraint alldifferent(order);\nconstraint order[1] = A /\\ order[2] = B;\n'
  const lines = extractConstraintLines(mzn)
  check("extracts exactly 2 constraint statements", lines.length === 2, `got ${lines.length}: ${JSON.stringify(lines)}`)
  check("first line is the alldifferent constraint", lines[0] === "constraint alldifferent(order);")

  const selectThenJudgeTrue = stubAsk({ addressedBy: { choice: "line0" }, fullyCaptures: { noul: 0.95 } })
  const localized = await checkClueLocalization("all positions differ", lines, selectThenJudgeTrue)
  check("select-then-judge picks index 0 with high fidelity", localized.selectedIndices[0] === 0 && (localized.fidelityNoul ?? 0) > 0.5)

  const noneSelected = stubAsk({ addressedBy: { choice: "__none__" } })
  const dropped = await checkClueLocalization("a clue with no matching constraint", lines, noneSelected)
  check("no-match selection reports empty selectedIndices (a possible drop)", dropped.selectedIndices.length === 0 && dropped.fidelityNoul === undefined)
}

async function main() {
  await testPairwiseEquivalence()
  await testWellFormedDecomposed()
  await testOutcomeFramingGate()
  await testPerClueFidelityExtraction()

  console.log(failures === 0 ? "\nAll smoke checks passed." : `\n${failures} smoke check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
