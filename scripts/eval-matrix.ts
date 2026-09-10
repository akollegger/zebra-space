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
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { loadEnvFileIfPresent } from "../src/cli/load-env.ts"
import { DEFAULT_JUDGE_MODEL } from "../src/eval/direct-solve.ts"
import { listHarnesses } from "../src/eval/harness.ts"

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url))
const MODELS_PATH = new URL("../eval/models.json", import.meta.url)
const MATRIX_MD_PATH = new URL("../eval/matrix.md", import.meta.url)
const RESULTS_DIR = new URL("../eval/results/", import.meta.url)

/** ADR-007 §2.3: stratified 8-puzzle subset spanning all five outcome classes. */
const STRATIFIED_SUBSET = ["PZL-0002", "PZL-0004", "PZL-0022", "PZL-0028", "PZL-0033", "PZL-0038", "PZL-0015", "PZL-0018"]


interface RegistryModel {
  readonly id: string
  readonly tier: string
  readonly role?: string | undefined
  readonly cost_per_call_usd: number
  readonly verified: boolean
  readonly notes?: string | undefined
}

export interface CellPlan {
  readonly model: RegistryModel
  readonly harnessId: string
  readonly puzzles: readonly string[]
  readonly runs: number
  readonly estimatedUsd: number
}

interface BlockedCell {
  readonly model: RegistryModel
  readonly harnessId: string
  readonly reason: string
}

/**
 * The slice of a cell's raw JSON (written by scripts/eval-extraction.ts) the verdict grid needs.
 * Spend fields are optional: raw JSON written before cost accounting (ADR-010) lacks them, and
 * those cells still render — without a spend line, never with a fabricated figure.
 */
