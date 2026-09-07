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
 *   node scripts/eval-extraction.ts                  # every catalog puzzle
 *   node scripts/eval-extraction.ts PZL-0004 PZL-0007 # just these
 *   node scripts/eval-extraction.ts --model openai/gpt-4o-mini --frontier-model anthropic/claude-sonnet-4.5
 *   node scripts/eval-extraction.ts --runs 3          # repeat each puzzle 3x, report frequency
 *   node scripts/eval-extraction.ts --budget-usd 5    # abort when estimated/actual spend exceeds $5
 *   node scripts/eval-extraction.ts --no-critic        # ablation (b): single-shot, no critic
 *   node scripts/eval-extraction.ts --compile-repair-only  # ablation (c): compile-repair loop, no critic
 *   node scripts/eval-extraction.ts --harness <id>        # any registered harness by id
 *                                                          # (src/eval/harness.ts); wins over the flags above
 *   node scripts/eval-extraction.ts --harness direct-solve # baseline: solve in prose, judge to verdict
 *   node scripts/eval-extraction.ts --baseline <run-id>.json --timeout-factor 3
 *                                                          # wall-clock cap per puzzle at 3x its baseline
 *                                                          # duration; overruns record TIMEOUT
 */
import { execFileSync } from "node:child_process"
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { sanitizeIdentifier } from "../src/compiler/compile.ts"
import {
  gradeAmbiguous,
  gradeCop,
  gradeDeterminate,
  gradeNonProblem,
  gradeSubjective,
  isExcludedVerdict,
  isPassingVerdict,
  type AliasTable,
  type AmbiguousReading,
  type GraderVerdict,
  type OutcomeClass,
  type SubjectiveEntry,
} from "../src/eval/grader.ts"
import {
  WORKFLOW_TO_HARNESS_ID,
  lookupHarness,
  type EvalHarness,
} from "../src/eval/harness.ts"
import type { ExtractedCsp } from "../src/extraction/types.ts"
import { loadEnvFileIfPresent } from "../src/cli/load-env.ts"
import type { Assignment, SolveResult } from "../src/solver/types.ts"
import { DEFAULT_JUDGE_MODEL } from "../src/eval/direct-solve.ts"

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url))
const PUZZLES_DIR = new URL("../catalog/puzzles/", import.meta.url)
const ANSWER_KEYS_PATH = new URL("../eval/answer-keys.json", import.meta.url)
const ALIASES_PATH = new URL("../eval/aliases.json", import.meta.url)
const MODELS_PATH = new URL("../eval/models.json", import.meta.url)
const RESULTS_DIR = new URL("../eval/results/", import.meta.url)
const RESULTS_MD_PATH = new URL("../eval/results.md", import.meta.url)

// --- CLI args ----------------------------------------------------------------------------------

/**
 * The old ablation flag values. Preserved verbatim so existing invocations keep working;
 * each maps to a harness id (WORKFLOW_TO_HARNESS_ID). `--harness` takes precedence when both
 * are given; a future harness is selected by id directly.
 */
type Workflow = "full" | "no-critic" | "compile-repair-only"

