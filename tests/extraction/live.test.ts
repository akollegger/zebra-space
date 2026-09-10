import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { extract } from "../../src/extraction/extract.ts"

// research.md Finding 2: this is the one place this feature's own real accuracy (SC-002) gets
// checked against the real OpenRouter service — never a hard CI gate. Skipped automatically
// when OPENROUTER_API_KEY is absent, unlike the default suite's stubbed tests (extract.test.ts,
// compile.test.ts, cli.test.ts), which never touch the network.
const hasApiKey = process.env.OPENROUTER_API_KEY !== undefined && process.env.OPENROUTER_API_KEY !== ""

// SPIKE-004's stratified sample (design/spikes/SPIKE-004-llm-based-extraction/SPIKE.md).
const SAMPLE_PUZZLES = [
  "PZL-0001-life-international-1962.md",
  "PZL-0005-four-countries.md",
  "PZL-0008-lo-shu-square.md",
  "PZL-0011-loan-review.md",
  "PZL-0013-picking-a-restaurant.md",
]

function puzzlePath(filename: string): string {
  return fileURLToPath(new URL(`../../catalog/puzzles/${filename}`, import.meta.url))
}

/**
 * Sequential, not Promise.all: this hits a real, billed, rate-limited API, and running the
 * sample concurrently risks 429s/timeouts that fail the assertion below for reasons unrelated
 * to extraction fidelity (same "stay easy on rate limits/cost" practice as eval/README.md's
 * harness).
 */
async function runLiveExtractionSample(): Promise<void> {
  const outcomes: { filename: string; succeeded: boolean; actualCostUsd: number | undefined }[] = []
  for (const filename of SAMPLE_PUZZLES) {
    const prose = await readFile(puzzlePath(filename), "utf8")
    const exit = await Effect.runPromiseExit(extract(prose))
    outcomes.push({
      filename,
      succeeded: exit._tag === "Success",
      actualCostUsd: exit._tag === "Success" ? exit.value.actualCostUsd : undefined,
    })
  }

  const succeeded = outcomes.filter((o) => o.succeeded).length
  const rate = succeeded / outcomes.length

  console.log(`Live extraction results: ${succeeded}/${outcomes.length} (${Math.round(rate * 100)}%)`)
  for (const outcome of outcomes) {
    console.log(`  ${outcome.succeeded ? "OK  " : "FAIL"} ${outcome.filename}`)
  }

  // ADR-010: successful billed calls expose the provider's actual cost, not a registry
  // estimate. This is deliberately key-gated with the existing live extraction test.
  for (const outcome of outcomes.filter((outcome) => outcome.succeeded)) {
    const actualCostUsd = outcome.actualCostUsd
    assert.equal(typeof actualCostUsd, "number", `${outcome.filename} returned no actual cost`)
    if (actualCostUsd === undefined) assert.fail(`${outcome.filename} returned no actual cost`)
    assert.ok(actualCostUsd > 0, `${outcome.filename} reported a non-positive actual cost`)
  }

  assert.ok(
    rate >= 0.8,
    `Expected at least 80% of the sample to produce a faithful translation; got ${Math.round(rate * 100)}%`,
  )
}

test(
  "SC-002: at least 80% of the stratified sample produces a validated, faithful translation",
  { skip: !hasApiKey && "OPENROUTER_API_KEY is not set — skipping live extraction test" },
  async () => {
    // This test asserts a positive OpenRouter-billed cost below — but `extract()`'s provider
    // route prefers ZEBRA_LOCAL_BASE_URL over OpenRouter whenever it's set (src/extraction/
    // provider.ts's resolveBaseRoute), and a local route always reports an absent cost. With
    // both env vars set, a run could silently route locally and fail the cost assertion for a
    // reason unrelated to what it's testing (found in PR review of ADR-010) — force this test
    // through OpenRouter regardless of the ambient dev environment.
    const savedLocalBaseUrl = process.env.ZEBRA_LOCAL_BASE_URL
    delete process.env.ZEBRA_LOCAL_BASE_URL
    try {
      await runLiveExtractionSample()
    } finally {
      if (savedLocalBaseUrl !== undefined) process.env.ZEBRA_LOCAL_BASE_URL = savedLocalBaseUrl
    }
  },
)
