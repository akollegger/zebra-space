/**
 * Comparative matrix runner (ADR-007 §2.3): verified registry models x registered harnesses.
 *
 * Cells are verified `eval/models.json` entries (at least one per tier, starting with the
 * current defaults) crossed with the harnesses in `src/eval/harness.ts`'s registry (the full
 * critic loop, single-shot no-critic, compile-error repair — plus any future harness, which
 * appears here with no matrix changes). Each cell defaults to a stratified 8-puzzle subset
 * spanning all five outcome classes; --full opts every cell into all 39. The baseline cell
 * (defaults, full critic loop) always runs all 39. Runs stay sequential — concurrency needs
 * rate-limit evidence first.
 *
 * Output is one raw JSON per cell (via scripts/eval-extraction.ts) plus a per-puzzle x cell
 * comparison table (verdicts, frequency, cost) in eval/matrix.md.
 *
 * Usage:
 *   node scripts/eval-matrix.ts                      # subset cells + full baseline
 *   node scripts/eval-matrix.ts --full                 # every cell runs all 39 puzzles
 *   node scripts/eval-matrix.ts --budget-usd 20        # forwarded to every cell
 *   node scripts/eval-matrix.ts --runs 3               # repeats per cell (default 3 for matrix)
 *   node scripts/eval-matrix.ts --dry-run              # print the plan (cells, puzzles, estimate) without spending
 *   node scripts/eval-matrix.ts --harness single-shot  # only cells using this harness id
 */
import { execFileSync } from "node:child_process"
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { loadEnvFileIfPresent } from "../src/cli/load-env.ts"

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url))
const MODELS_PATH = new URL("../eval/models.json", import.meta.url)
const MATRIX_MD_PATH = new URL("../eval/matrix.md", import.meta.url)
const RESULTS_DIR = new URL("../eval/results/", import.meta.url)

/** ADR-007 §2.3: stratified 8-puzzle subset spanning all five outcome classes. */
const STRATIFIED_SUBSET = ["PZL-0002", "PZL-0004", "PZL-0022", "PZL-0028", "PZL-0033", "PZL-0038", "PZL-0015", "PZL-0018"]

/** Harness ids in matrix order. Read live from the registry so new harnesses just appear. */
const HARNESS_IDS = ["full-critic", "single-shot", "compile-repair", "direct-solve", "staged-single-shot"] as const

/** Worst-case calls per puzzle per harness, for the pre-run estimate. */
const HARNESS_MAX_CALLS: Record<string, number> = {
  "full-critic": 12,
  "single-shot": 1,
  "compile-repair": 2,
  "direct-solve": 2,
  "staged-single-shot": 2,
}

interface RegistryModel {
  readonly id: string
  readonly tier: string
  readonly role?: string | undefined
  readonly cost_per_call_usd: number
  readonly verified: boolean
  readonly notes?: string | undefined
}

interface CellPlan {
  readonly model: RegistryModel
  readonly harnessId: string
  readonly puzzles: readonly string[]
  readonly runs: number
  readonly estimatedUsd: number
}

interface MatrixArgs {
  readonly full: boolean
  readonly runs: number
  readonly budgetUsd?: number | undefined
  readonly dryRun: boolean
  readonly harnessId?: string | undefined
}

