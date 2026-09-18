// Zero-cost offline proof of SPIKE-015's mechanical pieces — no network, no LLM call. Mirrors
// SPIKE-014's smoke-test-formalize-mzn.ts check()/main() pattern. Must pass before any live call.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { solve } from "../../../../../src/solver/solve.ts"
import { applyMappingToProse } from "./apply-to-prose.ts"
import { applyMappingToMzn } from "./apply-to-mzn.ts"
import { gradeAgainstMechanicalTruth } from "./grade-against-truth.ts"
import { scoreDomainMatch } from "./score-domain-match.ts"
import { groundTruthFor } from "../../../SPIKE-013-vocabulary-construction-isolation/scripts/lib/ground-truth.ts"
import type { DomainMappingProposal } from "./mapping-schema.ts"
import type { Assignment } from "../../../../../src/solver/types.ts"

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
    return { substitutedMzn: substituted, trueAssignment: result.assignment }
  }
  return undefined
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
  check("wrong domain name: not matched", wrongDomainResult.matched === false)
  check("wrong domain name: reason says so", wrongDomainResult.reason.includes("no expected domain"), wrongDomainResult.reason)

  // Found live 2026-09-18 (PZL-0003): a plain pluralization should not sink an otherwise-correct
  // value set. Migrated to the shared fold (ADR-011): plain pluralization matches "for free"
  // (comparisonKey's fold), the same as it would for `stringsMatch` anywhere else in the
  // codebase.
  const nearMissName: DomainMappingProposal = {
    domain: "colors",
    currentValues: ["Blue", "Red", "Green"],
    mapping: [
      { oldValue: "Blue", newValue: "Purple" },
      { oldValue: "Red", newValue: "Crimson" },
      { oldValue: "Green", newValue: "Olive" },
    ],
  }
  check("plural near-miss name with correct values: matched", scoreDomainMatch(nearMissName, groundTruth).matched === true)

  // A qualifier word ("game color") is a DIFFERENT gap than plain pluralization: it is not
  // covered by the deterministic fold alone (ADR-011 §2.1 only folds case/whitespace/plural),
  // so — unlike under the old ad-hoc substring-containment heuristic this file used to have —
  // it no longer auto-matches. It matches only once curated as an explicit variant in this
  // domain's own `names` list, exactly like any other domain-name alias (ADR-011 §2.2).
  const qualifierWithoutCuration: DomainMappingProposal = { ...nearMissName, domain: "game color" }
  const qualifierUncuratedResult = scoreDomainMatch(qualifierWithoutCuration, groundTruth)
  check("uncurated qualifier name with correct values: not matched", qualifierUncuratedResult.matched === false, qualifierUncuratedResult.reason)

  const curatedGroundTruth = {
    ...groundTruth,
    domains: groundTruth.domains.map((domain) => ({
      alternatives: domain.alternatives.map((alt) => (alt.names.includes("color") ? { ...alt, names: [...alt.names, "game color"] } : alt)),
    })),
  }
  check("curated qualifier variant with correct values: matched", scoreDomainMatch(qualifierWithoutCuration, curatedGroundTruth).matched === true)

  // Values exactly match a real domain, but the proposed name doesn't resemble it at all — a
  // distinct, informative near-miss, never silently folded into "nothing matched at all".
  const valuesMatchUnrelatedName: DomainMappingProposal = { domain: "shade", currentValues: ["Blue", "Red", "Green"], mapping: [] }
  const unrelatedNameResult = scoreDomainMatch(valuesMatchUnrelatedName, groundTruth)
  check("values match but name unrelated: not matched", unrelatedNameResult.matched === false)
  check("values match but name unrelated: reason is distinct", unrelatedNameResult.reason.includes("currentValues exactly match"), unrelatedNameResult.reason)
}

async function testGradeAgainstMechanicalTruth(seeded: { substitutedMzn: string; trueAssignment: Assignment } | undefined) {
  console.log("\n=== gradeAgainstMechanicalTruth: a solved assignment graded against itself is MATCH (validates the {e:...} unwrap fix) ===")
  if (seeded === undefined) {
    failures += 1
    console.error("  FAIL: no seeded assignment from the previous check to grade")
    return
  }
  const resolved = await Effect.runPromise(
    solve({ model: seeded.substitutedMzn }).pipe(Effect.catch((e) => Effect.succeed({ _tag: "ERR" as const, e }))),
  )
  check("re-solves uniquely", resolved._tag === "UniquelySolvable", resolved._tag)
  if (resolved._tag === "UniquelySolvable") {
    const graded = gradeAgainstMechanicalTruth("PZL-0002", seeded.trueAssignment, resolved)
    check("grades MATCH against itself", graded.verdict === "MATCH", JSON.stringify(graded))
  }
}

async function main() {
  await testApplyMappingToProse()
  const seeded = await testApplyMappingToMznAndSolve()
  await testApplyMappingToMznNoEnums()
  await testScoreDomainMatch()
  await testGradeAgainstMechanicalTruth(seeded)
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
