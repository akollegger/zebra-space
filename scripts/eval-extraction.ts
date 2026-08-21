/**
 * Eval harness: runs every catalog puzzle through extract -> compile -> solve and compares the
 * solved assignment against eval/answer-keys.json. Not a CI gate — this hits a real paid LLM API
 * and MiniZinc's non-determinism (SPIKE-004) means a single run is a noisy sample, not a stable
 * regression signal. Run it, read eval/results.md, fix what's broken.
 *
 * KNOWN LIMITATION (see flatten()/compareAnswer() below): for puzzles whose answer is a set of
 * parallel arrays (PZL-0001, PZL-0002, PZL-0006, PZL-0008, PZL-0010), the comparison only checks
 * that the right vocabulary of values is present — it cannot detect a transposed pairing or wrong
 * ordering between two arrays at the same index. Building full ordinal-correspondence matching
 * was judged disproportionate for a first-pass local eval; solve() already independently confirms
 * UniquelySolvable, so a false MATCH there requires both the structure and the vocabulary to
 * align by accident. Every eval/results.md entry's legend names the affected puzzle ids.
 *
 * recoverEntityKeyedArrays() closes one specific hole in that vocabulary check, found live on
 * PZL-0010: MiniZinc's own JSON output for an entity-indexed array variable is purely positional
 * (no entity-id keys at all), so an answer key phrased as a flat list of entity names (e.g.
 * `["South", "Pedestrian", ...]`) could never match even a fully correct solve — the vocabulary
 * itself was structurally absent, not just unpaired. Re-zipping the solved array against the
 * SAME entities/order `compile.ts` itself used to index it recovers that vocabulary. This does
 * NOT add ordinal-pairing verification (the limitation above still stands) — it only fixes cases
 * where the entity vocabulary was missing entirely, not cases like PZL-0006 (a mapping keyed by
 * row numbers, not entity ids), which remain a genuine, unaddressed blind spot.
 *
 * Usage:
 *   node scripts/eval-extraction.ts                  # all 14 catalog puzzles
 *   node scripts/eval-extraction.ts PZL-0004 PZL-0007 # just these
 *   node scripts/eval-extraction.ts --model openai/gpt-4o-mini --frontier-model anthropic/claude-sonnet-4.5
 */
import { execFileSync } from "node:child_process"
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { compile, sanitizeIdentifier } from "../src/compiler/compile.ts"
import type { CompileError } from "../src/compiler/types.ts"
import { extract } from "../src/extraction/extract.ts"
import type { ExtractedCsp, ExtractionAttempt, ExtractionError } from "../src/extraction/types.ts"
import { loadEnvFileIfPresent } from "../src/cli/load-env.ts"
import { solve } from "../src/solver/solve.ts"
import type { Assignment, SolverError } from "../src/solver/types.ts"

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url))
const PUZZLES_DIR = new URL("../catalog/puzzles/", import.meta.url)
const ANSWER_KEYS_PATH = new URL("../eval/answer-keys.json", import.meta.url)
const RESULTS_DIR = new URL("../eval/results/", import.meta.url)
const RESULTS_MD_PATH = new URL("../eval/results.md", import.meta.url)

const ARRAY_PAIRING_BLIND_SPOT_IDS = ["PZL-0001", "PZL-0002", "PZL-0006", "PZL-0008", "PZL-0010"]

// --- CLI args ----------------------------------------------------------------------------------

interface ParsedArgs {
  readonly puzzleIds: readonly string[]
  readonly model?: string | undefined
  readonly frontierModel?: string | undefined
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const puzzleIds: string[] = []
  let model: string | undefined
  let frontierModel: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--model") model = argv[++i]
    else if (arg === "--frontier-model") frontierModel = argv[++i]
    else if (arg?.startsWith("--")) throw new Error(`Unknown flag: ${arg}`)
    else if (arg !== undefined) puzzleIds.push(arg)
  }
  return { puzzleIds, model, frontierModel }
}

// --- Puzzle + answer-key loading ----------------------------------------------------------------

interface Puzzle {
  readonly id: string
  readonly file: string
  readonly path: URL
}

interface AnswerKeyEntry {
  readonly title: string
  readonly answer: unknown
  readonly notes: string
}

