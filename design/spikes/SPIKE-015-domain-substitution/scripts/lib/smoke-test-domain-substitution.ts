// Zero-cost offline proof of SPIKE-015's mechanical pieces — no network, no LLM call. Mirrors
// SPIKE-014's smoke-test-formalize-mzn.ts check()/main() pattern. Must pass before any live call.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { solve } from "../../../../../src/solver/solve.ts"
import { applyMappingToProse } from "./apply-to-prose.ts"
import { applyMappingToMzn } from "./apply-to-mzn.ts"
import { scoreDomainMatch } from "./score-domain-match.ts"
import { groundTruthFor } from "../../../SPIKE-013-vocabulary-construction-isolation/scripts/lib/ground-truth.ts"
import type { DomainMappingProposal } from "./mapping-schema.ts"

let failures = 0
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ok: ${label}`)
  else {
    failures += 1
    console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

function readSeedMzn(fileName: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../../../catalog/mzn/${fileName}`, import.meta.url)), "utf8")
}

async function testApplyMappingToProse() {
  console.log("\n=== applyMappingToProse: every occurrence of a repeated value is replaced ===")
  const prose = "The Blue House is left of the Red House. Blue is a calm color."
  const result = applyMappingToProse(prose, [{ oldValue: "Blue", newValue: "Purple" }])
  check("no 'Blue' remains", !result.includes("Blue"), result)
  check("both occurrences became 'Purple'", result.split("Purple").length - 1 === 2, result)

  // Found live 2026-09-18 (SPIKE.md §5.5): the seed's own reported casing can differ from a
  // capitalized sentence-initial occurrence of the same value elsewhere in the prose
  // (PZL-0003's "paper-rock-scissors" intro vs. "Paper beats rock." rules) — must match
  // case-insensitively and preserve each match's own casing on the replacement.
  const mixedCaseProse = "You're playing paper-rock-scissors.\n1. Paper beats rock.\n2. ROCK beats scissors."
  const mixedCaseResult = applyMappingToProse(mixedCaseProse, [
    { oldValue: "paper", newValue: "water" },
    { oldValue: "rock", newValue: "fire" },
    { oldValue: "scissors", newValue: "air" },
  ])
  check("lowercase intro occurrence replaced", mixedCaseResult.includes("water-fire-air"), mixedCaseResult)
  check("capitalized sentence-initial occurrence replaced with matching capitalization", mixedCaseResult.includes("Water beats fire."), mixedCaseResult)
  check("all-caps occurrence replaced with matching all-caps", mixedCaseResult.includes("FIRE beats air."), mixedCaseResult)
  check("no old values remain in any casing", !/paper|rock|scissors/i.test(mixedCaseResult), mixedCaseResult)

  // Regression found live 2026-09-18, same debugging session: matching case-insensitively
  // WITHOUT word boundaries makes a short oldValue match inside an unrelated word — "Red"
  // case-insensitively matches the "red" inside "numbeRed" ("...numbered 1 to 3..."),
  // corrupting it to "numbeOrange". Word boundaries (\b) fix this without reintroducing the
  // case-sensitivity bug above.
  const wordBoundaryProse = "Three houses stand in a row, numbered 1 to 3. The Red House is first."
  const wordBoundaryResult = applyMappingToProse(wordBoundaryProse, [{ oldValue: "Red", newValue: "Orange" }])
  check("unrelated word containing the old value as a substring is untouched", wordBoundaryResult.includes("numbered 1 to 3"), wordBoundaryResult)
  check("the real standalone occurrence is still replaced", wordBoundaryResult.includes("The Orange House is first."), wordBoundaryResult)
}

async function testApplyMappingToMznAndSolve() {
  console.log("\n=== applyMappingToMzn: PZL-0002's real seed .mzn, substituted COLOR domain, still solves uniquely ===")
  const mzn = readSeedMzn("PZL-0002-context-graphs-example.mzn")
  const mapping = [
    { oldValue: "Blue", newValue: "Purple" },
    { oldValue: "Red", newValue: "Crimson" },
    { oldValue: "Green", newValue: "Olive" },
  ]
  const { mzn: substituted, applied, skipped } = applyMappingToMzn(mzn, mapping)
  check("all 3 mapping entries applied", applied === 3, `applied=${applied}`)
  check("nothing skipped", skipped.length === 0, JSON.stringify(skipped))
  check("no old color names remain", !/Blue|Red|Green/.test(substituted), substituted)

  const result = await Effect.runPromise(solve({ model: substituted }).pipe(Effect.catch((e) => Effect.succeed({ _tag: "ERR" as const, e }))))
  check("solves uniquely", result._tag === "UniquelySolvable", result._tag)
  if (result._tag === "UniquelySolvable") {
    const a = result.assignment as Record<string, unknown>
    const color = a.color as readonly { e: string }[]
    check("color[1] renamed Blue->Purple", color[0]?.e === "Purple", JSON.stringify(color))
    check("color[2] renamed Red->Crimson", color[1]?.e === "Crimson", JSON.stringify(color))
    check("color[3] renamed Green->Olive", color[2]?.e === "Olive", JSON.stringify(color))
  }
}

