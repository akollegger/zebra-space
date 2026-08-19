import { test } from "node:test"
import assert from "node:assert/strict"
import { execFile as execFileCallback } from "node:child_process"
import { promisify } from "node:util"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { startStubServer, type StubHandler, type StubServer } from "../extraction/support/stub-server.ts"

const execFile = promisify(execFileCallback)

const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url))
const WHODUNIT_MODEL = fileURLToPath(
  new URL("../../catalog/mzn/PZL-0004-whodunit.mzn", import.meta.url),
)
const WHODUNIT_PUZZLE = fileURLToPath(
  new URL("../../catalog/puzzles/PZL-0004-whodunit.md", import.meta.url),
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

async function runCli(args: readonly string[], env?: NodeJS.ProcessEnv): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFile(CLI_PATH, args, { env: env ?? process.env })
    return { stdout, stderr, exitCode: 0 }
  } catch (error) {
    const err = error as ExecFileError
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.code ?? -1 }
  }
}

// PZL-0004-whodunit.md's known-correct extraction (specs/001-catalog-seeding/answer-keys.md) —
// shared across `extract` tests as the stub's canned response.
const WHODUNIT_EXTRACTED_CSP = {
  entities: [{ id: "Murder", type: "Event" }],
  domains: [
    { variable: "culprit", entityType: "Event", values: ["Scarlett", "Mustard", "Plum"] },
    { variable: "weapon", entityType: "Event", values: ["Candlestick", "Revolver", "Rope"] },
    { variable: "room", entityType: "Event", values: ["Kitchen", "Library", "Conservatory"] },
  ],
  constraints: [
    { kind: "arithmetic", expression: { kind: "variableRef", variable: "culprit" }, comparator: "!=", target: "Mustard" },
    { kind: "arithmetic", expression: { kind: "variableRef", variable: "culprit" }, comparator: "!=", target: "Scarlett" },
    { kind: "arithmetic", expression: { kind: "variableRef", variable: "weapon" }, comparator: "!=", target: "Revolver" },
    { kind: "arithmetic", expression: { kind: "variableRef", variable: "weapon" }, comparator: "!=", target: "Rope" },
    { kind: "arithmetic", expression: { kind: "variableRef", variable: "room" }, comparator: "!=", target: "Kitchen" },
    { kind: "arithmetic", expression: { kind: "variableRef", variable: "room" }, comparator: "!=", target: "Library" },
  ],
}

async function withExtractStub<A>(handler: StubHandler, use: (stub: StubServer) => Promise<A>): Promise<A> {
  const stub = await startStubServer(handler)
  try {
    return await use(stub)
  } finally {
    await stub.close()
  }
}

function extractEnv(stub: StubServer, extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ZEBRA_OPENROUTER_BASE_URL_OVERRIDE: stub.baseUrl,
    OPENROUTER_API_KEY: "test-key",
    ...extra,
  }
}

function writeTempFile(content: string, filename: string): string {
  const dir = mkdtempSync(join(tmpdir(), "zebra-cli-test-"))
  const path = join(dir, filename)
  writeFileSync(path, content, "utf8")
  return path
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
  // Exact code, not just non-zero — contracts/cli-contract.md documents 251 (Stricli's
  // UnknownCommand) as a stable, meaningful distinction from a solve failure's exit 1.
  assert.equal(result.exitCode, 251)
  assert.match(result.stdout + result.stderr, /solve/)
})

test("extract --help shows its own arguments, independent of top-level help", async () => {
  const result = await runCli(["extract", "--help"])
  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /--json/)
  assert.match(result.stdout, /--model/)
  assert.match(result.stdout, /--frontier-model/)
})

test("Acceptance Scenario 1 & 2, SC-001: extract prints a valid .mzn model that, piped to solve, reproduces the known answer", async () => {
  await withExtractStub(
    (exchange) => {
      exchange.respondWithJson(
        exchange.request.schemaName === "FidelityCritique" ? { accepted: true, issues: [] } : WHODUNIT_EXTRACTED_CSP,
      )
    },
    async (stub) => {
      const extractResult = await runCli(["extract", WHODUNIT_PUZZLE], extractEnv(stub))
      assert.equal(extractResult.exitCode, 0)
      assert.match(extractResult.stdout, /^%.*PZL-0004-whodunit\.md.*$/m)
      assert.match(extractResult.stdout, /solve satisfy;/)

      const mznPath = writeTempFile(extractResult.stdout, "extracted.mzn")
      const solveResult = await runCli(["solve", mznPath])
      assert.equal(solveResult.exitCode, 0)
      assert.match(solveResult.stdout, /Plum/)
      assert.match(solveResult.stdout, /Candlestick/)
      assert.match(solveResult.stdout, /Conservatory/)
    },
  )
})