async function loadAnswerKeys(): Promise<Record<string, AnswerKeyEntry>> {
  const raw = JSON.parse(await readFile(ANSWER_KEYS_PATH, "utf8")) as Record<string, unknown>
  const { $comment: _ignored, ...entries } = raw
  return entries as Record<string, AnswerKeyEntry>
}

async function listPuzzleFiles(filterIds: readonly string[]): Promise<Puzzle[]> {
  const files = (await readdir(PUZZLES_DIR)).filter((f) => f.endsWith(".md")).sort()
  const puzzles = files.flatMap((file) => {
    const match = /^(PZL-\d+)-/.exec(file)
    if (!match?.[1]) return []
    return [{ id: match[1], file, path: new URL(file, PUZZLES_DIR) }]
  })
  if (filterIds.length === 0) return puzzles
  const wanted = new Set(filterIds)
  return puzzles.filter((p) => wanted.has(p.id))
}

// --- Comparison ----------------------------------------------------------------------------------

type Scalar = string | number | boolean | null

function isScalar(value: unknown): value is Scalar {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean"
}

function isFlatScalarRecord(value: unknown): value is Record<string, Scalar> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every(isScalar)
  )
}

// Mirrors src/compiler/compile.ts's renderScalar() exactly: the compiler renders a string
// constant as a MiniZinc enum member via sanitizeIdentifier(), so the answer key's natural-
// language values ("Professor Plum") must go through the same transform as the solved
// assignment's values ("Professor_Plum") before comparing, or every non-identifier-safe value
// falsely mismatches. Reuses the compiler's actual sanitizeIdentifier() directly — this used to
// be a hand-duplicated copy, and the duplicate already drifted out of sync once (the reserved-
// word suffix, added after a live "true" collision, was never mirrored here, so a genuinely
// correct solved value like "true_" scored as MISMATCH against the answer key's "true"). Only
// the integer passthrough (renderScalar's OTHER branch, never reaching sanitizeIdentifier at
// all) still needs restating here, since renderScalar itself isn't exported.
function normalizeToken(raw: string): string {
  return /^-?\d+$/.test(raw) ? raw : sanitizeIdentifier(raw)
}

/**
 * Flattens any JSON-like value into a Set of stringified tokens: every scalar leaf, every object
 * key, and — for a "flat record" (an object whose own values are all scalars, e.g. {"S":9,...} or
 * {"suspect":"Plum",...}) — an additional "key=value" compound token per property, so a direct
 * field pairing must actually match, not just each side's vocabulary independently. Every token
 * is passed through normalizeToken() so identifier-sanitized solver output compares equal to the
 * answer key's natural-language strings. See this file's header for the known array-pairing
 * limitation this does NOT cover.
 */
function flattenValue(value: unknown, tokens: Set<string> = new Set()): Set<string> {
  if (value === null || value === undefined) return tokens
  if (Array.isArray(value)) {
    for (const item of value) flattenValue(item, tokens)
    return tokens
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    const flat = isFlatScalarRecord(record)
    for (const [key, val] of Object.entries(record)) {
      const normKey = normalizeToken(key)
      tokens.add(normKey)
      if (flat) tokens.add(`${normKey}=${normalizeToken(String(val))}`)
      flattenValue(val, tokens)
    }
    return tokens
  }
  tokens.add(normalizeToken(String(value)))
  return tokens
}

/**
 * Entry point for comparison: both the answer key's `answer` object and solve()'s `assignment`
 * are always a top-level object whose OWN keys are just their author's field-name choices — the
 * answer key's are our own organizational labels ("grid", "suspect", "row_to_column"), and
 * solve()'s are the LLM's independently-chosen domain variable names ("digit", "culprit"). Neither
 * side's top-level keys are reliably cross-comparable puzzle vocabulary, so only their VALUES are
 * flattened at this level; nested structure below that uses flattenValue's full key+value(+compound)
 * treatment, since deeper keys (an entity id, a letter, a row number) usually are recoverable
 * puzzle vocabulary.
 */
function flatten(value: unknown): Set<string> {
  const tokens = new Set<string>()
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const val of Object.values(value as Record<string, unknown>)) flattenValue(val, tokens)
    return tokens
  }
  return flattenValue(value, tokens)
}

