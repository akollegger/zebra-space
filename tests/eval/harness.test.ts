import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

// Offline tests for the eval harness mechanics that don't need a key or the network:
// --budget-usd pre-run refusal, unknown-flag handling, and the matrix --dry-run plan.
// All run the scripts as subprocesses with a dummy key so they never touch OpenRouter.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url))

function runEval(args: readonly string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", ["scripts/eval-extraction.ts", ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, OPENROUTER_API_KEY: "dummy" },
    })
    return { stdout, stderr: "", exitCode: 0 }
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; status?: number }
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.status ?? 1 }
  }
}

/** Like runEval, but with full control over env (no dummy key auto-injected) — for the
 * local-mode API-key-gate tests, which need OPENROUTER_API_KEY genuinely unset. Set to "",
 * not deleted: loadEnvFileIfPresent only fills in vars that aren't already set, so deleting it
 * would let the repo root's real .env quietly supply a real key and defeat the test. */
function runEvalWithEnv(
  script: "eval-extraction" | "eval-matrix",
  args: readonly string[],
  env: Record<string, string | undefined>,
): { stdout: string; stderr: string; exitCode: number } {
  const fullEnv: Record<string, string | undefined> = { ...process.env, OPENROUTER_API_KEY: "" }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete fullEnv[key]
    else fullEnv[key] = value
  }
  try {
    const stdout = execFileSync("node", [`scripts/${script}.ts`, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: fullEnv,
    })
    return { stdout, stderr: "", exitCode: 0 }
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; status?: number }
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.status ?? 1 }
  }
}

test("budget gate: a pre-run estimate over --budget-usd refuses to start", () => {
  const result = runEval(["--budget-usd", "0.01", "PZL-0004"])
  assert.notEqual(result.exitCode, 0)
  assert.match(result.stdout + result.stderr, /exceeds --budget-usd/)
  assert.match(result.stdout + result.stderr, /refusing to start/)
})

test("budget gate: a sufficient budget passes the estimate (then fails only on no network/key path)", () => {
  const result = runEval(["--budget-usd", "50", "--runs", "abc", "PZL-0004"])
  assert.match(result.stdout + result.stderr, /--runs needs a positive integer/)
})

test("arg parsing: unknown flags and bad --runs/--budget-usd values are rejected", () => {
  assert.match(runEval(["--bogus"]).stderr, /Unknown flag: --bogus/)
  assert.match(runEval(["--runs", "0"]).stderr, /--runs needs a positive integer/)
  assert.match(runEval(["--budget-usd", "-3"]).stderr, /--budget-usd needs a positive number/)
})

test("harness flags: --harness selects by id, unknown ids are rejected", () => {
  assert.match(runEval(["--harness", "no-such-harness", "PZL-0004"]).stderr, /Unknown harness: "no-such-harness"/)
})

test("arg parsing: --timeout-factor needs --baseline and a positive number", () => {
  assert.match(runEval(["--timeout-factor", "5", "PZL-0004"]).stderr, /--timeout-factor needs --baseline/)
  assert.match(runEval(["--timeout-factor", "0", "--baseline", "x.json", "PZL-0004"]).stderr, /--timeout-factor needs a positive number/)
})

test("baseline: missing file or missing puzzle fails loudly, never silently uncapped", () => {
  assert.match(
    runEval(["--harness", "direct-solve", "--baseline", "no-such-file.json", "PZL-0004"]).stderr,
    /ENOENT|no such file/i,
  )
})

test("direct-solve: refuses loudly when the judge model is not a verified registry entry (ADR-008 §2.4)", () => {
  const result = runEval(["--harness", "direct-solve", "PZL-0004"])
  assert.notEqual(result.exitCode, 0)
  assert.match(result.stderr, /is not a verified entry in eval\/models\.json/)
  assert.match(result.stderr, /z-ai\/glm-5\.3-flash/)
})

test("direct-solve: --judge-model override is checked against the same verified gate", () => {
  const result = runEval(["--harness", "direct-solve", "--judge-model", "no-such-model/at-all", "PZL-0004"])
  assert.notEqual(result.exitCode, 0)
  assert.match(result.stderr, /is not a verified entry in eval\/models\.json/)
  assert.match(result.stderr, /no-such-model\/at-all/)
})

test("local mode: local-single-shot never demands OPENROUTER_API_KEY", () => {
  // A puzzle id that matches nothing fails right after the key check (main()'s next gate) —
  // proving this one passed — without ever reaching a real network call or writing results.
  const result = runEvalWithEnv("eval-extraction", ["--harness", "local-single-shot", "NO-SUCH-PUZZLE"], {
    ZEBRA_LOCAL_BASE_URL: "http://127.0.0.1:1",
  })
  assert.doesNotMatch(result.stdout + result.stderr, /OPENROUTER_API_KEY is not set/)
  assert.match(result.stderr, /No matching puzzles found/)
})