test("FR-004/Acceptance Scenario 2: a faithful extraction of an unsatisfiable puzzle still prints a model and exits 0", async () => {
  const contradictoryCsp = {
    entities: [{ id: "E1", type: "Thing" }],
    domains: [{ variable: "x", entityType: "Thing", values: ["1", "2"] }],
    constraints: [
      { kind: "arithmetic", expression: { kind: "variableRef", variable: "x" }, comparator: "=", target: 1 },
      { kind: "arithmetic", expression: { kind: "variableRef", variable: "x" }, comparator: "=", target: 2 },
    ],
  }
  await withExtractStub(
    (exchange) => {
      exchange.respondWithJson(
        exchange.request.schemaName === "FidelityCritique" ? { accepted: true, issues: [] } : contradictoryCsp,
      )
    },
    async (stub) => {
      const extractResult = await runCli(["extract", WHODUNIT_PUZZLE], extractEnv(stub))
      assert.equal(extractResult.exitCode, 0)

      const mznPath = writeTempFile(extractResult.stdout, "unsat.mzn")
      const solveResult = await runCli(["solve", mznPath])
      assert.equal(solveResult.exitCode, 0)
      assert.match(solveResult.stdout, /no solution/i)
    },
  )
})

test("contracts/cli-contract.md: a rejected extraction prints the full attempt history to stderr and exits 1", async () => {
  await withExtractStub(
    (exchange) => {
      exchange.respondWithJson(
        exchange.request.schemaName === "FidelityCritique"
          ? { accepted: false, issues: ["dropped a clue about the weapon"] }
          : WHODUNIT_EXTRACTED_CSP,
      )
    },
    async (stub) => {
      const result = await runCli(["extract", WHODUNIT_PUZZLE], extractEnv(stub))
      assert.equal(result.exitCode, 1)
      assert.equal(result.stdout, "")
      assert.match(result.stderr, /could not be validated as a faithful translation/)
      assert.match(result.stderr, /dropped a clue about the weapon/)
    },
  )
})

test("FR-012: a provider failure prints a message distinguishable from a rejected extraction and exits 1", async () => {
  const stub = await startStubServer(() => {})
  const closedUrl = stub.baseUrl
  await stub.close()

  const result = await runCli(["extract", WHODUNIT_PUZZLE], {
    ...process.env,
    ZEBRA_OPENROUTER_BASE_URL_OVERRIDE: closedUrl,
    OPENROUTER_API_KEY: "test-key",
  })
  assert.equal(result.exitCode, 1)
  assert.equal(result.stdout, "")
  assert.match(result.stderr, /could not be reached or failed unexpectedly/)
  assert.doesNotMatch(result.stderr, /faithful translation/)
})

test("SC-004/contracts/cli-contract.md: --json prints the raw ExtractedCsp and never invokes the compiler", async () => {
  const uncompilableCsp = {
    entities: [{ id: "H1", type: "House" }],
    domains: [{ variable: "position", entityType: "House", values: ["1"] }],
    constraints: [{ kind: "adjacency", relation: "an unrecognized relation phrase", a: "H1", b: "H1" }],
  }
  await withExtractStub(
    (exchange) => {
      exchange.respondWithJson(
        exchange.request.schemaName === "FidelityCritique" ? { accepted: true, issues: [] } : uncompilableCsp,
      )
    },
    async (stub) => {
      const result = await runCli(["extract", WHODUNIT_PUZZLE, "--json"], extractEnv(stub))
      assert.equal(result.exitCode, 0)
      const parsed = JSON.parse(result.stdout)
      assert.deepEqual(parsed.extractedCsp, uncompilableCsp)
      assert.equal(parsed.model, "google/gemini-2.5-flash-lite")
    },
  )
})

test("ADR-003 §2.6: --model/--frontier-model flags reach the provider with the overridden identifiers", async () => {
  await withExtractStub(
    (exchange) => {
      exchange.respondWithJson(
        exchange.request.schemaName === "FidelityCritique" ? { accepted: true, issues: [] } : WHODUNIT_EXTRACTED_CSP,
      )
    },
    async (stub) => {
      const result = await runCli(
        ["extract", WHODUNIT_PUZZLE, "--model", "custom/cheap", "--frontier-model", "custom/frontier"],
        extractEnv(stub),
      )
      assert.equal(result.exitCode, 0)
      assert.match(result.stdout, /using custom\/cheap/)
      assert.ok(stub.requests.every((r) => r.model === "custom/cheap"))
    },
  )
})

test("ADR-003 §2.6: ZEBRA_MODEL/ZEBRA_FRONTIER_MODEL env vars take effect, and flags take precedence over them", async () => {
  await withExtractStub(
    (exchange) => {
      exchange.respondWithJson(
        exchange.request.schemaName === "FidelityCritique" ? { accepted: true, issues: [] } : WHODUNIT_EXTRACTED_CSP,
      )
    },
    async (stub) => {
      const envResult = await runCli(
        ["extract", WHODUNIT_PUZZLE],
        extractEnv(stub, { ZEBRA_MODEL: "env/cheap", ZEBRA_FRONTIER_MODEL: "env/frontier" }),
      )
      assert.equal(envResult.exitCode, 0)
      assert.match(envResult.stdout, /using env\/cheap/)

      const precedenceResult = await runCli(
        ["extract", WHODUNIT_PUZZLE, "--model", "flag/cheap"],
        extractEnv(stub, { ZEBRA_MODEL: "env/cheap" }),
      )
      assert.equal(precedenceResult.exitCode, 0)
      assert.match(precedenceResult.stdout, /using flag\/cheap/)
    },
  )
})