interface Comparison {
  readonly verdict: "MATCH" | "MISMATCH"
  readonly missing: readonly string[]
  readonly expectedTokenCount: number
  readonly actualTokenCount: number
}

/**
 * Recovers entity-name vocabulary for an array-typed (entity-indexed) domain variable's solved
 * value — MiniZinc's own `--output-mode json` never carries it, an array is purely positional,
 * not keyed by the enum that indexes it. Confirmed live on PZL-0010: the solved assignment
 * (`{"order": [4,1,3,5,2]}`) never mentions "North"/"South"/etc. anywhere, even though the answer
 * key is exactly that vocabulary in declared order, and the puzzle solved correctly. Zips each
 * array against the SAME entities, in the SAME declared order, `src/compiler/compile.ts` itself
 * indexes that array by (`csp.entities` filtered by the domain's `entityType`), so those ids
 * appear in the flattened comparison. This recovers VOCABULARY only — it does not verify ordinal
 * pairing (`compareAnswer`'s existing known limitation, this file's header) — so it fixes cases
 * like PZL-0010 (a flat array of entity names) but not PZL-0006 (a mapping keyed by row NUMBERS
 * that don't match any entity id), which stays a genuine remaining blind spot.
 */
function recoverEntityKeyedArrays(assignment: Assignment, extractedCsp: ExtractedCsp): Assignment {
  const recovered: Record<string, unknown> = { ...assignment }
  for (const domain of extractedCsp.domains) {
    const value = recovered[domain.variable]
    if (!Array.isArray(value)) continue
    const entityIds = extractedCsp.entities.filter((e) => e.type === domain.entityType).map((e) => e.id)
    if (entityIds.length !== value.length) continue
    recovered[domain.variable] = Object.fromEntries(entityIds.map((id, i) => [id, value[i]]))
  }
  return recovered
}

function compareAnswer(expected: unknown, actualAssignment: Assignment): Comparison {
  const expectedTokens = flatten(expected)
  const actualTokens = flatten(actualAssignment)
  const missing = [...expectedTokens].filter((t) => !actualTokens.has(t))
  return {
    verdict: missing.length === 0 ? "MATCH" : "MISMATCH",
    missing,
    expectedTokenCount: expectedTokens.size,
    actualTokenCount: actualTokens.size,
  }
}

// --- Error summarizing (fresh, one-line — NOT the multi-paragraph CLI prose in
// src/cli/subcommands/extract.ts, which is aimed at an interactive human, not a batch report) ---

function summarizeExtractionError(error: ExtractionError): string {
  switch (error._tag) {
    case "ProviderError":
      return error.message
    case "SchemaRejected":
      return `model rejected schema: ${error.providerMessage.slice(0, 200)}`
    case "SchemaViolation":
      return `schema violation: ${error.detail}`
    case "CriticRejected":
      return `critic rejected after ${error.attempts.length} attempt(s): ${summarizeAttempts(error.attempts)}`
  }
}

function summarizeAttempts(attempts: readonly ExtractionAttempt[]): string {
  return attempts.map((a) => a.critique.issues.join("; ")).join(" | ")
}

function summarizeSolverError(error: SolverError): string {
  switch (error._tag) {
    case "ToolchainUnavailable":
      return error.message
    case "ModelSyntaxError":
      return error.stderr.slice(0, 200)
    case "SolverConfigError":
      return `solver "${error.solverId}": ${error.stderr.slice(0, 200)}`
    case "Timeout":
      return `timed out after ${error.timeoutMs}ms`
    case "UnexpectedExit":
      return `exit ${error.exitCode}: ${error.stderr.slice(0, 200)}`
    case "UnexpectedOutput":
      return error.message
    case "FilesystemError":
      return error.message
  }
}

// --- Per-puzzle run ------------------------------------------------------------------------------

type Outcome =
  | "EXTRACT_FAILED"
  | "COMPILE_FAILED"
  | "SOLVE_ERROR"
  | "SOLVE_UNSATISFIABLE"
  | "SOLVE_MULTIPLY_SATISFIABLE"
  | "MATCH"
  | "MISMATCH"
  | "NO_ANSWER_KEY"

