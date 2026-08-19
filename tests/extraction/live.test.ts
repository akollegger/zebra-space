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

test(
  "SC-002: at least 80% of the stratified sample produces a validated, faithful translation",
  { skip: !hasApiKey && "OPENROUTER_API_KEY is not set — skipping live extraction test" },
  async () => {
    // Sequential, not Promise.all: this hits a real, billed, rate-limited API, and running the
    // sample concurrently risks 429s/timeouts that fail the assertion below for reasons unrelated
    // to extraction fidelity (same "stay easy on rate limits/cost" practice as eval/README.md's
    // harness).
    const outcomes: { filename: string; succeeded: boolean }[] = []
    for (const filename of SAMPLE_PUZZLES) {
      const prose = await readFile(puzzlePath(filename), "utf8")
      const exit = await Effect.runPromiseExit(extract(prose))
      outcomes.push({ filename, succeeded: exit._tag === "Success" })
    }

    const succeeded = outcomes.filter((o) => o.succeeded).length
    const rate = succeeded / outcomes.length

    console.log(`Live extraction results: ${succeeded}/${outcomes.length} (${Math.round(rate * 100)}%)`)
    for (const outcome of outcomes) {
      console.log(`  ${outcome.succeeded ? "OK  " : "FAIL"} ${outcome.filename}`)
    }

    assert.ok(
      rate >= 0.8,
      `Expected at least 80% of the sample to produce a faithful translation; got ${Math.round(rate * 100)}%`,
    )
  },
)