test("local mode: direct-solve still demands OPENROUTER_API_KEY (its judge is always forced onto OpenRouter)", () => {
  const result = runEvalWithEnv("eval-extraction", ["--harness", "direct-solve", "NO-SUCH-PUZZLE"], {
    ZEBRA_LOCAL_BASE_URL: "http://127.0.0.1:1",
  })
  assert.notEqual(result.exitCode, 0)
  assert.match(result.stderr, /OPENROUTER_API_KEY is not set/)
})

test("gradeJudged: verdicts fan out to class-appropriate outcomes", async () => {
  const { gradeJudged } = await import("../../scripts/eval-extraction.ts")
  const det = { title: "t", answer: { x: 1 }, notes: "" }
  assert.deepEqual(gradeJudged("P", det, { verdict: "correct", reason: "all match" }).verdict, "MATCH")
  assert.deepEqual(gradeJudged("P", det, { verdict: "incorrect", reason: "wrong value" }).verdict, "MISMATCH")
  const unclear = gradeJudged("P", det, { verdict: "unclear", reason: "no result" })
  assert.equal(unclear.verdict, "EXTRACT_FAILED")
  assert.match(unclear.detail, /JudgeUnclear/)
  const nonProblem = { title: "t", answer: { outcome: "non-problem", failing_condition: "Demand" }, notes: "" }
  assert.deepEqual(
    gradeJudged("P", nonProblem, { verdict: "correct", reason: "declined" }).verdict,
    "DECLINED_CORRECTLY",
  )
  // Non-problem incorrect stays a failure in the denominator: the judge IS a decline
  // mechanism, so an incorrect verdict here means it was used and got it wrong (ADR-007
  // §2.1) — never the deterministic pipeline's genuine UNDECLINED ("no mechanism at all").
  assert.deepEqual(
    gradeJudged("P", nonProblem, { verdict: "incorrect", reason: "solved anyway" }).verdict,
    "MISMATCH",
  )
  const cop = { title: "t", answer: {}, notes: "", outcome: "cop" as const }
  assert.deepEqual(gradeJudged("P", cop, { verdict: "correct", reason: "optimum" }).verdict, "OPTIMUM_ATTAINED")
  // COP incorrect stays a failure in the denominator, never FEASIBLE_ONLY-shaped pass.
  assert.deepEqual(gradeJudged("P", cop, { verdict: "incorrect", reason: "wrong" }).verdict, "MISMATCH")
  assert.deepEqual(gradeJudged("P", undefined, { verdict: "correct", reason: "" }).verdict, "NO_ANSWER_KEY")
  assert.deepEqual(gradeJudged("P", det, { verdict: "bogus", reason: "" }).verdict, "EXTRACT_FAILED")
})

// --- ADR-010 US2: budget charge semantics (T016) -------------------------------------------------

test("budget: a measured actual replaces the reserved estimate; absent falls back; zero is never fallback", async () => {
  const { createBudget, chargePuzzle, reconcilePuzzleCost } = await import("../../scripts/eval-extraction.ts")
  // Binary-exact values: the reserve/reconcile delta arithmetic is float addition, and
  // decimal cents (0.0252 etc.) would assert against representation noise, not semantics.

  // Measured actual replaces the estimate.
  const measured = createBudget(undefined, 0.25, 12)
  chargePuzzle(measured)
  assert.equal(measured.spendUsd, 0.25)
  reconcilePuzzleCost(measured, 0.125)
  assert.equal(measured.spendUsd, 0.125)

  // Absent actual (local/free-tier): the registry estimate stands.
  const absent = createBudget(undefined, 0.25, 12)
  chargePuzzle(absent)
  reconcilePuzzleCost(absent, null)
  assert.equal(absent.spendUsd, 0.25)

  // Measured zero: a real zero billing, never confused with absence.
  const zero = createBudget(undefined, 0.25, 12)
  chargePuzzle(zero)
  reconcilePuzzleCost(zero, 0)
  assert.equal(zero.spendUsd, 0)

  // Accumulation across puzzles mixes measured and fallback correctly.
  const mixed = createBudget(undefined, 0.25, 12)
  chargePuzzle(mixed)
  reconcilePuzzleCost(mixed, 0.125)
  chargePuzzle(mixed)
  reconcilePuzzleCost(mixed, null)
  assert.equal(mixed.spendUsd, 0.375)
  assert.equal(mixed.calls, 24)
})

