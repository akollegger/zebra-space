// SPIKE-015 §2: the billed run. For each seed puzzle, per rep: the model identifies-and-remaps
// ONE domain from raw prose alone (no domain list) -> score against groundTruthFor before
// applying anything -> mechanically apply the mapping to prose (literal) and the seed .mzn
// (fold-matched enum rewrite) -> solve the substituted .mzn for a zero-extra-cost true answer ->
// independently verify via direct-mzn on the substituted prose, graded against that true answer.
//
// PZL-0007 is deliberately excluded (no enum declarations at all — not a valid seed for this
// single-named-domain variant, confirmed by the smoke test). Verification uses direct-mzn only,
// not direct-solve (mechanical solve+grade, no judge call, already fully validated in SPIKE-014).
//
// Usage: node --env-file-if-exists=.env design/spikes/SPIKE-015-domain-substitution/scripts/run-domain-substitution.ts
// REPS=<n> overrides the default of 3. MODEL=<model> overrides the default gpt-4o-mini.

import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { writeFile, mkdir } from "node:fs/promises"
import { Effect } from "effect"
import { solve } from "../../../../src/solver/solve.ts"
import { loadPuzzleProse } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { groundTruthFor } from "../../SPIKE-013-vocabulary-construction-isolation/scripts/lib/ground-truth.ts"
import { directFormalizeToMinizinc } from "../../SPIKE-014-informal-reasoning-formalization/scripts/lib/direct-formalize.ts"
import { requestDomainMapping } from "./lib/request-mapping.ts"
import { scoreDomainMatch } from "./lib/score-domain-match.ts"
import { applyMappingToProse } from "./lib/apply-to-prose.ts"
import { applyMappingToMzn } from "./lib/apply-to-mzn.ts"
import { gradeAgainstMechanicalTruth } from "./lib/grade-against-truth.ts"
import type { SolveResult, SolverError } from "../../../../src/solver/types.ts"

const MODEL = process.env.MODEL ?? "openai/gpt-4o-mini"
const REPS = Number(process.env.REPS ?? 3)

// PZL-0007 deliberately excluded — no enum declarations at all (see SPIKE.md §2 step 1 / the
// smoke test's testApplyMappingToMznNoEnums), not a valid seed for this variant.
const SEED_PUZZLE_IDS = ["PZL-0002", "PZL-0003"]

const MZN_DIR = new URL("../../../../catalog/mzn/", import.meta.url)

function readSeedMzn(puzzleId: string): string {
  const dir = fileURLToPath(MZN_DIR)
  const file = readdirSync(dir).find((f) => f.startsWith(`${puzzleId}-`) && f.endsWith(".mzn"))
  if (file === undefined) throw new Error(`no seed .mzn found for ${puzzleId} in ${dir}`)
  return readFileSync(new URL(file, MZN_DIR), "utf8")
}

function solveErrorDetail(error: SolverError): string {
  switch (error._tag) {
    case "ToolchainUnavailable":
      return `${error._tag}: ${error.message}`
    case "ModelSyntaxError":
      return `${error._tag}: ${error.stderr.slice(0, 200)}`
    case "SolverConfigError":
      return `${error._tag}: solver "${error.solverId}": ${error.stderr.slice(0, 200)}`
    case "Timeout":
      return `${error._tag}: timed out after ${error.timeoutMs}ms`
    case "UnexpectedExit":
      return `${error._tag}: exit ${error.exitCode}: ${error.stderr.slice(0, 200)}`
    case "UnexpectedOutput":
      return `${error._tag}: ${error.message}`
    case "FilesystemError":
      return `${error._tag}: ${error.message}`
  }
}

async function trySolve(model: string): Promise<{ ok: true; result: SolveResult } | { ok: false; detail: string }> {
  const solved = await Effect.runPromise(
    solve({ model }).pipe(
      Effect.map((r) => ({ ok: true as const, result: r })),
      Effect.catch((e) => Effect.succeed({ ok: false as const, detail: solveErrorDetail(e) })),
    ),
  )
  return solved
}

interface RepOutcome {
  readonly outcome: string
  readonly detail: string
  readonly mappingCostUsd: number | undefined
  readonly verifierCostUsd?: number | undefined
  readonly domainMatchReason?: string
  readonly mznApplied?: number
  readonly mznSkipped?: readonly { readonly oldValue: string; readonly newValue: string; readonly reason: string }[]
  readonly verifierVerdict?: string
  readonly substitutedProse?: string
}