export interface RawCellResult {
  readonly puzzles: readonly {
    readonly id: string
    readonly outcome: string
    readonly actualCostUsd?: number | null
  }[]
  readonly summary: { readonly total: number; readonly excluded: number; readonly passRate: number }
  readonly spendUsd?: number
  readonly estimatedSpendUsd?: number
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

/**
 * Verified models only; unverified tiers are reported as skipped-with-reason, never run.
 * A direct-solve cell additionally needs its judge model verified (ADR-008 §2.4) — this
 * runner never passes --judge-model, so the effective judge is always
 * ZEBRA_JUDGE_MODEL || DEFAULT_JUDGE_MODEL, checked once here rather than letting every
 * direct-solve cell fail loudly (and abort the whole matrix) inside its own subprocess.
 */
function planCells(
  models: readonly RegistryModel[],
  args: MatrixArgs,
): { readonly cells: readonly CellPlan[]; readonly skipped: readonly RegistryModel[]; readonly blocked: readonly BlockedCell[] } {
  const verified = models.filter((m) => m.verified)
  const skipped = models.filter((m) => !m.verified)
  const harnesses = listHarnesses()
  const harnessIds = args.harnessId !== undefined ? [args.harnessId] : harnesses.map((h) => h.id)
  const judgeModel = process.env.ZEBRA_JUDGE_MODEL || DEFAULT_JUDGE_MODEL
  const judgeEntry = models.find((m) => m.id === judgeModel)
  const judgeVerified = judgeEntry?.verified === true
  const cells: CellPlan[] = []
  const blocked: BlockedCell[] = []
  for (const model of verified) {
    for (const harnessId of harnessIds) {
      if (harnessId === "direct-solve" && !judgeVerified) {
        blocked.push({
          model,
          harnessId,
          reason: `judge model "${judgeModel}" is not a verified entry in eval/models.json`,
        })
        continue
      }
      const baseline = !args.full && isBaselineCell(model, harnessId)
      const puzzles: readonly string[] = args.full || baseline ? [] : STRATIFIED_SUBSET
      // Falls back to the full-critic worst case only if `--harness` names an id the
      // registry doesn't have — unreachable for the default (registry-derived) id list.
      const maxCalls = harnesses.find((h) => h.id === harnessId)?.maxCallsPerPuzzle ?? 12
      const judgeCostPerCall = harnessId === "direct-solve" ? judgeEntry?.cost_per_call_usd ?? 0 : 0
      const costPerPuzzle = harnessId === "direct-solve" ? model.cost_per_call_usd + judgeCostPerCall : model.cost_per_call_usd * maxCalls
      cells.push({
        model,
        harnessId,
        puzzles,
        runs: args.runs,
        estimatedUsd: costPerPuzzle * (puzzles.length === 0 ? 39 : puzzles.length) * args.runs,
      })
    }
  }
  return { cells, skipped, blocked }
}

function cellArgs(cell: CellPlan, budgetUsd: number | undefined): string[] {
  const args = ["scripts/eval-extraction.ts", "--model", cell.model.id, "--harness", cell.harnessId, "--runs", String(cell.runs)]
  if (budgetUsd !== undefined) args.push("--budget-usd", String(budgetUsd))
  for (const puzzle of cell.puzzles) args.push(puzzle)
  return args
}

function printPlan(
  cells: readonly CellPlan[],
  skipped: readonly RegistryModel[],
  blocked: readonly BlockedCell[],
  budgetUsd: number | undefined,
): void {
  console.log("\n=== Matrix plan ===\n")
  for (const cell of cells) {
    const scope = cell.puzzles.length === 0 ? "all 39" : `${cell.puzzles.length} puzzles (${cell.puzzles.join(" ")})`
    console.log(`  ${cell.model.id} [${cell.model.tier}] x ${cell.harnessId} · ${scope} · ${cell.runs} runs · ~$${cell.estimatedUsd.toFixed(2)}`)
  }
  for (const model of skipped) {
    console.log(`  SKIP ${model.id} [${model.tier}]: unverified — ${model.notes ?? "no notes"}`)
  }
  for (const cell of blocked) {
    console.log(`  SKIP ${cell.model.id} [${cell.model.tier}] x ${cell.harnessId}: ${cell.reason}`)
  }
  const total = cells.reduce((sum, c) => sum + c.estimatedUsd, 0)
  console.log(`\nEstimated total: ~$${total.toFixed(2)}${budgetUsd !== undefined ? ` (budget $${budgetUsd.toFixed(2)})` : ""}`)
}

/** Filenames currently in eval/results/, so a cell's own raw JSON can be spotted by what's new. */
async function listResultsSnapshot(): Promise<ReadonlySet<string>> {
  try {
    return new Set(await readdir(RESULTS_DIR))
  } catch {
    return new Set()
  }
}

/**
 * Finds the raw JSON a cell just wrote (scripts/eval-extraction.ts always writes exactly one
 * per invocation, named by its run id) by diffing eval/results/ against a snapshot taken right
 * before the cell ran, rather than parsing the cell's stdout — so the subprocess can keep
 * `stdio: "inherit"` and stream live instead of being buffered and re-printed after the fact.
 */
async function readNewCellResult(before: ReadonlySet<string>): Promise<RawCellResult | undefined> {
  let files: readonly string[]
  try {
    files = await readdir(RESULTS_DIR)
  } catch {
    return undefined
  }
  const added = files.filter((f) => !before.has(f) && f.endsWith(".json")).sort()
  // Exactly one file should be new; a run id is an ISO timestamp, so lexicographic order is
  // also chronological if more than one somehow appeared.
  const newest = added.at(-1)
  if (newest === undefined) return undefined
  return JSON.parse(await readFile(new URL(newest, RESULTS_DIR), "utf8")) as RawCellResult
}

/** Per-puzzle × cell verdict grid plus pass rates (ADR-007 §2.3), for cells that actually ran. */
export function renderVerdictGrid(cells: readonly CellPlan[], cellResults: ReadonlyMap<CellPlan, RawCellResult>): string {
  const completed = cells.flatMap((cell) => {
    const result = cellResults.get(cell)
    return result === undefined ? [] : [{ cell, result }]
  })
  if (completed.length === 0) {
    return "_No cells completed with a raw result to compare (dry run, every cell failed, or every cell was blocked)._"
  }
  const puzzleIds = Array.from(new Set(completed.flatMap(({ result }) => result.puzzles.map((p) => p.id)))).sort()
  const columnLabel = ({ cell }: { readonly cell: CellPlan }) => `${cell.model.id} x ${cell.harnessId}`
  const header = `| Puzzle | ${completed.map(columnLabel).join(" | ")} |`
  const divider = `|---|${completed.map(() => "---").join("|")}|`
  const rows = puzzleIds.map((id) => {
    const cols = completed.map(({ result }) => result.puzzles.find((p) => p.id === id)?.outcome ?? "—").join(" | ")
    return `| ${id} | ${cols} |`
  })
  const passRates = completed
    .map(({ cell, result }) => {
      const base = `- ${columnLabel({ cell })}: ${(result.summary.passRate * 100).toFixed(0)}% (excluded ${result.summary.excluded}/${result.summary.total})`
      return `${base}${renderCellSpend(result)}`
    })
    .join("\n")
  return `${passRates}\n\n${header}\n${divider}\n${rows.join("\n")}`
}

/**
 * Per-cell measured spend next to the estimate (ADR-010 §2.3). Three shapes, never ambiguous:
 * all runs measured shows both figures side by side; some measured says how many plus the
 * fallback; none measured labels the figure an estimate outright. A cell whose raw JSON predates
 * cost accounting renders no spend line at all rather than inventing one.
 */
function renderCellSpend(result: RawCellResult): string {
  const { spendUsd, estimatedSpendUsd } = result
  if (spendUsd === undefined) return ""
  const measured = result.puzzles.filter((p) => typeof p.actualCostUsd === "number").length
  if (measured === 0) return ` · spend $${spendUsd.toFixed(4)} (est — no measured calls)`
  const detail =
    measured === result.puzzles.length
      ? `measured ${measured}/${result.puzzles.length}`
      : `measured ${measured}/${result.puzzles.length}, rest est`
  const est = estimatedSpendUsd === undefined ? "" : `, est $${estimatedSpendUsd.toFixed(4)}`
  return ` · spend $${spendUsd.toFixed(4)} (${detail}${est})`
}

const MATRIX_MD_HEADER = `# Eval Matrix Results

Per-puzzle × cell comparison tables for the comparative matrix (ADR-007 §2.3). Each run
appends one section: the cells executed, their pass rates and spend, and the per-puzzle
verdict grid. Spend lines (ADR-010) show the measured total first — \`measured N/M\` counts
puzzle-runs whose provider reported a billed cost; \`est — no measured calls\` marks a cell
whose figure is entirely the registry estimate (local/free-tier routes). Measured totals
are lower bounds for retry-heavy cells: failed attempts never carry usage data.
Raw per-cell detail lives in the gitignored \`eval/results/<run-id>.json\` files referenced
per row; this file is the committed summary only. Runs stay sequential by default.
`

async function appendMatrixMarkdown(data: {
  startedAt: Date
  gitCommit: string
  cells: readonly CellPlan[]
  skipped: readonly RegistryModel[]
  blocked: readonly BlockedCell[]
  cellFailures: readonly { readonly cell: CellPlan; readonly error: string }[]
  cellResults: ReadonlyMap<CellPlan, RawCellResult>
  runs: number
}): Promise<void> {
  if (!existsSync(MATRIX_MD_PATH)) {
    await writeFile(MATRIX_MD_PATH, MATRIX_MD_HEADER)
  }
  const failedLabels = new Set(data.cellFailures.map(({ cell }) => `${cell.model.id}\u0000${cell.harnessId}`))
  const rows = data.cells
    .map((c) => {
      const failed = failedLabels.has(`${c.model.id}\u0000${c.harnessId}`)
      const scope = c.puzzles.length === 0 ? "all 39" : c.puzzles.join(" ")
      const estimate = failed ? `~$${c.estimatedUsd.toFixed(2)} (FAILED)` : `~$${c.estimatedUsd.toFixed(2)}`
      return `| ${c.model.id} [${c.model.tier}] | ${c.harnessId} | ${scope} | ${c.runs} | ${estimate} |`
    })
    .join("\n")
  const skippedRows = [
    ...data.skipped.map((m) => `| ${m.id} [${m.tier}] | unverified — ${m.notes ?? "no notes"} |`),
    ...data.blocked.map((c) => `| ${c.model.id} [${c.model.tier}] x ${c.harnessId} | ${c.reason} |`),
  ].join("\n")
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

Results:

${renderVerdictGrid(data.cells, data.cellResults)}
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

/**
 * Same local-mode exception as scripts/eval-extraction.ts: a purely local plan (every cell
 * routes through ZEBRA_LOCAL_BASE_URL) needs no OpenRouter key — except direct-solve cells,
 * whose judge is always forced onto OpenRouter regardless of local mode (ADR-008 §2.4). A pure
 * function of the plan and the env, so the gate condition is unit-testable without a real run
 * (which always writes eval/matrix.md, even for a plan whose cells never execute).
 */
export function needsOpenRouterKey(cells: readonly CellPlan[], env: { readonly ZEBRA_LOCAL_BASE_URL?: string }): boolean {
  return !env.ZEBRA_LOCAL_BASE_URL || cells.some((c) => c.harnessId === "direct-solve")
}

async function main(): Promise<void> {
  loadEnvFileIfPresent(new URL("../.env", import.meta.url).pathname)
  const args = parseArgs(process.argv.slice(2))
  const models = await loadRegistry()
  const { cells, skipped, blocked } = planCells(models, args)
  if (cells.length === 0) {
    if (blocked.length > 0) {
      console.error(`Every matching cell is blocked: ${blocked[0]?.reason} — nothing to run.`)
    } else {
      console.error("No verified models in eval/models.json — nothing to run.")
    }
    process.exit(1)
  }

  printPlan(cells, skipped, blocked, args.budgetUsd)
  if (args.dryRun) return

  if (needsOpenRouterKey(cells, process.env) && !process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY is not set. Add it to .env at the repo root, or export it in your shell, then re-run.")
    process.exit(1)
  }

  const startedAt = new Date()
  // Each cell runs in its own subprocess; one cell's failure (e.g. a mid-run refusal) must
  // not throw away the matrix.md entry for every cell that already succeeded, so failures
  // are recorded and the loop continues rather than propagating to main()'s catch.
  const cellFailures: { readonly cell: CellPlan; readonly error: string }[] = []
  const cellResults = new Map<CellPlan, RawCellResult>()
  for (const cell of cells) {
    const label = `${cell.model.id} x ${cell.harnessId}`
    console.log(`\n===== Cell: ${label} =====`)
    const before = await listResultsSnapshot()
    // Cell output is captured per cell, not inherited: a runaway cell's stdout would
    // otherwise stream unbuffered into this process and interleave with the matrix's own
    // summary. The tail prints inline for live progress; the full log is in the error on
    // failure and always lands in the cell's raw JSON detail.
    try {
      const output = execFileSync("node", cellArgs(cell, args.budgetUsd), {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      })
      const tail = output.trim().split("\n").slice(-5).join("\n")
      if (tail !== "") console.log(tail)
    } catch (error) {
      const procError = error as { stdout?: string; stderr?: string; message: string }
      const tail = (procError.stdout ?? "").trim().split("\n").slice(-15).join("\n")
      if (tail !== "") console.log(tail)
      const message = `${procError.message}${procError.stderr ? ` — ${procError.stderr.slice(0, 500)}` : ""}`
      console.error(`Cell ${label} failed: ${message}`)
      cellFailures.push({ cell, error: message })
    }
    const result = await readNewCellResult(before)
    if (result !== undefined) cellResults.set(cell, result)
  }

  await appendMatrixMarkdown({ startedAt, gitCommit: getGitCommitSha(), cells, skipped, blocked, cellFailures, cellResults, runs: args.runs })
  console.log(`\nMatrix summary appended to: ${fileURLToPath(MATRIX_MD_PATH)}`)
  if (cellFailures.length > 0) {
    console.error(`\n${cellFailures.length} of ${cells.length} cell(s) failed — see matrix.md and cell output above.`)
    process.exitCode = 1
  }
}

// Importable for unit tests (renderVerdictGrid) without running the full CLI — main() only
// fires when this file is the entrypoint, mirroring eval-extraction.ts's same guard.
const isEntrypoint = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")
if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