test("budget: a refused charge rolls back its own reservation instead of inflating spend past what ran", async () => {
  const { createBudget, chargePuzzle } = await import("../../scripts/eval-extraction.ts")
  // $0.10/puzzle, a $0.15 cap: the first puzzle fits (spendUsd 0.10 <= 0.15), the second would
  // push spendUsd to 0.20 and must be refused — and refusing it must not leave that puzzle's
  // reservation standing, since it never ran (found in PR review of ADR-010: the unconditional
  // += before the budget check left a phantom reservation on every refusal).
  const budget = createBudget(0.15, 0.1, 4)
  assert.equal(chargePuzzle(budget), true)
  assert.equal(budget.spendUsd, 0.1)
  assert.equal(budget.calls, 4)
  assert.equal(chargePuzzle(budget), false)
  assert.equal(budget.spendUsd, 0.1, "the refused charge must roll back, not inflate spend past what actually ran")
  assert.equal(budget.calls, 4, "the refused charge's call count must roll back too")
})

test("budget: the pre-run estimate check stays registry-only and refuses over-budget plans", async () => {
  const { createBudget, checkBudgetEstimate } = await import("../../scripts/eval-extraction.ts")
  const over = createBudget(0.01, 0.0252, 12)
  const refusal = checkBudgetEstimate(over, 1, 1)
  assert.match(refusal ?? "", /exceeds --budget-usd/)
  assert.match(refusal ?? "", /refusing to start/)
  const within = createBudget(5, 0.0252, 12)
  assert.equal(checkBudgetEstimate(within, 8, 3), null)
  const unlimited = createBudget(undefined, 0.0252, 12)
  assert.equal(checkBudgetEstimate(unlimited, 39, 3), null)
})

// --- ADR-010 US2: raw record fields (T017) --------------------------------------------------------

test("records: estimated and actual cost ride side by side; absent actual serializes as JSON null", async () => {
  const { record } = await import("../../scripts/eval-extraction.ts")
  const { lookupHarness } = await import("../../src/eval/harness.ts")
  const harness = lookupHarness("single-shot")
  if (harness === undefined) throw new Error("single-shot harness missing")
  const puzzle = { id: "PZL-TEST", file: "PZL-TEST-x.md", path: new URL("file:///x.md") }
  const ctx = { runIndex: 0, workflow: "full" as const, harness, estimatedCostUsd: 0.0021 }

  const measured = record(puzzle, "MATCH", 100, { actualCostUsd: 0.0042 }, "t", ctx)
  assert.equal(measured.estimatedCostUsd, 0.0021)
  assert.equal(measured.actualCostUsd, 0.0042)

  const absent = record(puzzle, "MATCH", 100, {}, "t", ctx)
  assert.equal(absent.actualCostUsd, null)
  // The serialized raw JSON must carry null (not drop the key, not fabricate 0).
  const json = JSON.parse(JSON.stringify(absent))
  assert.equal(json.actualCostUsd, null)
  assert.equal(json.estimatedCostUsd, 0.0021)

  const zero = record(puzzle, "MATCH", 100, { actualCostUsd: 0 }, "t", ctx)
  assert.equal(zero.actualCostUsd, 0)
  assert.equal(JSON.parse(JSON.stringify(zero)).actualCostUsd, 0)
})

test("matrix dry-run: plans verified cells, skips unverified tiers, estimates spend", () => {
  const stdout = execFileSync("node", ["scripts/eval-matrix.ts", "--dry-run"], { cwd: REPO_ROOT, encoding: "utf8" })
  assert.match(stdout, /openai\/gpt-4o-mini \[cheap\] x full-critic/)
  assert.match(stdout, /x single-shot/)
  assert.match(stdout, /x compile-repair/)
  assert.match(stdout, /x staged-single-shot/)
  // Harness ids and call budgets come from src/eval/harness.ts's registry, not a hardcoded
  // copy — local-single-shot is registered but was previously absent from that copy.
  assert.match(stdout, /x local-single-shot/)
  assert.match(stdout, /PZL-0022 PZL-0028 PZL-0033 PZL-0038 PZL-0015 PZL-0018/)
  assert.match(stdout, /SKIP minimax\/minimax-m3:free \[free\]: unverified/)
  assert.match(stdout, /SKIP nvidia\/nemotron-3-ultra-550b-a55b:free \[free\]: unverified/)
  assert.match(stdout, /SKIP openai\/gpt-5-nano \[cheap\]: unverified/)
  assert.match(stdout, /SKIP local\/stub-via-base-url-override \[local\]: unverified/)
  // ADR-008 §2.4: direct-solve cells are blocked (not silently planned) while the default
  // judge model is an unverified registry entry — a plan-time skip, not an execution-time
  // crash inside the cell's subprocess.
  assert.doesNotMatch(stdout, /openai\/gpt-4o-mini \[cheap\] x direct-solve · /)
  assert.match(stdout, /SKIP openai\/gpt-4o-mini \[cheap\] x direct-solve: judge model "z-ai\/glm-5\.3-flash" is not a verified entry/)
  assert.match(stdout, /SKIP anthropic\/claude-sonnet-4\.5 \[frontier\] x direct-solve: judge model/)
  assert.match(stdout, /Estimated total:/)
})

