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

test("matrix dry-run: --harness filters to one harness's cells", () => {
  const stdout = execFileSync("node", ["scripts/eval-matrix.ts", "--dry-run", "--harness", "single-shot"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
  assert.match(stdout, /x single-shot/)
  assert.doesNotMatch(stdout, /x full-critic/)
  assert.doesNotMatch(stdout, /x compile-repair/)
})