interface ParsedArgs {
  readonly puzzleIds: readonly string[]
  readonly model?: string | undefined
  readonly frontierModel?: string | undefined
  readonly judgeModel?: string | undefined
  readonly runs: number
  readonly budgetUsd?: number | undefined
  readonly workflow: Workflow
  readonly harnessId?: string | undefined
  readonly baselinePath?: string | undefined
  readonly timeoutFactor: number
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const puzzleIds: string[] = []
  let model: string | undefined
  let frontierModel: string | undefined
  let judgeModel: string | undefined
  let runs = 1
  let budgetUsd: number | undefined
  let workflow: Workflow = "full"
  let harnessId: string | undefined
  let baselinePath: string | undefined
  let timeoutFactor = 3
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--model") model = argv[++i]
    else if (arg === "--frontier-model") frontierModel = argv[++i]
    else if (arg === "--judge-model") judgeModel = argv[++i]
    else if (arg === "--harness") harnessId = argv[++i]
    else if (arg === "--baseline") baselinePath = argv[++i]
    else if (arg === "--timeout-factor") {
      const parsed = Number(argv[++i])
      if (!(parsed > 0)) throw new Error(`--timeout-factor needs a positive number, got "${argv[i]}"`)
      timeoutFactor = parsed
    } else if (arg === "--runs") {
      const parsed = Number(argv[++i])
      if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--runs needs a positive integer, got "${argv[i]}"`)
      runs = parsed
    } else if (arg === "--budget-usd") {
      const parsed = Number(argv[++i])
      if (!(parsed > 0)) throw new Error(`--budget-usd needs a positive number, got "${argv[i]}"`)
      budgetUsd = parsed
    } else if (arg === "--no-critic") workflow = "no-critic"
    else if (arg === "--compile-repair-only") workflow = "compile-repair-only"
    else if (arg?.startsWith("--")) throw new Error(`Unknown flag: ${arg}`)
    else if (arg !== undefined) puzzleIds.push(arg)
  }
  if (timeoutFactor !== 3 && baselinePath === undefined) {
    throw new Error("--timeout-factor needs --baseline (it scales baseline durations)")
  }
  return { puzzleIds, model, frontierModel, judgeModel, runs, budgetUsd, workflow, harnessId, baselinePath, timeoutFactor }
}

/**
 * Loads per-puzzle wall-clock caps from a previous run's raw JSON: cap[puzzle] =
 * timeoutFactor x that puzzle's slowest recorded durationMs. A puzzle missing from the
 * baseline, a missing file, or an unreadable record fails loudly — a silent unbounded
 * fallback would defeat the purpose of the cap.
 */
export async function loadBaselineCaps(
  baselinePath: string,
  timeoutFactor: number,
): Promise<Record<string, number>> {
  const raw = JSON.parse(await readFile(baselinePath, "utf8")) as {
    puzzles?: ReadonlyArray<{ id?: unknown; durationMs?: unknown }>
  }
  if (!Array.isArray(raw.puzzles)) throw new Error(`Baseline "${baselinePath}" has no puzzles array`)
  const slowest: Record<string, number> = {}
  for (const puzzle of raw.puzzles) {
    if (typeof puzzle.id !== "string" || typeof puzzle.durationMs !== "number") {
      throw new Error(`Baseline "${baselinePath}" has a record without id/durationMs`)
    }
    slowest[puzzle.id] = Math.max(slowest[puzzle.id] ?? 0, puzzle.durationMs)
  }
  return Object.fromEntries(Object.entries(slowest).map(([id, ms]) => [id, Math.ceil(ms * timeoutFactor)]))
}

/** Resolves the harness for a run: explicit --harness wins, else the legacy workflow flag. */
export function resolveHarnessId(args: Pick<ParsedArgs, "workflow" | "harnessId">): string {
  if (args.harnessId !== undefined) return args.harnessId
  return WORKFLOW_TO_HARNESS_ID[args.workflow] ?? "full-critic"
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
  readonly outcome?: OutcomeClass | undefined
  readonly failing_condition?: string | undefined
  readonly readings?: readonly AmbiguousReading[] | undefined
  readonly without_premise?: SubjectiveEntry["without_premise"] | undefined
  readonly with_premise?: SubjectiveEntry["with_premise"] | undefined
}

async function loadAnswerKeys(): Promise<Record<string, AnswerKeyEntry>> {
  const raw = JSON.parse(await readFile(ANSWER_KEYS_PATH, "utf8")) as Record<string, unknown>
  const { $comment: _ignored, ...entries } = raw
  return entries as Record<string, AnswerKeyEntry>
}

async function loadAliases(): Promise<AliasTable> {
  const raw = JSON.parse(await readFile(ALIASES_PATH, "utf8")) as { aliases?: AliasTable }
  return raw.aliases ?? {}
}

interface ModelRegistryEntry {
  readonly id: string
  readonly tier: string
  readonly cost_per_call_usd: number
  readonly verified: boolean
  readonly notes?: string
}

async function loadModelRegistry(): Promise<readonly ModelRegistryEntry[]> {
  const raw = JSON.parse(await readFile(MODELS_PATH, "utf8")) as { models?: ModelRegistryEntry[] }
  return raw.models ?? []
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

// --- Entity recovery ------------------------------------------------------------------------------

/**
 * Recovers entity-name vocabulary for an array-typed (entity-indexed) domain variable's solved
 * value — MiniZinc's own `--output-mode json` never carries it, an array is purely positional,
 * not keyed by the enum that indexes it. Confirmed live on PZL-0010: the solved assignment
 * (`{"order": [4,1,3,5,2]}`) never mentions "North"/"South"/etc. anywhere, even though the answer
 * key is exactly that vocabulary in declared order, and the puzzle solved correctly. Zips each
 * array against the SAME entities, in the SAME declared order, `src/compiler/compile.ts` itself
 * indexes that array by (`csp.entities` filtered by the domain's `entityType`), so those ids
 * appear in the solved assignment the grader compares. Pairing verification itself lives in
 * src/eval/grader.ts — this only restores missing vocabulary. Does not cover PZL-0006 (a
 * mapping keyed by row NUMBERS that don't match any entity id): the grader owns that shape
 * explicitly instead.
 */
function recoverEntityKeyedArrays(assignment: Assignment, extractedCsp: ExtractedCsp): Assignment {
  const recovered: Record<string, unknown> = { ...assignment }
  for (const domain of extractedCsp.domains) {
    // solve()'s assignment keys are minizinc's own (compile.ts-sanitized) identifiers, e.g.
    // "house-color" compiles and returns as "house_color" — look up (and write back) under
    // that same sanitized key, not the raw extracted variable name, or a variable needing
    // sanitization silently fails to be recovered.
    const key = sanitizeIdentifier(domain.variable)
    const value = recovered[key]
    if (!Array.isArray(value)) continue
    const entityIds = extractedCsp.entities.filter((e) => e.type === domain.entityType).map((e) => e.id)
    if (entityIds.length !== value.length) continue
    recovered[key] = Object.fromEntries(entityIds.map((id, i) => [id, value[i]]))
  }
  return recovered
}

// --- Per-puzzle run ------------------------------------------------------------------------------

type Outcome =
  | "EXTRACT_FAILED"
  | "COMPILE_FAILED"
  | "TIMEOUT"
  | "SOLVE_ERROR"
  | "SOLVE_UNSATISFIABLE"
  | "SOLVE_MULTIPLY_SATISFIABLE"
  | "MATCH"
  | "MISMATCH"
  | "OPTIMUM_ATTAINED"
  | "FEASIBLE_ONLY"
  | "INFEASIBLE"
  | "READING_MATCHED"
  | "NO_MATCHING_READING"
  | "PREMISE_FREE_MATCH"
  | "PREMISE_SILENTLY_PROMOTED"
  | "DECLINED_CORRECTLY"
  | "UNDECLINED"
  | "NO_ANSWER_KEY"

interface PuzzleRunRecord {
  readonly id: string
  readonly file: string
  readonly title: string
  readonly outcome: Outcome
  readonly durationMs: number
  readonly runIndex: number
  readonly workflow: Workflow
  readonly harnessId: string
  readonly promptVersion: number
  readonly resolvedModel: string | null
  readonly extractedCsp: unknown
  readonly mzn: string | null
  readonly solveResultTag: string | null
  readonly assignment: unknown
  readonly graderDetail: string | null
  readonly aliasesApplied: number
  readonly extractionError: { readonly tag: string; readonly detail: string; readonly criticAttempts: number | null } | null
  readonly compileError: { readonly reason: string } | null
  readonly solveError: { readonly tag: string; readonly detail: string } | null
}

interface RecordContext {
  readonly runIndex: number
  readonly workflow: Workflow
  readonly harness: EvalHarness
}

function record(
  puzzle: Puzzle,
  outcome: Outcome,
  durationMs: number,
  extra: Partial<Omit<PuzzleRunRecord, "id" | "file" | "title" | "outcome" | "durationMs" | "runIndex" | "workflow" | "harnessId" | "promptVersion">> = {},
  title: string,
  ctx: RecordContext,
): PuzzleRunRecord {
  return {
    id: puzzle.id,
    file: puzzle.file,
    title,
    outcome,
    durationMs,
    runIndex: ctx.runIndex,
    workflow: ctx.workflow,
    harnessId: ctx.harness.id,
    promptVersion: ctx.harness.promptVersion,
    resolvedModel: extra.resolvedModel ?? null,
    extractedCsp: extra.extractedCsp ?? null,
    mzn: extra.mzn ?? null,
    solveResultTag: extra.solveResultTag ?? null,
    assignment: extra.assignment ?? null,
    graderDetail: extra.graderDetail ?? null,
    aliasesApplied: extra.aliasesApplied ?? 0,
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

/**
 * ADR-007 §2.1: grades a reached SolveResult against the entry's outcome class.
 *
 * Two answer-key shapes exist: newer entries carry the class marker at top level
 * (`outcome`, `readings`, ...), while the PZL-0015–0038 provisional entries nest it inside
 * `answer` (`answer.outcome`, `answer.readings`, and PZL-0038's doubly-nested
 * `answer.answer`). Both normalize here so the grader sees one shape — rewriting 20+
 * authored entries to a single shape is migration work, not grading work. Found live: the
 * direct-solve baseline graded non-problems as determinate until this normalization landed.
 */
function gradeSolved(
  puzzleId: string,
  entry: AnswerKeyEntry | undefined,
  solveResult: SolveResult,
  aliases: AliasTable,
): { readonly verdict: GraderVerdict | "NO_ANSWER_KEY" | "MISMATCH"; readonly detail: string; readonly aliasesApplied: number } {
  if (entry === undefined) return { verdict: "NO_ANSWER_KEY", detail: "no answer key", aliasesApplied: 0 }
  const nested = (entry.answer !== null && typeof entry.answer === "object" && !Array.isArray(entry.answer)
    ? (entry.answer as Record<string, unknown>)
    : undefined) as
    | {
        outcome?: unknown
        readings?: readonly AmbiguousReading[]
        failing_condition?: string
        without_premise?: SubjectiveEntry["without_premise"]
        with_premise?: SubjectiveEntry["with_premise"]
        answer?: unknown
      }
    | undefined
  const effectiveOutcome = (entry.outcome ?? nested?.outcome ?? "determinate") as OutcomeClass
  // PZL-0038 nests the assignment one level deeper (answer.answer); flat answers pass through.
  const effectiveAnswer = nested?.answer !== undefined ? nested.answer : entry.answer
  switch (effectiveOutcome) {
    case "cop":
      return { ...gradeCop(puzzleId, solveResult), aliasesApplied: 0 }
    case "ambiguous":
      return {
        ...gradeAmbiguous(entry.readings ?? nested?.readings ?? [], solveResult, puzzleId, aliases),
        aliasesApplied: 0,
      }
    case "subjective":
      return {
        ...gradeSubjective(
          {
            without_premise: entry.without_premise ?? nested?.without_premise,
            with_premise: entry.with_premise ?? nested?.with_premise,
          },
          solveResult,
          puzzleId,
          aliases,
        ),
        aliasesApplied: 0,
      }
    case "non-problem":
      return { ...gradeNonProblem(entry.failing_condition ?? nested?.failing_condition), aliasesApplied: 0 }
    case "determinate": {
      if (solveResult._tag !== "UniquelySolvable") {
        return { verdict: "MISMATCH", detail: `expected unique solution, got ${solveResult._tag}`, aliasesApplied: 0 }
      }
      return gradeDeterminate(puzzleId, effectiveAnswer, solveResult.assignment, aliases)
    }
  }
}

async function runOnePuzzle(
  puzzle: Puzzle,
  answerKeyEntry: AnswerKeyEntry | undefined,
  modelOpts: { model?: string | undefined; frontierModel?: string | undefined; judgeModel?: string | undefined },
  aliases: AliasTable,
  ctx: RecordContext,
): Promise<PuzzleRunRecord> {
  const startedAt = Date.now()
  const prose = await readFile(puzzle.path, "utf8")
  const title = answerKeyEntry?.title ?? puzzle.file
  const durationMs = () => Date.now() - startedAt

  // The direct-solve judge grades against the answer key, so it receives the entry
  // serialized; other harnesses ignore the field. Absent keys fail loudly in the harness.
  const harnessOpts =
    ctx.harness.id === "direct-solve"
      ? { ...modelOpts, answerKeyJson: JSON.stringify({ id: puzzle.id, ...answerKeyEntry }) }
      : modelOpts

  // Each harness stage runs (and is caught) independently, so a later stage's failure doesn't
  // discard an earlier stage's already-succeeded result — a SOLVE_ERROR without the
  // extractedCsp/mzn that produced it is undiagnosable from the raw JSON alone.
  const extractOutcome = await runStage(ctx.harness.extract(prose, harnessOpts))
  if (extractOutcome._tag === "Err") {
    const error = extractOutcome.error
    return record(
      puzzle,
      "EXTRACT_FAILED",
      durationMs(),
      {
        extractionError: { tag: error.tag, detail: error.detail, criticAttempts: error.criticAttempts },
      },
      title,
      ctx,
    )
  }
  const extraction = extractOutcome.value

  const compileOutcome = await runStage(ctx.harness.compile(extraction))
  if (compileOutcome._tag === "Err") {
    return record(
      puzzle,
      "COMPILE_FAILED",
      durationMs(),
      {
        extractedCsp: extraction.extractedCsp,
        resolvedModel: extraction.model,
        compileError: { reason: compileOutcome.error.reason },
      },
      title,
      ctx,
    )
  }
  const compilation = compileOutcome.value

  const solveOutcome = await runStage(ctx.harness.solve(compilation))
  if (solveOutcome._tag === "Err") {
    const error = solveOutcome.error
    return record(
      puzzle,
      "SOLVE_ERROR",
      durationMs(),
      {
        extractedCsp: compilation.extractedCsp,
        mzn: compilation.mzn,
        resolvedModel: compilation.model,
        solveError: { tag: error.tag, detail: error.detail },
      },
      title,
      ctx,
    )
  }
  const { solveResult, extractedCsp, model, mzn } = solveOutcome.value
  const finalDurationMs = durationMs()

  // The direct-solve baseline carries a judge's verdict, not a SolveResult to grade:
  // map it to an outcome directly (ADR-008 §2.2). Every other harness grades here.
  if (ctx.harness.id === "direct-solve") {
    const judged = gradeJudged(
      puzzle.id,
      answerKeyEntry,
      (extractedCsp as { judgeVerdict?: unknown }).judgeVerdict,
    )
    return record(
      puzzle,
      judged.verdict,
      finalDurationMs,
      {
        extractedCsp,
        mzn,
        resolvedModel: model,
        solveResultTag: solveResult._tag,
        assignment: null,
        graderDetail: judged.detail,
        aliasesApplied: 0,
      },
      title,
      ctx,
    )
  }

  // Entity-vocabulary recovery assumes this pipeline's ExtractedCsp (a domains array).
  // Harnesses with their own representation skip it.
  const csp = extractedCsp as { domains?: unknown }
  const recovered =
    solveResult._tag === "UniquelySolvable" && Array.isArray(csp.domains)
      ? recoverEntityKeyedArrays(solveResult.assignment, extractedCsp as ExtractedCsp)
      : null
  const graded = gradeSolved(
    puzzle.id,
    answerKeyEntry,
    recovered !== null ? { _tag: "UniquelySolvable", assignment: recovered } : solveResult,
    aliases,
  )

  return record(
    puzzle,
    graded.verdict,
    finalDurationMs,
    {
      extractedCsp,
      mzn,
      resolvedModel: model,
      solveResultTag: solveResult._tag,
      assignment:
        solveResult._tag === "Unsatisfiable"
          ? null
          : solveResult._tag === "UniquelySolvable"
            ? solveResult.assignment
            : solveResult.assignments,
      graderDetail: graded.detail,
      aliasesApplied: graded.aliasesApplied,
    },
    title,
    ctx,
  )
}

/**
 * Maps a direct-solve judge verdict to a display outcome (ADR-008 §2.2). The judge already
 * applied the per-class semantics from the answer key; this only translates its vocabulary
 * into the shared outcome taxonomy. 'correct'/'incorrect' fan out to the class-appropriate
 * pass/fail verdicts so pass-rate accounting treats baseline and pipeline verdicts alike.
 */
export function gradeJudged(
  puzzleId: string,
  entry: AnswerKeyEntry | undefined,
  judgeVerdict: unknown,
): { readonly verdict: Outcome; readonly detail: string } {
  const fail = (detail: string): { readonly verdict: Outcome; readonly detail: string } => ({
    verdict: "EXTRACT_FAILED",
    detail,
  })
  if (entry === undefined) return { verdict: "NO_ANSWER_KEY", detail: "no answer key" }
  const verdict = judgeVerdict as { verdict?: unknown; reason?: unknown } | undefined
  if (verdict?.verdict !== "correct" && verdict?.verdict !== "incorrect" && verdict?.verdict !== "unclear") {
    return fail(`judge returned no usable verdict for ${puzzleId}`)
  }
  const reason = typeof verdict.reason === "string" ? verdict.reason.slice(0, 300) : ""
  const outcomeClass = effectiveOutcomeClass(entry)
  if (verdict.verdict === "unclear") {
    return {
      verdict: "EXTRACT_FAILED",
      detail: `JudgeUnclear: ${reason}`,
    }
  }
  const pass: Record<OutcomeClass, Outcome> = {
    determinate: "MATCH",
    cop: "OPTIMUM_ATTAINED",
    ambiguous: "READING_MATCHED",
    subjective: "PREMISE_FREE_MATCH",
    "non-problem": "DECLINED_CORRECTLY",
  }
  const failOutcome: Record<OutcomeClass, Outcome> = {
    determinate: "MISMATCH",
    cop: "FEASIBLE_ONLY",
    ambiguous: "NO_MATCHING_READING",
    subjective: "PREMISE_SILENTLY_PROMOTED",
    "non-problem": "UNDECLINED",
  }
  // A COP 'incorrect' (wrong optimum, no solution found) is FEASIBLE_ONLY-shaped, and a
  // non-problem 'incorrect' is UNDECLINED-shaped — both are still failures for pass-rate
  // purposes here, unlike the deterministic pipeline's genuine FEASIBLE_ONLY/UNDECLINED
  // (no optimum in capped output; no decline mechanism exists at all). This harness's judge
  // IS a decline mechanism, so an incorrect verdict means it was used and got it wrong — a
  // real, attributable failure (ADR-007 §2.1) — so map both to MISMATCH to keep them in the
  // denominator as failures.
  if (verdict.verdict === "correct") return { verdict: pass[outcomeClass], detail: reason }
  if (outcomeClass === "cop" || outcomeClass === "non-problem") return { verdict: "MISMATCH", detail: reason }
  return { verdict: failOutcome[outcomeClass], detail: reason }
}

/** The entry's outcome class, honoring both the top-level and the nested provisional shape. */
function effectiveOutcomeClass(entry: AnswerKeyEntry): OutcomeClass {
  if (entry.outcome !== undefined) return entry.outcome
  const answer = entry.answer
  if (answer !== null && typeof answer === "object" && !Array.isArray(answer)) {
    const outcome = (answer as Record<string, unknown>).outcome
    if (
      outcome === "determinate" ||
      outcome === "cop" ||
      outcome === "ambiguous" ||
      outcome === "subjective" ||
      outcome === "non-problem"
    ) {
      return outcome
    }
  }
  return "determinate"
}

// --- Budget (ADR-007 §2.3) ------------------------------------------------------------------------

interface BudgetState {
  spendUsd: number
  calls: number
  readonly budgetUsd: number | undefined
  // Worst-case dollars for one puzzle's full set of calls. Not always
  // `solverCostPerCall * maxCallsPerPuzzle`: a harness whose calls have different per-role
  // costs (e.g. direct-solve's judge, ADR-008 §2.4) sums each call's own rate instead — see
  // where this is constructed in main().
  readonly costPerPuzzleUsd: number
  readonly maxCallsPerPuzzle: number
}

function createBudget(budgetUsd: number | undefined, costPerPuzzleUsd: number, maxCallsPerPuzzle: number): BudgetState {
  return { spendUsd: 0, calls: 0, budgetUsd, costPerPuzzleUsd, maxCallsPerPuzzle }
}

/** Pre-run estimate: registry cost x puzzles x repeats. Aborts when over budget. */
function checkBudgetEstimate(budget: BudgetState, puzzleCount: number, runs: number): string | null {
  if (budget.budgetUsd === undefined) return null
  const estimate = budget.costPerPuzzleUsd * puzzleCount * runs
  return estimate > budget.budgetUsd
    ? `estimated spend $${estimate.toFixed(2)} exceeds --budget-usd $${budget.budgetUsd.toFixed(2)} (${puzzleCount} puzzles x ${runs} runs x $${budget.costPerPuzzleUsd.toFixed(4)}/puzzle worst-case) — refusing to start`
    : null
}

/** Per-puzzle spend accumulator. Returns false when the budget is exceeded (caller stops). */
function chargePuzzle(budget: BudgetState): boolean {
  budget.calls += budget.maxCallsPerPuzzle
  budget.spendUsd += budget.costPerPuzzleUsd
  return budget.budgetUsd === undefined || budget.spendUsd <= budget.budgetUsd
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
  readonly passes: number
  readonly excluded: number
  readonly passRate: number
}

function summarize(records: readonly PuzzleRunRecord[]): Summary {
  const byOutcome: Record<Outcome, number> = {
    EXTRACT_FAILED: 0,
    COMPILE_FAILED: 0,
    TIMEOUT: 0,
    SOLVE_ERROR: 0,
    SOLVE_UNSATISFIABLE: 0,
    SOLVE_MULTIPLY_SATISFIABLE: 0,
    MATCH: 0,
    MISMATCH: 0,
    OPTIMUM_ATTAINED: 0,
    FEASIBLE_ONLY: 0,
    INFEASIBLE: 0,
    READING_MATCHED: 0,
    NO_MATCHING_READING: 0,
    PREMISE_FREE_MATCH: 0,
    PREMISE_SILENTLY_PROMOTED: 0,
    DECLINED_CORRECTLY: 0,
    UNDECLINED: 0,
    NO_ANSWER_KEY: 0,
  }
  for (const r of records) byOutcome[r.outcome] += 1
  const passes = records.filter((r) => isPassingVerdict(r.outcome as GraderVerdict)).length
  const excluded = records.filter((r) => isExcludedVerdict(r.outcome as GraderVerdict)).length
  const graded = records.length - excluded
  return { total: records.length, byOutcome, passes, excluded, passRate: graded === 0 ? 0 : passes / graded }
}

/** Per-puzzle pass frequency across repeats: "2/3 runs passed (MATCH, MISMATCH, MATCH)". */
function frequencyTable(records: readonly PuzzleRunRecord[]): string {
  const byPuzzle = new Map<string, PuzzleRunRecord[]>()
  for (const r of records) {
    const group = byPuzzle.get(r.id) ?? []
    group.push(r)
    byPuzzle.set(r.id, group)
  }
  return [...byPuzzle.entries()]
    .map(([id, group]) => {
      const passed = group.filter((r) => isPassingVerdict(r.outcome as GraderVerdict)).length
      const outcomes = group.map((r) => r.outcome).join(", ")
      return `| ${id} | ${passed}/${group.length} | ${outcomes} |`
    })
    .join("\n")
}

function outcomeDetail(r: PuzzleRunRecord): string {
  if (r.outcome === "EXTRACT_FAILED" && r.extractionError) {
    const attempts = r.extractionError.criticAttempts !== null ? `, ${r.extractionError.criticAttempts} attempts` : ""
    return `${r.outcome} (${r.extractionError.tag}${attempts})`
  }
  if (r.outcome === "COMPILE_FAILED" && r.compileError) return `${r.outcome} (${r.compileError.reason.slice(0, 80)})`
  if (r.outcome === "SOLVE_ERROR" && r.solveError) return `${r.outcome} (${r.solveError.tag})`
  if (
    r.graderDetail !== null &&
    (r.outcome === "MISMATCH" || r.outcome === "NO_MATCHING_READING" || r.outcome === "PREMISE_SILENTLY_PROMOTED")
  ) {
    return `${r.outcome} (${r.graderDetail.slice(0, 100)})`
  }
  return r.outcome
}

async function writeRawResults(
  runId: string,
  data: {
    startedAt: Date
    finishedAt: Date
    gitCommit: string
    modelOpts: ParsedArgs
    harness: EvalHarness
    runs: number
    spendUsd: number
    llmCalls: number
    aliasesVersion: number
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
    workflow: data.modelOpts.workflow,
    harnessId: data.harness.id,
    harnessDescription: data.harness.description,
    promptVersion: data.harness.promptVersion,
    runsPerPuzzle: data.runs,
    spendUsd: data.spendUsd,
    llmCalls: data.llmCalls,
    aliasesVersion: data.aliasesVersion,
    concurrency: "sequential",
    puzzles: data.records,
    summary: data.summary,
  }
  await writeFile(path, JSON.stringify(payload, null, 2))
  return path
}

const RESULTS_MD_HEADER = `# Extraction Eval Results

Append-only log — newest run at the bottom. Raw per-puzzle detail (extracted CSP, compiled
MiniZinc, solver output, and grader detail) for every run lives in the gitignored
\`eval/results/<run-id>.json\`; this file is the committed, human-readable summary only.
Produced by \`scripts/eval-extraction.ts\` (\`pnpm eval\` or \`node scripts/eval-extraction.ts\`).

**Legend:** \`MATCH\` requires \`solve()\` to report \`UniquelySolvable\` and the assignment to equal
the answer key under the pairing-aware rules in \`src/eval/grader.ts\` (ADR-007 §2.2:
parallel-array rows compared as multisets, PZL-0006's row-keyed mapping, PZL-0014's subset
semantics, flat-record token subsets). Other passing verdicts: \`OPTIMUM_ATTAINED\` (COP optimum
found), \`READING_MATCHED\` (ambiguous reading matched), \`PREMISE_FREE_MATCH\` (subjective,
premise-free outcome), \`DECLINED_CORRECTLY\` (non-problem declined with defect — no run can pass
this yet). \`FEASIBLE_ONLY\` and \`UNDECLINED\` are reported but excluded from the pass-rate
denominator. Pass rate is passes over graded runs.
`

async function appendResultsMarkdown(data: {
  runId: string
  startedAt: Date
  gitCommit: string
  modelOpts: ParsedArgs
  harnessId: string
  promptVersion: number
  records: readonly PuzzleRunRecord[]
  summary: Summary
  spendUsd: number
  rawResultsPath: URL
}): Promise<void> {
  if (!existsSync(RESULTS_MD_PATH)) {
    await writeFile(RESULTS_MD_PATH, RESULTS_MD_HEADER)
  }

  const modelLine = `Model: \`${data.modelOpts.model ?? "openai/gpt-4o-mini (default)"}\` (frontier: \`${data.modelOpts.frontierModel ?? "anthropic/claude-sonnet-4.5 (default)"}\`)`
  const harnessLine = data.harnessId === "full-critic" ? "" : ` · harness \`${data.harnessId}\` (prompt v${data.promptVersion})`
  const runsLine = data.modelOpts.runs > 1 ? ` · ${data.modelOpts.runs} runs/puzzle` : ""
  const rows = data.records.map((r) => `| ${r.id} | ${outcomeDetail(r)} |`).join("\n")
  const rawResultsRelPath = fileURLToPath(data.rawResultsPath).replace(`${REPO_ROOT}`, "")

  const frequencySection =
    data.modelOpts.runs > 1 ? `\n| Puzzle | Passed | Outcomes |\n|---|---|---|\n${frequencyTable(data.records)}\n` : ""

  const section = `
---

## ${data.startedAt.toISOString().replace(/\.\d+Z$/, "Z")} — commit \`${data.gitCommit}\`

${modelLine}${harnessLine}${runsLine} · ${data.summary.total} puzzle-runs · pass rate **${data.summary.passes}/${data.summary.total - data.summary.excluded} (${Math.round(data.summary.passRate * 100)}%)** · spend ~$${data.spendUsd.toFixed(2)}

| Puzzle | Outcome |
|---|---|
${rows}
${frequencySection}
Full detail: \`${rawResultsRelPath}\`
`
  await appendFile(RESULTS_MD_PATH, section)
}

function printSummary(records: readonly PuzzleRunRecord[], summary: Summary, gitCommit: string): void {
  console.log(`\n=== Eval summary — ${new Date().toISOString()}, commit ${gitCommit} ===\n`)
  for (const r of records) {
    const status = isPassingVerdict(r.outcome as GraderVerdict)
      ? "OK  "
      : isExcludedVerdict(r.outcome as GraderVerdict)
        ? "SKIP"
        : "FAIL"
    console.log(`  ${status} ${r.id}  ${outcomeDetail(r)}`)
  }
  console.log(`\nPass rate: ${summary.passes}/${summary.total - summary.excluded} (${Math.round(summary.passRate * 100)}%)`)
}

// --- Main ----------------------------------------------------------------------------------------

async function main(): Promise<void> {
  loadEnvFileIfPresent(new URL("../.env", import.meta.url).pathname)
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY is not set. Add it to .env at the repo root, or export it in your shell, then re-run.")
    process.exit(1)
  }

  const args = parseArgs(process.argv.slice(2))
  const harnessId = resolveHarnessId(args)
  const harness = lookupHarness(harnessId)
  if (harness === undefined) {
    console.error(`Unknown harness: "${harnessId}". Built-in: full-critic, single-shot, compile-repair.`)
    process.exit(1)
  }
  const answerKeys = await loadAnswerKeys()
  const aliases = await loadAliases()
  const registry = await loadModelRegistry()
  const puzzles = await listPuzzleFiles(args.puzzleIds)
  if (puzzles.length === 0) {
    console.error("No matching puzzles found in catalog/puzzles/.")
    process.exit(1)
  }
  const modelOpts = {
    // `||`, not `??`: an env var set to the empty string must fall through to the built-in
    // default, not override it with "".
    model: args.model || process.env.ZEBRA_MODEL || undefined,
    frontierModel: args.frontierModel || process.env.ZEBRA_FRONTIER_MODEL || undefined,
    judgeModel: args.judgeModel || process.env.ZEBRA_JUDGE_MODEL || undefined,
  }
  const baselineCaps =
    args.baselinePath !== undefined ? await loadBaselineCaps(args.baselinePath, args.timeoutFactor) : undefined
  const resolvedModel = modelOpts.model ?? "openai/gpt-4o-mini"
  const registryEntry = registry.find((m) => m.id === resolvedModel)
  const solverCostPerCall = registryEntry?.cost_per_call_usd ?? 0.002

  // ADR-008 §2.4: the judge is a call like any other — it must be a verified registry entry
  // before a run uses it, and its cost counts toward the budget alongside the solver's.
  let costPerPuzzleUsd = solverCostPerCall * harness.maxCallsPerPuzzle
  if (harness.id === "direct-solve") {
    const judgeModel = modelOpts.judgeModel ?? DEFAULT_JUDGE_MODEL
    const judgeEntry = registry.find((m) => m.id === judgeModel)
    if (judgeEntry === undefined || !judgeEntry.verified) {
      console.error(
        `Judge model "${judgeModel}" is not a verified entry in eval/models.json — refusing to run ` +
          `direct-solve with an unverified judge (ADR-008 §2.4). Verify it in the registry first, or ` +
          `pass --judge-model with one that already is.` +
          (judgeEntry?.notes !== undefined ? ` (${judgeEntry.notes})` : ""),
      )
      process.exit(1)
    }
    costPerPuzzleUsd = solverCostPerCall + judgeEntry.cost_per_call_usd
  }
  const budget = createBudget(args.budgetUsd, costPerPuzzleUsd, harness.maxCallsPerPuzzle)

  const estimateRefusal = checkBudgetEstimate(budget, puzzles.length, args.runs)
  if (estimateRefusal !== null) {
    console.error(estimateRefusal)
    process.exit(1)
  }

  const startedAt = new Date()
  const records: PuzzleRunRecord[] = []
  const ctx = { runIndex: 0, workflow: args.workflow, harness }
  let stoppedByBudget = false
  for (let runIndex = 0; runIndex < args.runs && !stoppedByBudget; runIndex++) {
    for (const puzzle of puzzles) {
      if (!chargePuzzle(budget)) {
        console.log(`\nBudget $${budget.budgetUsd?.toFixed(2)} exceeded after ~$${budget.spendUsd.toFixed(2)} — stopping.`)
        stoppedByBudget = true
        break
      }
      const runLabel = args.runs > 1 ? ` run ${runIndex + 1}/${args.runs}` : ""
      process.stdout.write(`Running ${puzzle.id} (${answerKeys[puzzle.id]?.title ?? puzzle.file})${runLabel}... `)
      // ADR-008 §2.5: wall-clock cap at timeoutFactor x the puzzle's baseline duration.
      // Raced here (not inside the harness) so one mechanism covers every harness uniformly;
      // the in-flight run keeps going in the background, but its record is TIMEOUT and the
      // runner moves on instead of hanging.
      const capMs = baselineCaps?.[puzzle.id]
      if (baselineCaps !== undefined && capMs === undefined) {
        console.log(`\nNo baseline duration for ${puzzle.id} — refusing to run uncapped.`)
        process.exit(1)
      }
      const runPromise = runOnePuzzle(puzzle, answerKeys[puzzle.id], modelOpts, aliases, { ...ctx, runIndex })
      const rec =
        capMs === undefined
          ? await runPromise
          : await Promise.race([
              runPromise,
              new Promise<PuzzleRunRecord>((resolve) =>
                setTimeout(
                  () =>
                    resolve(
                      record(
                        puzzle,
                        "TIMEOUT",
                        capMs,
                        { resolvedModel: modelOpts.model ?? null },
                        answerKeys[puzzle.id]?.title ?? puzzle.file,
                        { ...ctx, runIndex },
                      ),
                    ),
                  capMs,
                ),
              ),
            ])
      records.push(rec)
      console.log(`${outcomeDetail(rec)} (${(rec.durationMs / 1000).toFixed(1)}s)`)
    }
  }
  const finishedAt = new Date()
  const gitCommit = getGitCommitSha()
  const summary = summarize(records)

  printSummary(records, summary, gitCommit)

  const runId = startedAt.toISOString().replace(/[:.]/g, "-")
  const aliasesVersion = (JSON.parse(await readFile(ALIASES_PATH, "utf8")) as { version?: number }).version ?? 0
  const rawResultsPath = await writeRawResults(runId, {
    startedAt,
    finishedAt,
    gitCommit,
    modelOpts: args,
    harness,
    runs: args.runs,
    spendUsd: budget.spendUsd,
    llmCalls: budget.calls,
    aliasesVersion,
    records,
    summary,
  })
  await appendResultsMarkdown({
    runId,
    startedAt,
    gitCommit,
    modelOpts: args,
    harnessId: harness.id,
    promptVersion: harness.promptVersion,
    records,
    summary,
    spendUsd: budget.spendUsd,
    rawResultsPath,
  })

  console.log(`\nRaw detail: ${fileURLToPath(rawResultsPath)}`)
  console.log(`Summary appended to: ${fileURLToPath(RESULTS_MD_PATH)}`)
}

// Importable for unit tests (gradeJudged, loadBaselineCaps, resolveHarnessId) without running
// the full CLI — main() only fires when this file is the entrypoint.
const isEntrypoint = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")
if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