test("matrix dry-run: --harness local-single-shot plans with its own 1-call budget, not the 12-call fallback", () => {
  const stdout = execFileSync("node", ["scripts/eval-matrix.ts", "--dry-run", "--harness", "local-single-shot"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
  // openai/gpt-4o-mini: $0.0021/call x 1 call x 8 puzzles x 3 runs = $0.0504 ~ $0.05. The
  // stale hardcoded-table fallback (?? 12) would have estimated ~$0.60 instead.
  assert.match(stdout, /openai\/gpt-4o-mini \[cheap\] x local-single-shot .* ~\$0\.05\b/)
})

test("renderVerdictGrid: per-puzzle x cell table, missing puzzles as '—', empty-case fallback", async () => {
  const { renderVerdictGrid } = await import("../../scripts/eval-matrix.ts")
  const cellA = { model: { id: "openai/gpt-4o-mini", tier: "cheap", cost_per_call_usd: 0.002, verified: true }, harnessId: "single-shot", puzzles: [], runs: 3, estimatedUsd: 0.05 }
  const cellB = { model: { id: "anthropic/claude-sonnet-4.5", tier: "frontier", cost_per_call_usd: 0.05, verified: true }, harnessId: "single-shot", puzzles: [], runs: 3, estimatedUsd: 1.2 }
  const resultA = {
    puzzles: [
      { id: "PZL-0002", outcome: "MATCH" },
      { id: "PZL-0004", outcome: "MISMATCH" },
    ],
    summary: { total: 2, excluded: 0, passRate: 0.5 },
  }
  const resultB = {
    puzzles: [{ id: "PZL-0002", outcome: "MATCH" }],
    summary: { total: 1, excluded: 0, passRate: 1 },
  }
  const grid = renderVerdictGrid([cellA, cellB], new Map([[cellA, resultA], [cellB, resultB]]))
  assert.match(grid, /openai\/gpt-4o-mini x single-shot: 50% \(excluded 0\/2\)/)
  assert.match(grid, /anthropic\/claude-sonnet-4\.5 x single-shot: 100% \(excluded 0\/1\)/)
  assert.match(grid, /\| PZL-0002 \| MATCH \| MATCH \|/)
  // PZL-0004 wasn't in cellB's raw results — must render as a gap, not a false MATCH/MISMATCH.
  assert.match(grid, /\| PZL-0004 \| MISMATCH \| — \|/)

  const empty = renderVerdictGrid([cellA], new Map())
  assert.match(empty, /No cells completed/)
})

test("renderVerdictGrid: per-cell spend line distinguishes measured from estimated (T018)", async () => {
  const { renderVerdictGrid } = await import("../../scripts/eval-matrix.ts")
  const model = { id: "openai/gpt-4o-mini", tier: "cheap", cost_per_call_usd: 0.0021, verified: true }
  const cell = { model, harnessId: "full-critic", puzzles: [], runs: 1, estimatedUsd: 0.0252 }

  // Fully measured cell: both figures side by side, measured count shown.
  const measured = {
    puzzles: [
      { id: "PZL-0002", outcome: "MATCH", actualCostUsd: 0.0021 },
      { id: "PZL-0004", outcome: "MATCH", actualCostUsd: 0.0021 },
    ],
    summary: { total: 2, excluded: 0, passRate: 1 },
    spendUsd: 0.0042,
    estimatedSpendUsd: 0.0504,
  }
  const grid = renderVerdictGrid([cell], new Map([[cell, measured]]))
  assert.match(grid, /spend \$0\.0042 \(measured 2\/2, est \$0\.0504\)/)

  // No measured calls (local/free-tier): the estimate stands and SAYS it is an estimate —
  // never presented as a measurement, never a fabricated zero.
  const localCell = { model: { ...model, id: "local/qwen" }, harnessId: "local-single-shot", puzzles: [], runs: 1, estimatedUsd: 0 }
  const unmeasured = {
    puzzles: [{ id: "PZL-0002", outcome: "MATCH", actualCostUsd: null }],
    summary: { total: 1, excluded: 0, passRate: 1 },
    spendUsd: 0.0021,
    estimatedSpendUsd: 0.0021,
  }
  const localGrid = renderVerdictGrid([localCell], new Map([[localCell, unmeasured]]))
  assert.match(localGrid, /spend \$0\.0021 \(est — no measured calls\)/)
  assert.doesNotMatch(localGrid, /measured 1\/1/)

  // Pre-cost-accounting raw JSON (no spend fields): renders without a spend line, no crash.
  const legacy = {
    puzzles: [{ id: "PZL-0002", outcome: "MATCH" }],
    summary: { total: 1, excluded: 0, passRate: 1 },
  }
  const legacyGrid = renderVerdictGrid([cell], new Map([[cell, legacy]]))
  assert.match(legacyGrid, /100% \(excluded 0\/1\)/)
  assert.doesNotMatch(legacyGrid, /spend \$/)
})

test("renderVerdictGrid: divergent actual-vs-estimate cells stay independently visible (T024/US3)", async () => {
  const { renderVerdictGrid } = await import("../../scripts/eval-matrix.ts")
  const cheap = { id: "openai/gpt-4o-mini", tier: "cheap", cost_per_call_usd: 0.0021, verified: true }
  const frontier = { id: "anthropic/claude-sonnet-4.5", tier: "frontier", cost_per_call_usd: 0.05, verified: true }
  const cellCheap = { model: cheap, harnessId: "single-shot", puzzles: [], runs: 1, estimatedUsd: 0.0021 }
  const cellFrontier = { model: frontier, harnessId: "single-shot", puzzles: [], runs: 1, estimatedUsd: 0.05 }

  // Registry estimate says $0.0252/puzzle; real billing came in 6x under.
  const under = {
    puzzles: [{ id: "PZL-0002", outcome: "MATCH", actualCostUsd: 0.0042 }],
    summary: { total: 1, excluded: 0, passRate: 1 },
    spendUsd: 0.0042,
    estimatedSpendUsd: 0.0252,
  }
  // Registry estimate says $0.05; real billing came in over 6x above (long reasoning output).
  const over = {
    puzzles: [{ id: "PZL-0002", outcome: "MATCH", actualCostUsd: 0.31 }],
    summary: { total: 1, excluded: 0, passRate: 1 },
    spendUsd: 0.31,
    estimatedSpendUsd: 0.05,
  }
  const grid = renderVerdictGrid([cellCheap, cellFrontier], new Map([[cellCheap, under], [cellFrontier, over]]))
  assert.match(grid, /gpt-4o-mini x single-shot: 100% \(excluded 0\/1\) · spend \$0\.0042 \(measured 1\/1, est \$0\.0252\)/)
  assert.match(grid, /claude-sonnet-4\.5 x single-shot: 100% \(excluded 0\/1\) · spend \$0\.3100 \(measured 1\/1, est \$0\.0500\)/)
})

test("needsOpenRouterKey: a local-only plan doesn't need one; a direct-solve cell still does", async () => {
  const { needsOpenRouterKey } = await import("../../scripts/eval-matrix.ts")
  const model = { id: "openai/gpt-4o-mini", tier: "cheap", cost_per_call_usd: 0.002, verified: true }
  const localCell = { model, harnessId: "local-single-shot", puzzles: [], runs: 1, estimatedUsd: 0 }
  const directSolveCell = { model, harnessId: "direct-solve", puzzles: [], runs: 1, estimatedUsd: 0 }

  assert.equal(needsOpenRouterKey([localCell], { ZEBRA_LOCAL_BASE_URL: "http://127.0.0.1:1" }), false)
  assert.equal(needsOpenRouterKey([localCell], {}), true, "no local base URL at all — every cell needs OpenRouter")
  assert.equal(
    needsOpenRouterKey([localCell, directSolveCell], { ZEBRA_LOCAL_BASE_URL: "http://127.0.0.1:1" }),
    true,
    "direct-solve's judge is always forced onto OpenRouter, even in local mode",
  )
})

test("matrix dry-run: --harness filters to one harness's cells", () => {
  const stdout = execFileSync("node", ["scripts/eval-matrix.ts", "--dry-run", "--harness", "single-shot"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
  assert.match(stdout, /x single-shot/)
  assert.doesNotMatch(stdout, /x full-critic/)
  assert.doesNotMatch(stdout, /x compile-repair/)
})
