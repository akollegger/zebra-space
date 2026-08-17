import { test } from "node:test"
import assert from "node:assert/strict"
import { execFile as execFileCallback } from "node:child_process"
import { promisify } from "node:util"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const execFile = promisify(execFileCallback)

const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url))
const WHODUNIT_MODEL = fileURLToPath(
  new URL("../../catalog/mzn/PZL-0004-whodunit.mzn", import.meta.url),
)

const UNSATISFIABLE_MODEL = "var 1..2: x; constraint x > 5; solve satisfy;"
const MULTIPLY_SATISFIABLE_MODEL = "var 1..3: x; var 1..3: y; constraint x != y; solve satisfy;"

interface CliResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

interface ExecFileError {
  readonly code?: number
  readonly stdout?: string
  readonly stderr?: string
}

async function runCli(args: readonly string[]): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFile(CLI_PATH, args)
    return { stdout, stderr, exitCode: 0 }
  } catch (error) {
    const err = error as ExecFileError
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.code ?? -1 }
  }
}

function writeTempModel(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "zebra-cli-test-"))
  const path = join(dir, "model.mzn")
  writeFileSync(path, content, "utf8")
  return path
}

test("SC-001: solve against a uniquely solvable model prints the solution and exits 0", async () => {
  const result = await runCli(["solve", WHODUNIT_MODEL])
  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /Plum/)
  assert.match(result.stdout, /Candlestick/)
  assert.match(result.stdout, /Conservatory/)
})

test("SC-002: solve against an unsatisfiable model reports that outcome and exits 0", async () => {
  const modelPath = writeTempModel(UNSATISFIABLE_MODEL)
  const result = await runCli(["solve", modelPath])
  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /no solution/i)
})

test("SC-003: solve against a multiply satisfiable model reports that outcome and exits 0", async () => {
  const modelPath = writeTempModel(MULTIPLY_SATISFIABLE_MODEL)
  const result = await runCli(["solve", modelPath])
  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /more than one solution/i)
})

test("SC-005: solve against a nonexistent model file prints an error on stderr and exits 1", async () => {
  const result = await runCli(["solve", "/nonexistent/path/model.mzn"])
  assert.equal(result.exitCode, 1)
  assert.equal(result.stdout, "")
  assert.notEqual(result.stderr, "")
})

test("SC-004: --json produces valid JSON matching the underlying SolveResult for each outcome", async () => {
  const uniqueResult = await runCli(["solve", WHODUNIT_MODEL, "--json"])
  assert.equal(uniqueResult.exitCode, 0)
  const uniqueParsed = JSON.parse(uniqueResult.stdout)
  assert.equal(uniqueParsed._tag, "UniquelySolvable")
  assert.equal(uniqueParsed.assignment.culprit.e, "Plum")

  const unsatModelPath = writeTempModel(UNSATISFIABLE_MODEL)
  const unsatResult = await runCli(["solve", unsatModelPath, "--json"])
  assert.equal(unsatResult.exitCode, 0)
  assert.deepEqual(JSON.parse(unsatResult.stdout), { _tag: "Unsatisfiable" })

  const multiModelPath = writeTempModel(MULTIPLY_SATISFIABLE_MODEL)
  const multiResult = await runCli(["solve", multiModelPath, "--json"])
  assert.equal(multiResult.exitCode, 0)
  const multiParsed = JSON.parse(multiResult.stdout)
  assert.equal(multiParsed._tag, "MultiplySatisfiable")
  assert.equal(multiParsed.assignments.length, 2)
})

test("SC-006: top-level --help lists the solve subcommand", async () => {
  const result = await runCli(["--help"])
  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /solve/)
})

test("Edge case (spec.md): no subcommand at all behaves like top-level --help", async () => {
  const result = await runCli([])
  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /solve/)
})

test("SC-006: solve --help shows its own arguments, independent of top-level help", async () => {
  const result = await runCli(["solve", "--help"])
  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /--data/)
  assert.match(result.stdout, /--solver/)
  assert.match(result.stdout, /--json/)
})

test("SC-006: --version prints a non-empty version string", async () => {
  const result = await runCli(["--version"])
  assert.equal(result.exitCode, 0)
  assert.notEqual(result.stdout.trim(), "")
})

test("SC-007: an unrecognized subcommand lists available subcommands and exits unsuccessfully", async () => {
  const result = await runCli(["bogus-subcommand"])
  assert.notEqual(result.exitCode, 0)
  assert.match(result.stdout + result.stderr, /solve/)
})