async function runOne(puzzleId: string, prose: string, seedMzn: string): Promise<RepOutcome> {
  const groundTruth = groundTruthFor(puzzleId)
  if (groundTruth === undefined) {
    return { outcome: "NO_GROUND_TRUTH", detail: `no groundTruth frontmatter for ${puzzleId}`, mappingCostUsd: undefined }
  }

  const mapped = await requestDomainMapping(MODEL, prose)
  if (!mapped.ok || mapped.proposal === undefined) {
    return { outcome: "MAPPING_CALL_FAILED", detail: mapped.error ?? "unknown", mappingCostUsd: mapped.costUsd }
  }
  const proposal = mapped.proposal

  const match = scoreDomainMatch(proposal, groundTruth)
  if (!match.matched) {
    return { outcome: "DOMAIN_MATCH_FAILED", detail: match.reason, mappingCostUsd: mapped.costUsd, domainMatchReason: match.reason }
  }

  const substitutedProse = applyMappingToProse(prose, proposal.mapping)
  const { mzn: substitutedMzn, applied, skipped } = applyMappingToMzn(seedMzn, proposal.mapping)
  if (applied === 0) {
    return {
      outcome: "MZN_APPLY_TOTAL_FAILURE",
      detail: "no mapping entries applied to the seed .mzn",
      mappingCostUsd: mapped.costUsd,
      domainMatchReason: match.reason,
      mznApplied: applied,
      mznSkipped: skipped,
    }
  }

  const truth = await trySolve(substitutedMzn)
  if (!truth.ok) {
    return {
      outcome: "SUBSTITUTED_MZN_SOLVE_ERROR",
      detail: truth.detail,
      mappingCostUsd: mapped.costUsd,
      domainMatchReason: match.reason,
      mznApplied: applied,
      mznSkipped: skipped,
    }
  }
  if (truth.result._tag !== "UniquelySolvable") {
    return {
      outcome: "SUBSTITUTED_MZN_NOT_UNIQUE",
      detail: `substitution broke unique-solvability: ${truth.result._tag}`,
      mappingCostUsd: mapped.costUsd,
      domainMatchReason: match.reason,
      mznApplied: applied,
      mznSkipped: skipped,
    }
  }
  const trueAssignment = truth.result.assignment

  const verifierFormalized = await directFormalizeToMinizinc(MODEL, substitutedProse)
  if (!verifierFormalized.ok || verifierFormalized.mzn === undefined) {
    return {
      outcome: "VERIFIER_FORMALIZE_FAILED",
      detail: verifierFormalized.error ?? "unknown",
      mappingCostUsd: mapped.costUsd,
      verifierCostUsd: verifierFormalized.costUsd,
      domainMatchReason: match.reason,
      mznApplied: applied,
      mznSkipped: skipped,
      substitutedProse,
    }
  }

  const verifierSolved = await trySolve(verifierFormalized.mzn)
  if (!verifierSolved.ok) {
    return {
      outcome: "VERIFIER_SOLVE_ERROR",
      detail: verifierSolved.detail,
      mappingCostUsd: mapped.costUsd,
      verifierCostUsd: verifierFormalized.costUsd,
      domainMatchReason: match.reason,
      mznApplied: applied,
      mznSkipped: skipped,
      substitutedProse,
    }
  }

  const graded = gradeAgainstMechanicalTruth(puzzleId, trueAssignment, verifierSolved.result)
  return {
    outcome: "VERIFIED",
    detail: graded.detail,
    mappingCostUsd: mapped.costUsd,
    verifierCostUsd: verifierFormalized.costUsd,
    domainMatchReason: match.reason,
    mznApplied: applied,
    mznSkipped: skipped,
    verifierVerdict: graded.verdict,
    substitutedProse,
  }
}

async function main(): Promise<void> {
  const outDir = new URL("results/", import.meta.url)
  await mkdir(outDir, { recursive: true })
  const modelTag = MODEL.replace(/[^a-zA-Z0-9]+/g, "-")
  const outPath = new URL(`domain-substitution-${modelTag}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, outDir)

  const records: unknown[] = []
  let grandTotalCost = 0

  for (const puzzleId of SEED_PUZZLE_IDS) {
    console.log(`\n=== ${puzzleId} ===`)
    const { prose } = await loadPuzzleProse(puzzleId)
    const seedMzn = readSeedMzn(puzzleId)

    const reps: RepOutcome[] = []
    for (let rep = 0; rep < REPS; rep++) {
      const result = await runOne(puzzleId, prose, seedMzn)
      reps.push(result)
      const cost = (result.mappingCostUsd ?? 0) + (result.verifierCostUsd ?? 0)
      grandTotalCost += cost
      console.log(`  [${rep + 1}/${REPS}]: ${result.outcome} verdict=${result.verifierVerdict ?? "N/A"} cost=${cost.toFixed(5)}${result.detail ? ` (${result.detail.slice(0, 150)})` : ""}`)
    }

    records.push({ id: puzzleId, reps })
    await writeFile(outPath, JSON.stringify(records, null, 2))
  }

  const tally = new Map<string, number>()
  let matchCount = 0
  let totalReps = 0
  for (const r of records as { reps: readonly RepOutcome[] }[]) {
    for (const rep of r.reps) {
      totalReps += 1
      tally.set(rep.outcome, (tally.get(rep.outcome) ?? 0) + 1)
      if (rep.verifierVerdict === "MATCH") matchCount += 1
    }
  }

  console.log(`\nWrote ${records.length} records to ${outPath.pathname}`)
  console.log(`\nVerified MATCH: ${matchCount}/${totalReps}`)
  console.log("\nOutcome tally:")
  for (const [outcome, count] of tally) console.log(`  ${outcome}: ${count}/${totalReps}`)
  console.log(`\nTotal spend this run: $${grandTotalCost.toFixed(4)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
