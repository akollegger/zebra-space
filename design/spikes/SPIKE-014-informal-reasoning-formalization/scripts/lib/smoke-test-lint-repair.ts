// Zero-cost offline proof of applyFindings — the deterministic, code-driven patch application
// that's the whole point of this variant (§5.5's diagnosis: full-file regeneration has no
// guarantee the untouched parts stay untouched; exact-match replacement does, by construction).
// No network, no LLM call — `lintMinizinc` itself is proven live in a small dry-run instead.
//
// Run: node design/spikes/SPIKE-014-informal-reasoning-formalization/scripts/lib/smoke-test-lint-repair.ts

import { applyFindings, type LintFinding } from "./mzn-lint-repair.ts"

let failures = 0
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ok: ${label}`)
  else {
    failures += 1
    console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

function testSingleFindingApplies() {
  console.log("\n=== a single, uniquely-matching finding applies cleanly ===")
  const mzn = "constraint alldifferent(color);\nconstraint x = 1;"
  const findings: readonly LintFinding[] = [{ locate: "x = 1", issue: "wrong value", suggestedFix: "x = 2" }]
  const result = applyFindings(mzn, findings)
  check("applied 1", result.applied === 1)
  check("skipped 0", result.skipped.length === 0)
  check("draft updated", result.mzn === "constraint alldifferent(color);\nconstraint x = 2;")
}

function testUntouchedPartsStayByteForByteIdentical() {
  console.log("\n=== everything outside the matched region stays untouched — the whole point of this variant ===")
  const mzn = [
    "enum COLOR = {Blue, Red, Green};",
    "array[1..3] of var COLOR: color;",
    "constraint color[1] = Blue;",
    "constraint color[2] = Red;",
  ].join("\n")
  const findings: readonly LintFinding[] = [{ locate: "constraint color[2] = Red;", issue: "wrong house", suggestedFix: "constraint color[3] = Red;" }]
  const result = applyFindings(mzn, findings)
  const expectedLines = [
    "enum COLOR = {Blue, Red, Green};",
    "array[1..3] of var COLOR: color;",
    "constraint color[1] = Blue;",
    "constraint color[3] = Red;",
  ].join("\n")
  check("only the targeted line changed, rest byte-for-byte identical", result.mzn === expectedLines, result.mzn)
}

function testNonUniqueLocateIsSkippedNotGuessed() {
  console.log("\n=== a locate string matching MORE than once is skipped, never guessed (mirrors the Edit tool's own contract) ===")
  const mzn = "constraint x = 1;\nconstraint x = 1;\nconstraint y = 2;"
  const findings: readonly LintFinding[] = [{ locate: "constraint x = 1;", issue: "ambiguous", suggestedFix: "constraint x = 5;" }]
  const result = applyFindings(mzn, findings)
  check("nothing applied", result.applied === 0)
  check("one skip recorded", result.skipped.length === 1 && result.skipped[0]!.reason.includes("2 times"))
  check("draft unchanged", result.mzn === mzn)
}

function testMissingLocateIsSkippedNotGuessed() {
  console.log("\n=== a locate string that isn't in the draft at all is skipped, never guessed ===")
  const mzn = "constraint x = 1;"
  const findings: readonly LintFinding[] = [{ locate: "constraint z = 9;", issue: "hallucinated snippet", suggestedFix: "constraint z = 10;" }]
  const result = applyFindings(mzn, findings)
  check("nothing applied", result.applied === 0)
  check("one skip recorded, reason names it as not found", result.skipped.length === 1 && result.skipped[0]!.reason.includes("not found"))
  check("draft unchanged", result.mzn === mzn)
}

function testMultipleFindingsApplySequentially() {
  console.log("\n=== multiple findings apply in order, each seeing the PRIOR finding's already-patched draft ===")
  const mzn = "constraint a = 1;\nconstraint b = 2;"
  const findings: readonly LintFinding[] = [
    { locate: "constraint a = 1;", issue: "wrong", suggestedFix: "constraint a = 10;" },
    { locate: "constraint b = 2;", issue: "wrong", suggestedFix: "constraint b = 20;" },
  ]
  const result = applyFindings(mzn, findings)
  check("both applied", result.applied === 2)
  check("both edits present", result.mzn === "constraint a = 10;\nconstraint b = 20;")
}

async function main() {
  testSingleFindingApplies()
  testUntouchedPartsStayByteForByteIdentical()
  testNonUniqueLocateIsSkippedNotGuessed()
  testMissingLocateIsSkippedNotGuessed()
  testMultipleFindingsApplySequentially()
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