async function testApplyMappingToMznNoEnums() {
  console.log("\n=== applyMappingToMzn: PZL-0007's real seed .mzn has no enums — every entry skipped with a clear reason ===")
  const mzn = readSeedMzn("PZL-0007-send-more-money.mzn")
  const { applied, skipped } = applyMappingToMzn(mzn, [{ oldValue: "9", newValue: "1" }])
  check("nothing applied", applied === 0, `applied=${applied}`)
  check("skipped with the no-enum reason", skipped.length === 1 && skipped[0]!.reason === "no enum declarations in this .mzn", JSON.stringify(skipped))
}

async function testScoreDomainMatch() {
  console.log("\n=== scoreDomainMatch: exact match, missing value, invented value, wrong domain — against PZL-0002's real ground truth ===")
  const groundTruth = groundTruthFor("PZL-0002")
  if (groundTruth === undefined) {
    failures += 1
    console.error("  FAIL: PZL-0002 ground truth not found")
    return
  }

  const exact: DomainMappingProposal = {
    domain: "color",
    currentValues: ["Blue", "Red", "Green"],
    mapping: [
      { oldValue: "Blue", newValue: "Purple" },
      { oldValue: "Red", newValue: "Crimson" },
      { oldValue: "Green", newValue: "Olive" },
    ],
  }
  check("exact match", scoreDomainMatch(exact, groundTruth).matched === true)

  const missing: DomainMappingProposal = { domain: "color", currentValues: ["Blue", "Red"], mapping: [] }
  const missingResult = scoreDomainMatch(missing, groundTruth)
  check("missing value: not matched", missingResult.matched === false)
  check("missing value: reason names it", missingResult.reason.includes("missing"), missingResult.reason)

  const invented: DomainMappingProposal = { domain: "color", currentValues: ["Blue", "Red", "Green", "Purple"], mapping: [] }
  const inventedResult = scoreDomainMatch(invented, groundTruth)
  check("invented value: not matched", inventedResult.matched === false)
  check("invented value: reason names it", inventedResult.reason.includes("invented"), inventedResult.reason)

  const wrongDomain: DomainMappingProposal = { domain: "size", currentValues: ["Small", "Large"], mapping: [] }
  const wrongDomainResult = scoreDomainMatch(wrongDomain, groundTruth)
  check("wrong domain values: not matched", wrongDomainResult.matched === false)
  check("wrong domain values: reason names the closest candidate", wrongDomainResult.reason.includes("closest expected domain"), wrongDomainResult.reason)

  // Name-matching is dropped as a scoring GATE (2026-09-18, per user decision — see this file's
  // header): neither a plain pluralization ("colors"), nor a qualifier word ("game color"), nor
  // a completely unrelated/wrong name ("shade") should sink an otherwise-correct value set,
  // because the downstream mechanism (apply-to-prose.ts/apply-to-mzn.ts) never reads the domain
  // name at all. All three now match on value-set alone; only the `reason` text differs to note
  // whether the name happened to resemble ground truth's own name.
  const correctValues = {
    currentValues: ["Blue", "Red", "Green"],
    mapping: [
      { oldValue: "Blue", newValue: "Purple" },
      { oldValue: "Red", newValue: "Crimson" },
      { oldValue: "Green", newValue: "Olive" },
    ],
  }
  const pluralName: DomainMappingProposal = { domain: "colors", ...correctValues }
  check("plural name with correct values: matched", scoreDomainMatch(pluralName, groundTruth).matched === true)

  const qualifierName: DomainMappingProposal = { domain: "game color", ...correctValues }
  const qualifierResult = scoreDomainMatch(qualifierName, groundTruth)
  check("qualifier name with correct values: matched", qualifierResult.matched === true)
  check("qualifier name with correct values: reason notes the name mismatch as informational", qualifierResult.reason.includes("informational only"), qualifierResult.reason)

  const unrelatedName: DomainMappingProposal = { domain: "shade", ...correctValues }
  const unrelatedNameResult = scoreDomainMatch(unrelatedName, groundTruth)
  check("unrelated name with correct values: matched", unrelatedNameResult.matched === true)
  check("unrelated name with correct values: reason notes the name mismatch as informational", unrelatedNameResult.reason.includes("informational only"), unrelatedNameResult.reason)

  const exactNameResult = scoreDomainMatch(exact, groundTruth)
  check("exact name with correct values: reason doesn't say informational (no mismatch to note)", !exactNameResult.reason.includes("informational"), exactNameResult.reason)
}

// judge-substitution.ts (the well-formedness critic that replaced the direct-mzn verifier — see
// SPIKE.md §5.5) makes a real LLM call, so it has no offline smoke-test coverage here, the same
// as request-mapping.ts's requestDomainMapping — both are exercised live by the billed run.

async function main() {
  await testApplyMappingToProse()
  await testApplyMappingToMznAndSolve()
  await testApplyMappingToMznNoEnums()
  await testScoreDomainMatch()
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