function parseArgs(argv: readonly string[]): MatrixArgs {
  let full = false
  let runs = 3
  let budgetUsd: number | undefined
  let dryRun = false
  let harnessId: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--full") full = true
    else if (arg === "--dry-run") dryRun = true
    else if (arg === "--harness") harnessId = argv[++i]
    else if (arg === "--runs") {
      const parsed = Number(argv[++i])
      if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--runs needs a positive integer, got "${argv[i]}"`)
      runs = parsed
    } else if (arg === "--budget-usd") {
      const parsed = Number(argv[++i])
      if (!(parsed > 0)) throw new Error(`--budget-usd needs a positive number, got "${argv[i]}"`)
      budgetUsd = parsed
    } else if (arg?.startsWith("--")) throw new Error(`Unknown flag: ${arg}`)
    else throw new Error(`Unexpected positional argument: ${arg}`)
  }
  return { full, runs, budgetUsd, dryRun, harnessId }
}

async function loadRegistry(): Promise<readonly RegistryModel[]> {
  const raw = JSON.parse(await readFile(MODELS_PATH, "utf8")) as { models?: RegistryModel[] }
  return raw.models ?? []
}

function isBaselineCell(model: RegistryModel, harnessId: string): boolean {
  return (model.role === "default" || model.id === "openai/gpt-4o-mini") && harnessId === "full-critic"
}

/** Verified models only; unverified tiers are reported as skipped-with-reason, never run. */
function planCells(models: readonly RegistryModel[], args: MatrixArgs): { readonly cells: readonly CellPlan[]; readonly skipped: readonly RegistryModel[] } {
  const verified = models.filter((m) => m.verified)
  const skipped = models.filter((m) => !m.verified)
  const harnessIds = args.harnessId !== undefined ? [args.harnessId] : [...HARNESS_IDS]
  const cells: CellPlan[] = []
  for (const model of verified) {
    for (const harnessId of harnessIds) {
      const baseline = !args.full && isBaselineCell(model, harnessId)
      const puzzles: readonly string[] = args.full || baseline ? [] : STRATIFIED_SUBSET
      const maxCalls = HARNESS_MAX_CALLS[harnessId] ?? 12
      cells.push({
        model,
        harnessId,
        puzzles,
        runs: args.runs,
        estimatedUsd: model.cost_per_call_usd * maxCalls * (puzzles.length === 0 ? 39 : puzzles.length) * args.runs,
      })
    }
  }
  return { cells, skipped }
}

function cellArgs(cell: CellPlan, budgetUsd: number | undefined): string[] {
  const args = ["scripts/eval-extraction.ts", "--model", cell.model.id, "--harness", cell.harnessId, "--runs", String(cell.runs)]
  if (budgetUsd !== undefined) args.push("--budget-usd", String(budgetUsd))
  for (const puzzle of cell.puzzles) args.push(puzzle)
  return args
}

function printPlan(cells: readonly CellPlan[], skipped: readonly RegistryModel[], budgetUsd: number | undefined): void {
  console.log("\n=== Matrix plan ===\n")
  for (const cell of cells) {
    const scope = cell.puzzles.length === 0 ? "all 39" : `${cell.puzzles.length} puzzles (${cell.puzzles.join(" ")})`
    console.log(`  ${cell.model.id} [${cell.model.tier}] x ${cell.harnessId} · ${scope} · ${cell.runs} runs · ~$${cell.estimatedUsd.toFixed(2)}`)
  }
  for (const model of skipped) {
    console.log(`  SKIP ${model.id} [${model.tier}]: unverified — ${model.notes ?? "no notes"}`)
  }
  const total = cells.reduce((sum, c) => sum + c.estimatedUsd, 0)
  console.log(`\nEstimated total: ~$${total.toFixed(2)}${budgetUsd !== undefined ? ` (budget $${budgetUsd.toFixed(2)})` : ""}`)
}

const MATRIX_MD_HEADER = `# Eval Matrix Results

Per-puzzle × cell comparison tables for the comparative matrix (ADR-007 §2.3). Each run
appends one section: the cells executed, their pass rates, and the per-puzzle verdict grid.
Raw per-cell detail lives in the gitignored \`eval/results/<run-id>.json\` files referenced
per row; this file is the committed summary only. Runs stay sequential by default.
`

async function appendMatrixMarkdown(data: {
  startedAt: Date
  gitCommit: string
  cells: readonly CellPlan[]
  skipped: readonly RegistryModel[]
  runs: number
}): Promise<void> {
  if (!existsSync(MATRIX_MD_PATH)) {
    await writeFile(MATRIX_MD_PATH, MATRIX_MD_HEADER)
  }
  const rows = data.cells
    .map((c) => `| ${c.model.id} [${c.model.tier}] | ${c.harnessId} | ${c.puzzles.length === 0 ? "all 39" : c.puzzles.join(" ")} | ${c.runs} | ~$${c.estimatedUsd.toFixed(2)} |`)
    .join("\n")
  const skippedRows = data.skipped.map((m) => `| ${m.id} [${m.tier}] | unverified — ${m.notes ?? "no notes"} |`).join("\n")
  const section = `
---

## ${data.startedAt.toISOString().replace(/\.\d+Z$/, "Z")} — commit \`${data.gitCommit}\`

| Model | Harness | Puzzles | Runs | Estimate |
|---|---|---|---|---|
${rows}

Skipped tiers:

| Model | Reason |
|---|---|
${skippedRows || "| — | — |"}
`
  await appendFile(MATRIX_MD_PATH, section)
  await mkdir(RESULTS_DIR, { recursive: true })
}

function getGitCommitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

async function main(): Promise<void> {
  loadEnvFileIfPresent(new URL("../.env", import.meta.url).pathname)
  const args = parseArgs(process.argv.slice(2))
  const models = await loadRegistry()
  const { cells, skipped } = planCells(models, args)
  if (cells.length === 0) {
    console.error("No verified models in eval/models.json — nothing to run.")
    process.exit(1)
  }

  printPlan(cells, skipped, args.budgetUsd)
  if (args.dryRun) return

  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY is not set. Add it to .env at the repo root, or export it in your shell, then re-run.")
    process.exit(1)
  }

  const startedAt = new Date()
  for (const cell of cells) {
    const label = `${cell.model.id} x ${cell.harnessId}`
    console.log(`\n===== Cell: ${label} =====`)
    execFileSync("node", cellArgs(cell, args.budgetUsd), { cwd: REPO_ROOT, stdio: "inherit" })
  }

  await appendMatrixMarkdown({ startedAt, gitCommit: getGitCommitSha(), cells, skipped, runs: args.runs })
  console.log(`\nMatrix summary appended to: ${fileURLToPath(MATRIX_MD_PATH)}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