interface PuzzleRunRecord {
  readonly id: string
  readonly file: string
  readonly title: string
  readonly outcome: Outcome
  readonly durationMs: number
  readonly resolvedModel: string | null
  readonly extractedCsp: unknown
  readonly mzn: string | null
  readonly solveResultTag: string | null
  readonly assignment: unknown
  readonly comparison: Comparison | null
  readonly extractionError: { readonly tag: string; readonly detail: string; readonly criticAttempts: number | null } | null
  readonly compileError: { readonly reason: string } | null
  readonly solveError: { readonly tag: string; readonly detail: string } | null
}

function record(
  puzzle: Puzzle,
  outcome: Outcome,
  durationMs: number,
  extra: Partial<Omit<PuzzleRunRecord, "id" | "file" | "title" | "outcome" | "durationMs">> = {},
  title: string,
): PuzzleRunRecord {
  return {
    id: puzzle.id,
    file: puzzle.file,
    title,
    outcome,
    durationMs,
    resolvedModel: extra.resolvedModel ?? null,
    extractedCsp: extra.extractedCsp ?? null,
    mzn: extra.mzn ?? null,
    solveResultTag: extra.solveResultTag ?? null,
    assignment: extra.assignment ?? null,
    comparison: extra.comparison ?? null,
    extractionError: extra.extractionError ?? null,
    compileError: extra.compileError ?? null,
    solveError: extra.solveError ?? null,
  }
}

type StageOutcome<A, E> = { readonly _tag: "Ok"; readonly value: A } | { readonly _tag: "Err"; readonly error: E }

// Each pipeline stage runs (and is caught) independently, rather than as one Effect.gen chain,
// so a later stage's failure doesn't discard an earlier stage's already-succeeded result — the
// whole point of capturing raw detail per run is to diagnose failures, and a SOLVE_ERROR without
// the extractedCsp/mzn that produced it is undiagnosable from the raw JSON alone.
function runStage<A, E>(effect: Effect.Effect<A, E>): Promise<StageOutcome<A, E>> {
  return Effect.runPromise(
    effect.pipe(
      Effect.map((value) => ({ _tag: "Ok" as const, value })),
      Effect.catch((error: E) => Effect.succeed({ _tag: "Err" as const, error })),
    ),
  )
}

async function runOnePuzzle(
  puzzle: Puzzle,
  answerKeyEntry: AnswerKeyEntry | undefined,
  modelOpts: { model?: string | undefined; frontierModel?: string | undefined },
): Promise<PuzzleRunRecord> {
  const startedAt = Date.now()
  const prose = await readFile(puzzle.path, "utf8")
  const title = answerKeyEntry?.title ?? puzzle.file
  const durationMs = () => Date.now() - startedAt

  const extractOutcome = await runStage(extract(prose, modelOpts))
  if (extractOutcome._tag === "Err") {
    const error = extractOutcome.error
    return record(
      puzzle,
      "EXTRACT_FAILED",
      durationMs(),
      {
        extractionError: {
          tag: error._tag,
          detail: summarizeExtractionError(error),
          criticAttempts: error._tag === "CriticRejected" ? error.attempts.length : null,
        },
      },
      title,
    )
  }
  const { extractedCsp, model } = extractOutcome.value

  const compileOutcome = await runStage(compile(extractedCsp))
  if (compileOutcome._tag === "Err") {
    return record(
      puzzle,
      "COMPILE_FAILED",
      durationMs(),
      { extractedCsp, resolvedModel: model, compileError: { reason: compileOutcome.error.reason } },
      title,
    )
  }
  const mzn = compileOutcome.value

  const solveOutcome = await runStage(solve({ model: mzn }))
  if (solveOutcome._tag === "Err") {
    const error = solveOutcome.error
    return record(
      puzzle,
      "SOLVE_ERROR",
      durationMs(),
      { extractedCsp, mzn, resolvedModel: model, solveError: { tag: error._tag, detail: summarizeSolverError(error) } },
      title,
    )
  }
  const solveResult = solveOutcome.value
  const finalDurationMs = durationMs()

  if (solveResult._tag === "Unsatisfiable") {
    return record(puzzle, "SOLVE_UNSATISFIABLE", finalDurationMs, { extractedCsp, mzn, resolvedModel: model, solveResultTag: solveResult._tag }, title)
  }
  if (solveResult._tag === "MultiplySatisfiable") {
    return record(
      puzzle,
      "SOLVE_MULTIPLY_SATISFIABLE",
      finalDurationMs,
      { extractedCsp, mzn, resolvedModel: model, solveResultTag: solveResult._tag, assignment: solveResult.assignments },
      title,
    )
  }

  // UniquelySolvable
  if (!answerKeyEntry) {
    return record(
      puzzle,
      "NO_ANSWER_KEY",
      finalDurationMs,
      { extractedCsp, mzn, resolvedModel: model, solveResultTag: solveResult._tag, assignment: solveResult.assignment },
      title,
    )
  }

  const comparison = compareAnswer(
    answerKeyEntry.answer,
    recoverEntityKeyedArrays(solveResult.assignment, extractedCsp),
  )
  return record(
    puzzle,
    comparison.verdict,
    finalDurationMs,
    {
      extractedCsp,
      mzn,
      resolvedModel: model,
      solveResultTag: solveResult._tag,
      assignment: solveResult.assignment,
      comparison,
    },
    title,
  )
}

