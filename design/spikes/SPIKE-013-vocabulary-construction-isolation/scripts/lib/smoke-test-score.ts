// Zero-cost offline proof of score.ts's matching logic against ground-truth.ts — exact/
// normalized matching only (no embeddings involved), covering the correct case, a wrong case,
// and PZL-0038's dual-valueSet OR logic (an isomorphic pair of representations, either correct).
//
// Run: node design/spikes/SPIKE-013-vocabulary-construction-isolation/scripts/lib/smoke-test-score.ts

import { scoreVocabulary, noSemanticMatch } from "./score.ts"

let failures = 0
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ok: ${label}`)
  else {
    failures += 1
    console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

async function testCorrectCase() {
  console.log("\n=== PZL-0002: correct vocabulary scores structurallyCorrect ===")
  const entities = [
    { id: "h1", type: "house" },
    { id: "h2", type: "house" },
    { id: "h3", type: "house" },
  ]
  const domains = [
    { variable: "color", entityType: "house", values: ["Blue", "Red", "Green"] },
    { variable: "animal", entityType: "house", values: ["Dog", "Cat", "Zebra"] },
  ]
  const score = await scoreVocabulary("PZL-0002", entities, domains, noSemanticMatch)
  check("ground truth found", score !== undefined)
  check("entity axis size matches (3)", score!.entityAxisSizeMatch)
  check("both domains covered", score!.domainsCovered === 2 && score!.domainsTotal === 2)
  check("structurallyCorrect", score!.structurallyCorrect)
}

async function testWrongCase() {
  console.log("\n=== PZL-0002: missing a domain scores NOT structurallyCorrect ===")
  const entities = [
    { id: "h1", type: "house" },
    { id: "h2", type: "house" },
    { id: "h3", type: "house" },
  ]
  const domains = [{ variable: "color", entityType: "house", values: ["Blue", "Red", "Green"] }] // animal missing
  const score = await scoreVocabulary("PZL-0002", entities, domains, noSemanticMatch)
  check("only 1 of 2 domains covered", score!.domainsCovered === 1 && score!.domainsTotal === 2)
  check("NOT structurallyCorrect", !score!.structurallyCorrect)
}

async function testCaseFoldMatch() {
  console.log("\n=== PZL-0002: casing/naming drift still matches via normalization ===")
  const entities = [
    { id: "h1", type: "house" },
    { id: "h2", type: "house" },
    { id: "h3", type: "house" },
  ]
  const domains = [
    { variable: "Color", entityType: "house", values: ["blue", "red", "green"] }, // different case throughout
    { variable: "animal", entityType: "house", values: ["Dog", "Cat", "Zebra"] },
  ]
  const score = await scoreVocabulary("PZL-0002", entities, domains, noSemanticMatch)
  check("casing drift on name AND values still matches", score!.structurallyCorrect)
}

async function testIsomorphicOrLogic() {
  console.log("\n=== PZL-0038: EITHER of two isomorphic representations scores correct ===")
  const entitiesAsAnimals = [
    { id: "wolf", type: "animal" },
    { id: "rabbit", type: "animal" },
    { id: "goat", type: "animal" },
    { id: "parrot", type: "animal" },
    { id: "tortoise", type: "animal" },
  ]
  const domainsPenValues = [{ variable: "pen", entityType: "animal", values: ["1", "2", "3", "4", "5"] }]
  const scoreA = await scoreVocabulary("PZL-0038", entitiesAsAnimals, domainsPenValues, noSemanticMatch)
  check("animal-entities + pen(1-5) domain scores correct", scoreA!.structurallyCorrect)

  const entitiesAsPens = [
    { id: "pen1", type: "pen" },
    { id: "pen2", type: "pen" },
    { id: "pen3", type: "pen" },
    { id: "pen4", type: "pen" },
    { id: "pen5", type: "pen" },
  ]
  const domainsAnimalValues = [{ variable: "animal", entityType: "pen", values: ["tortoise", "parrot", "goat", "rabbit", "wolf"] }]
  const scoreB = await scoreVocabulary("PZL-0038", entitiesAsPens, domainsAnimalValues, noSemanticMatch)
  check("pen-entities + animal(names) domain ALSO scores correct (the inverse representation)", scoreB!.structurallyCorrect)
}

async function testExtraDomainsNeverPenalized() {
  console.log("\n=== PZL-0010: an extra domain beyond ground truth is never penalized (coverage, not exact match) ===")
  const entities = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, type: "traveler" }))
  const domains = [
    { variable: "order", entityType: "traveler", values: ["South", "Pedestrian", "East", "North", "West"] },
    { variable: "arrivalTime", entityType: "traveler", values: ["1", "2", "3"] }, // extra, not in ground truth
  ]
  const score = await scoreVocabulary("PZL-0010", entities, domains, noSemanticMatch)
  check("still structurallyCorrect despite the extra domain", score!.structurallyCorrect)
}

async function main() {
  await testCorrectCase()
  await testWrongCase()
  await testCaseFoldMatch()
  await testIsomorphicOrLogic()
  await testExtraDomainsNeverPenalized()
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
