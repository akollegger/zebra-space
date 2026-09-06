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
  assert.deepEqual(
    gradeJudged("P", nonProblem, { verdict: "incorrect", reason: "solved anyway" }).verdict,
    "UNDECLINED",
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
  assert.match(stdout, /x direct-solve/)
  assert.match(stdout, /x staged-single-shot/)
  assert.match(stdout, /PZL-0022 PZL-0028 PZL-0033 PZL-0038 PZL-0015 PZL-0018/)
  assert.match(stdout, /SKIP minimax\/minimax-m3:free \[free\]: unverified/)
  assert.match(stdout, /SKIP nvidia\/nemotron-3-ultra-550b-a55b:free \[free\]: unverified/)
  assert.match(stdout, /SKIP openai\/gpt-5-nano \[cheap\]: unverified/)
  assert.match(stdout, /SKIP local\/stub-via-base-url-override \[local\]: unverified/)
  assert.match(stdout, /Estimated total:/)
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