// --- Reporting -------------------------------------------------------------------------------

function getGitCommitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

interface Summary {
  readonly total: number
  readonly byOutcome: Record<Outcome, number>
  readonly passRate: number
}

function summarize(records: readonly PuzzleRunRecord[]): Summary {
  const byOutcome: Record<Outcome, number> = {
    EXTRACT_FAILED: 0,
    COMPILE_FAILED: 0,
    SOLVE_ERROR: 0,
    SOLVE_UNSATISFIABLE: 0,
    SOLVE_MULTIPLY_SATISFIABLE: 0,
    MATCH: 0,
    MISMATCH: 0,
    NO_ANSWER_KEY: 0,
  }
  for (const r of records) byOutcome[r.outcome] += 1
  const total = records.length
  return { total, byOutcome, passRate: total === 0 ? 0 : byOutcome.MATCH / total }
}

function outcomeDetail(r: PuzzleRunRecord): string {
  if (r.outcome === "EXTRACT_FAILED" && r.extractionError) {
    const attempts = r.extractionError.criticAttempts !== null ? `, ${r.extractionError.criticAttempts} attempts` : ""
    return `${r.outcome} (${r.extractionError.tag}${attempts})`
  }
  if (r.outcome === "COMPILE_FAILED" && r.compileError) return `${r.outcome} (${r.compileError.reason.slice(0, 80)})`
  if (r.outcome === "SOLVE_ERROR" && r.solveError) return `${r.outcome} (${r.solveError.tag})`
  return r.outcome
}

async function writeRawResults(
  runId: string,
  data: {
    startedAt: Date
    finishedAt: Date
    gitCommit: string
    modelOpts: ParsedArgs
    records: readonly PuzzleRunRecord[]
    summary: Summary
  },
): Promise<URL> {
  await mkdir(RESULTS_DIR, { recursive: true })
  const path = new URL(`${runId}.json`, RESULTS_DIR)
  const payload = {
    runId,
    startedAt: data.startedAt.toISOString(),
    finishedAt: data.finishedAt.toISOString(),
    gitCommit: data.gitCommit,
    modelConfig: { model: data.modelOpts.model ?? null, frontierModel: data.modelOpts.frontierModel ?? null },
    concurrency: "sequential",
    puzzles: data.records,
    summary: data.summary,
  }
  await writeFile(path, JSON.stringify(payload, null, 2))
  return path
}

const RESULTS_MD_HEADER = `# Extraction Eval Results

Append-only log — newest run at the bottom. Raw per-puzzle detail (extracted CSP, compiled
MiniZinc, solver output, and comparison detail) for every run lives in the gitignored
\`eval/results/<run-id>.json\`; this file is the committed, human-readable summary only.
Produced by \`scripts/eval-extraction.ts\` (\`pnpm eval\` or \`node scripts/eval-extraction.ts\`).

**Legend:** \`MATCH\`/\`MISMATCH\` require \`solve()\` to report \`UniquelySolvable\`, then compare its
assignment against \`eval/answer-keys.json\` via \`flatten\`/\`compareAnswer\` (see the script's header
comment for the exact algorithm and its known limitation). For puzzles whose answer is a set of
parallel arrays — ${ARRAY_PAIRING_BLIND_SPOT_IDS.join(", ")} — this verifies vocabulary only, not
pairing or ordering; treat a \`MATCH\` there as "uniquely solved, used the right values," not a full
correctness proof.
`

