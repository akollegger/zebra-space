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

// PZL-0004 fails every rep (MZN_APPLY_TOTAL_FAILURE, confirmed 0/6 across two independent
// sweeps) for a puzzle-file reason, not a model-capability one — see SPIKE.md §5.7. Used only
// to compute an adjusted (excluding-known-broken-seeds) rate/cost alongside the raw one; the
// puzzle stays in SEED_PUZZLE_IDS and every rep against it still runs and is logged normally.
const KNOWN_BROKEN_SEED_IDS = ["PZL-0004"]

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

// SPIKE.md §5.10: a funnel over the outcome taxonomy, so it's visible WHERE unreliability
// concentrates (domain identification vs. mechanical apply vs. well-posedness) rather than
// only a single blended end-to-end rate. Each stage's denominator is the PREVIOUS stage's
// count. SUBSTITUTED_MZN_SOLVE_ERROR and SUBSTITUTED_MZN_NOT_UNIQUE are deliberately collapsed
// into one "solvedUniquely" stage — the sample size here is too thin to split them meaningfully
// (both mean "the mechanical apply produced a broken model," just via different solver
// outcomes). JUDGE_CALL_FAILED reps are excluded from `wellFormed`'s own denominator as
// indeterminate — never folded into "not well-formed," which would conflate an infra failure
// with a real negative verdict.
interface Funnel {
  readonly noGroundTruth: number
  readonly attempted: number
  readonly domainMatched: number
  readonly mznApplied: number
  readonly solvedUniquely: number
  readonly judged: number
  readonly wellFormed: number
}

function computeFunnel(reps: readonly RepOutcome[]): Funnel {
  const noGroundTruth = reps.filter((r) => r.outcome === "NO_GROUND_TRUTH")
  const attempted = reps.filter((r) => r.outcome !== "NO_GROUND_TRUTH")
  const domainMatched = attempted.filter((r) => r.outcome !== "MAPPING_CALL_FAILED" && r.outcome !== "DOMAIN_MATCH_FAILED")
  const mznApplied = domainMatched.filter((r) => r.outcome !== "MZN_APPLY_TOTAL_FAILURE")
  const solvedUniquely = mznApplied.filter((r) => r.outcome !== "SUBSTITUTED_MZN_SOLVE_ERROR" && r.outcome !== "SUBSTITUTED_MZN_NOT_UNIQUE")
  const judged = solvedUniquely.filter((r) => r.outcome !== "JUDGE_CALL_FAILED")
  const wellFormed = judged.filter((r) => r.outcome === "VERIFIED")

  return {
    noGroundTruth: noGroundTruth.length,
    attempted: attempted.length,
    domainMatched: domainMatched.length,
    mznApplied: mznApplied.length,
    solvedUniquely: solvedUniquely.length,
    judged: judged.length,
    wellFormed: wellFormed.length,
  }
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(0)}%`
}

function printFunnel(label: string, f: Funnel): void {
  console.log(`\n${label}`)
  if (f.noGroundTruth > 0) console.log(`  (excluded ${f.noGroundTruth} NO_GROUND_TRUTH rep(s), unreachable by design)`)
  console.log(`  attempted: ${f.attempted}`)
  console.log(`  domain matched (of attempted): ${f.domainMatched}/${f.attempted} (${pct(f.domainMatched, f.attempted)})`)
  console.log(`  mzn applied (of matched): ${f.mznApplied}/${f.domainMatched} (${pct(f.mznApplied, f.domainMatched)})`)
  console.log(`  solved uniquely (of applied): ${f.solvedUniquely}/${f.mznApplied} (${pct(f.solvedUniquely, f.mznApplied)})`)
  console.log(`  judge call completed (of solved): ${f.judged}/${f.solvedUniquely} (${pct(f.judged, f.solvedUniquely)})`)
  console.log(`  well-formed (of judged): ${f.wellFormed}/${f.judged} (${pct(f.wellFormed, f.judged)})`)
  console.log(`  end-to-end (well-formed of attempted): ${f.wellFormed}/${f.attempted} (${pct(f.wellFormed, f.attempted)})`)
}

async function main(): Promise<void> {
  const outDir = new URL("results/", import.meta.url)
  await mkdir(outDir, { recursive: true })
  const modelTag = MODEL.replace(/[^a-zA-Z0-9]+/g, "-")
  const judgeModelTag = JUDGE_MODEL.replace(/[^a-zA-Z0-9]+/g, "-")
  const outPath = new URL(`domain-substitution-${modelTag}-judge-${judgeModelTag}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, outDir)

  const records: { readonly id: string; readonly reps: readonly RepOutcome[] }[] = []
  let grandTotalCost = 0
  let adjustedTotalCost = 0

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
      if (!KNOWN_BROKEN_SEED_IDS.includes(puzzleId)) adjustedTotalCost += cost
      console.log(`  [${rep + 1}/${REPS}]: ${result.outcome} wellFormed=${result.wellFormed ?? "N/A"} cost=${cost.toFixed(5)}${result.detail ? ` (${result.detail.slice(0, 150)})` : ""}`)
    }

    records.push({ id: puzzleId, reps })
    await writeFile(outPath, JSON.stringify(records, null, 2))
  }

  const allReps = records.flatMap((r) => r.reps)
  const adjustedReps = records.filter((r) => !KNOWN_BROKEN_SEED_IDS.includes(r.id)).flatMap((r) => r.reps)

  const tally = new Map<string, number>()
  for (const rep of allReps) tally.set(rep.outcome, (tally.get(rep.outcome) ?? 0) + 1)

  console.log(`\nWrote ${records.length} records to ${outPath.pathname}`)

  console.log("\nPer-seed breakdown (well-formed/attempted):")
  for (const r of records) {
    const wellFormed = r.reps.filter((rep) => rep.outcome === "VERIFIED").length
    const knownBroken = KNOWN_BROKEN_SEED_IDS.includes(r.id) ? " (known-broken seed — SPIKE.md §5.7)" : ""
    console.log(`  ${r.id}: ${wellFormed}/${r.reps.length}${knownBroken}`)
  }

  console.log("\nOutcome tally (raw, all seeds):")
  for (const [outcome, count] of tally) console.log(`  ${outcome}: ${count}/${allReps.length}`)

  printFunnel("Funnel (raw, all seeds):", computeFunnel(allReps))
  printFunnel(`Funnel (excluding known-broken seeds: ${KNOWN_BROKEN_SEED_IDS.join(", ")}):`, computeFunnel(adjustedReps))

  const rawWellFormed = allReps.filter((r) => r.outcome === "VERIFIED").length
  const adjustedWellFormed = adjustedReps.filter((r) => r.outcome === "VERIFIED").length
  const costPerSuccess = (cost: number, count: number) => (count === 0 ? "n/a" : `$${(cost / count).toFixed(5)}`)

  console.log(`\nTotal spend this run: $${grandTotalCost.toFixed(4)}`)
  console.log(`  $/successful substitution (raw): ${costPerSuccess(grandTotalCost, rawWellFormed)}`)
  console.log(`  $/successful substitution (excluding known-broken seeds): ${costPerSuccess(adjustedTotalCost, adjustedWellFormed)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
