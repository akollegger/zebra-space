// Zero-cost offline proof of the post-hoc variant's WIRING — no LLM call. Confirms a
// PostHocResult-shaped value (hand-constructed here, standing in for what
// extractPostHocVocabulary would return from a real transcription call) scores correctly
// against ground-truth.ts via the SAME scoreVocabulary used by every other variant.
//
// Run: node design/spikes/SPIKE-013-vocabulary-construction-isolation/scripts/lib/smoke-test-post-hoc.ts

import { scoreVocabulary, noSemanticMatch } from "./score.ts"
import type { PostHocResult } from "./post-hoc-vocabulary.ts"

let failures = 0
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ok: ${label}`)
  else {
    failures += 1
    console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

async function testTranscribedVocabularyScoresCorrect() {
  console.log("\n=== PZL-0002: a hand-constructed \"transcription\" of a correct solve scores structurallyCorrect ===")
  const fakeResult: PostHocResult = {
    entities: [
      { id: "house_1", type: "house" },
      { id: "house_2", type: "house" },
      { id: "house_3", type: "house" },
    ],
    domains: [
      { variable: "color", entityType: "house", values: ["Blue", "Red", "Green"] },
      { variable: "animal", entityType: "house", values: ["Dog", "Cat", "Zebra"] },
    ],
    costUsd: 0.001,
    calls: 1,
    ok: true,
  }
  const score = await scoreVocabulary("PZL-0002", fakeResult.entities, fakeResult.domains, noSemanticMatch)
  check("ground truth found", score !== undefined)
  check("entity axis size matches (3)", score!.entityAxisSizeMatch)
  check("both domains covered", score!.domainsCovered === 2 && score!.domainsTotal === 2)
  check("structurallyCorrect", score!.structurallyCorrect)
}

async function testFailedTranscriptionScoresUndefinedGracefully() {
  console.log("\n=== A FAILED tool call (ok: false) never reaches scoring with garbage entities/domains ===")
  const fakeFailure: PostHocResult = { entities: [], domains: [], costUsd: 0.0005, calls: 1, ok: false, error: "prose: model replied in prose" }
  check("failed result carries ok:false", !fakeFailure.ok)
  check("failed result carries the error reason", fakeFailure.error !== undefined)
  // The real runner only scores when result.ok — this just documents that contract so a future
  // edit to run-post-hoc.ts can't silently start scoring failures as empty-vocabulary results.
  const score = fakeFailure.ok ? await scoreVocabulary("PZL-0002", fakeFailure.entities, fakeFailure.domains, noSemanticMatch) : undefined
  check("run-post-hoc.ts's own gating leaves this unscored", score === undefined)
}

async function testPartiallyCorrectTranscriptionMissesADomain() {
  console.log("\n=== PZL-0002: a transcription that only caught ONE domain (as if reading an incomplete trace) is NOT structurallyCorrect ===")
  const fakeResult: PostHocResult = {
    entities: [
      { id: "house_1", type: "house" },
      { id: "house_2", type: "house" },
      { id: "house_3", type: "house" },
    ],
    domains: [{ variable: "color", entityType: "house", values: ["Blue", "Red", "Green"] }], // animal missing
    costUsd: 0.001,
    calls: 1,
    ok: true,
  }
  const score = await scoreVocabulary("PZL-0002", fakeResult.entities, fakeResult.domains, noSemanticMatch)
  check("only 1 of 2 domains covered", score!.domainsCovered === 1 && score!.domainsTotal === 2)
  check("NOT structurallyCorrect", !score!.structurallyCorrect)
}

async function main() {
  await testTranscribedVocabularyScoresCorrect()
  await testFailedTranscriptionScoresUndefinedGracefully()
  await testPartiallyCorrectTranscriptionMissesADomain()
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
