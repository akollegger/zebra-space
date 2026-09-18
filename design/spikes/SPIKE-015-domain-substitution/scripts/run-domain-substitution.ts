// SPIKE-015 §2: the billed run. For each seed puzzle, per rep: the model identifies-and-remaps
// ONE domain from raw prose alone (no domain list) -> score against groundTruthFor before
// applying anything -> mechanically apply the mapping to prose (literal) and the seed .mzn
// (fold-matched enum rewrite) -> confirm the substituted .mzn still solves uniquely (zero extra
// cost, deterministic) -> a critic judges whether the substituted PROSE is well-formed.
//
// PZL-0007 is deliberately excluded (no enum declarations at all — not a valid seed for this
// single-named-domain variant, confirmed by the smoke test). Verification is a well-posedness
// critic (judge-substitution.ts), not a direct-mzn re-formalization+grade — see SPIKE.md §5.5:
// direct-mzn's own known ~26-48% MATCH ceiling (SPIKE-014) was drowning out this spike's actual
// signal, and it was testing the wrong downstream capability (formalizing, not the well-
// posedness of the substitution itself, per ADR-007/RFC-003 §7.3's established distinction).
//
// The critic call is a 3-vote majority (judgeSubstitutionMajority, per SPIKE.md §5.8) — §5.5/
// §5.6 both found byte-identical input scoring a different single-call verdict, so one call's
// wellFormed is judge noise as much as it is signal. 3x's the judge cost, not the mapping cost.
//
// The critic runs on its OWN model (JUDGE_MODEL), separate from the mapper (MODEL) — per
// SPIKE.md §5.9: using the same model for both meant the critic shared the mapper's own biases
// (e.g. gpt-4o-mini's rock-paper-scissors-lizard-spock prior, §5.6), which no amount of
// same-model majority voting can out-vote. Defaults to `z-ai/glm-5.3-flash` — a full generation
// newer than gpt-4o-mini on Artificial Analysis's AA-Omniscience Non-Hallucination Rate
// (72.4% vs. gpt-4o-mini's own untested-but-comparable-generation ~5-7% peers), cheaper per
// token, and a different model family entirely.
//
// Usage: node --env-file-if-exists=.env design/spikes/SPIKE-015-domain-substitution/scripts/run-domain-substitution.ts
// REPS=<n> overrides the default of 3. MODEL=<model> overrides the mapper's default gpt-4o-mini.
// JUDGE_MODEL=<model> overrides the critic's default z-ai/glm-5.3-flash.

import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { writeFile, mkdir } from "node:fs/promises"
import { Effect } from "effect"
import { solve } from "../../../../src/solver/solve.ts"
import { loadPuzzleProse } from "../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts"
import { groundTruthFor } from "../../SPIKE-013-vocabulary-construction-isolation/scripts/lib/ground-truth.ts"
import { requestDomainMapping } from "./lib/request-mapping.ts"
import { scoreDomainMatch } from "./lib/score-domain-match.ts"
import { applyMappingToProse } from "./lib/apply-to-prose.ts"
import { applyMappingToMzn } from "./lib/apply-to-mzn.ts"
import { judgeSubstitutionMajority } from "./lib/judge-substitution.ts"
import type { SolveResult, SolverError } from "../../../../src/solver/types.ts"

const MODEL = process.env.MODEL ?? "openai/gpt-4o-mini"
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "z-ai/glm-5.3-flash"
const REPS = Number(process.env.REPS ?? 3)

// PZL-0007 deliberately excluded — no enum declarations at all (see SPIKE.md §2 step 1 / the
// smoke test's testApplyMappingToMznNoEnums), not a valid seed for this variant.
//
// PZL-0001 (5 enum domains, the classic zebra puzzle), PZL-0004 (3 independent enum domains,
// no arrays — direct elimination, not a house grid), PZL-0011 (a single decision variable
// determined by reified if/then rules, no alldifferent at all), and PZL-0038 (single domain,
// with one clue deliberately unencoded as a defeated premise) added per SPIKE.md §5.7 to widen
// the seed set beyond two structurally similar house-grid puzzles — each hand-translated and
// independently re-verified (fresh solve() call, matched against eval/answer-keys.json) before
// being added to catalog/mzn/, not merely assumed correct.
const SEED_PUZZLE_IDS = ["PZL-0001", "PZL-0002", "PZL-0003", "PZL-0004", "PZL-0011", "PZL-0038"]

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
  readonly judgeCostUsd?: number | undefined
  readonly domainMatchReason?: string
  readonly mznApplied?: number
  readonly mznSkipped?: readonly { readonly oldValue: string; readonly newValue: string; readonly reason: string }[]
  readonly wellFormed?: boolean
  readonly issues?: readonly string[]
  readonly judgeVotes?: readonly { readonly wellFormed: boolean; readonly issues: readonly string[] }[]
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

  const judged = await judgeSubstitutionMajority(JUDGE_MODEL, prose, substitutedProse, proposal.mapping)
  if (!judged.ok || judged.wellFormed === undefined) {
    return {
      outcome: "JUDGE_CALL_FAILED",
      detail: judged.error ?? "unknown",
      mappingCostUsd: mapped.costUsd,
      judgeCostUsd: judged.costUsd,
      domainMatchReason: match.reason,
      mznApplied: applied,
      mznSkipped: skipped,
      substitutedProse,
    }
  }

  return {
    outcome: judged.wellFormed ? "VERIFIED" : "SUBSTITUTION_NOT_WELL_FORMED",
    detail: judged.issues.join("; "),
    mappingCostUsd: mapped.costUsd,
    judgeCostUsd: judged.costUsd,
    domainMatchReason: match.reason,
    mznApplied: applied,
    mznSkipped: skipped,
    wellFormed: judged.wellFormed,
    issues: judged.issues,
    judgeVotes: judged.votes,
    substitutedProse,
  }
}

async function main(): Promise<void> {
  const outDir = new URL("results/", import.meta.url)
  await mkdir(outDir, { recursive: true })
  const modelTag = MODEL.replace(/[^a-zA-Z0-9]+/g, "-")
  const judgeModelTag = JUDGE_MODEL.replace(/[^a-zA-Z0-9]+/g, "-")
  const outPath = new URL(`domain-substitution-${modelTag}-judge-${judgeModelTag}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, outDir)

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
      const cost = (result.mappingCostUsd ?? 0) + (result.judgeCostUsd ?? 0)
      grandTotalCost += cost
      console.log(`  [${rep + 1}/${REPS}]: ${result.outcome} wellFormed=${result.wellFormed ?? "N/A"} cost=${cost.toFixed(5)}${result.detail ? ` (${result.detail.slice(0, 150)})` : ""}`)
    }

    records.push({ id: puzzleId, reps })
    await writeFile(outPath, JSON.stringify(records, null, 2))
  }

  const tally = new Map<string, number>()
  let wellFormedCount = 0
  let totalReps = 0
  for (const r of records as { reps: readonly RepOutcome[] }[]) {
    for (const rep of r.reps) {
      totalReps += 1
      tally.set(rep.outcome, (tally.get(rep.outcome) ?? 0) + 1)
      if (rep.wellFormed === true) wellFormedCount += 1
    }
  }

  console.log(`\nWrote ${records.length} records to ${outPath.pathname}`)
  console.log(`\nWell-formed substitutions: ${wellFormedCount}/${totalReps}`)
  console.log("\nOutcome tally:")
  for (const [outcome, count] of tally) console.log(`  ${outcome}: ${count}/${totalReps}`)
  console.log(`\nTotal spend this run: $${grandTotalCost.toFixed(4)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