async function appendResultsMarkdown(data: {
  runId: string
  startedAt: Date
  gitCommit: string
  modelOpts: ParsedArgs
  records: readonly PuzzleRunRecord[]
  summary: Summary
  rawResultsPath: URL
}): Promise<void> {
  if (!existsSync(RESULTS_MD_PATH)) {
    await writeFile(RESULTS_MD_PATH, RESULTS_MD_HEADER)
  }

  const modelLine = `Model: \`${data.modelOpts.model ?? "openai/gpt-4o-mini (default)"}\` (frontier: \`${data.modelOpts.frontierModel ?? "anthropic/claude-sonnet-4.5 (default)"}\`)`
  const rows = data.records.map((r) => `| ${r.id} | ${outcomeDetail(r)} |`).join("\n")
  const rawResultsRelPath = fileURLToPath(data.rawResultsPath).replace(`${REPO_ROOT}`, "")

  const section = `
---

## ${data.startedAt.toISOString().replace(/\.\d+Z$/, "Z")} — commit \`${data.gitCommit}\`

${modelLine} · ${data.summary.total} puzzles · pass rate **${data.summary.byOutcome.MATCH}/${data.summary.total} (${Math.round(data.summary.passRate * 100)}%)**

| Puzzle | Outcome |
|---|---|
${rows}

Full detail: \`${rawResultsRelPath}\`
`
  await appendFile(RESULTS_MD_PATH, section)
}

function printSummary(records: readonly PuzzleRunRecord[], summary: Summary, gitCommit: string): void {
  console.log(`\n=== Eval summary — ${new Date().toISOString()}, commit ${gitCommit} ===\n`)
  for (const r of records) {
    const status = r.outcome === "MATCH" ? "OK  " : "FAIL"
    console.log(`  ${status} ${r.id}  ${outcomeDetail(r)}`)
  }
  console.log(`\nPass rate: ${summary.byOutcome.MATCH}/${summary.total} (${Math.round(summary.passRate * 100)}%)`)
}

// --- Main ----------------------------------------------------------------------------------------

async function main(): Promise<void> {
  loadEnvFileIfPresent(new URL("../.env", import.meta.url).pathname)
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY is not set. Add it to .env at the repo root, or export it in your shell, then re-run.")
    process.exit(1)
  }

  const args = parseArgs(process.argv.slice(2))
  const answerKeys = await loadAnswerKeys()
  const puzzles = await listPuzzleFiles(args.puzzleIds)
  if (puzzles.length === 0) {
    console.error("No matching puzzles found in catalog/puzzles/.")
    process.exit(1)
  }
  const modelOpts = {
    model: args.model ?? process.env.ZEBRA_MODEL,
    frontierModel: args.frontierModel ?? process.env.ZEBRA_FRONTIER_MODEL,
  }

  const startedAt = new Date()
  const records: PuzzleRunRecord[] = []
  for (const puzzle of puzzles) {
    process.stdout.write(`Running ${puzzle.id} (${answerKeys[puzzle.id]?.title ?? puzzle.file})... `)
    const rec = await runOnePuzzle(puzzle, answerKeys[puzzle.id], modelOpts)
    records.push(rec)
    console.log(`${outcomeDetail(rec)} (${(rec.durationMs / 1000).toFixed(1)}s)`)
  }
  const finishedAt = new Date()
  const gitCommit = getGitCommitSha()
  const summary = summarize(records)

  printSummary(records, summary, gitCommit)

  const runId = startedAt.toISOString().replace(/[:.]/g, "-")
  const rawResultsPath = await writeRawResults(runId, { startedAt, finishedAt, gitCommit, modelOpts: args, records, summary })
  await appendResultsMarkdown({ runId, startedAt, gitCommit, modelOpts: args, records, summary, rawResultsPath })

  console.log(`\nRaw detail: ${fileURLToPath(rawResultsPath)}`)
  console.log(`Summary appended to: ${fileURLToPath(RESULTS_MD_PATH)}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
