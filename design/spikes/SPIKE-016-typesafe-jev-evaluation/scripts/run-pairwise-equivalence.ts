// SPIKE-016 sub-question 3 driver. Run: node --env-file-if-exists=.env
//   design/spikes/SPIKE-016-typesafe-jev-evaluation/scripts/run-pairwise-equivalence.ts

import { readFile } from "node:fs/promises"
import { type EquivalencePair, type EquivalenceVerdict, judgeEquivalence } from "./lib/pairwise-equivalence.ts"

const ROOT = new URL("../../../../", import.meta.url)

async function loadCuratedAliasPairs(): Promise<EquivalencePair[]> {
  const raw = JSON.parse(await readFile(new URL("eval/aliases.json", ROOT), "utf8")) as {
    aliases: Record<string, readonly string[]>
  }
  const pairs: EquivalencePair[] = []
  for (const [canonical, variants] of Object.entries(raw.aliases)) {
    for (const variant of variants) {
      pairs.push({ a: canonical, b: variant, contextHint: "a puzzle answer-key value", source: "curated-alias", expected: true })
    }
  }
  return pairs
}

// SPIKE-015's score-domain-match.ts file header names this exact pair as a synonym variance the
// curated fold "can't close" — its contextHint is that file's own framing verbatim.
const NAMED_MISS_PAIRS: readonly EquivalencePair[] = [
  { a: "action", b: "move", contextHint: "a board game's per-turn options, each turn one is taken", source: "named-miss", expected: true },
  { a: "game", b: "move", contextHint: "a board game's per-turn options, each turn one is taken", source: "named-miss", expected: true },
]

/** A sampled, deterministic "hard negative" cross-check: pairs of DISTINCT answer-key values
 * that share a lowercase 2-letter prefix (the closest lexical neighbors in the catalog, and so
 * the pairs most likely to tempt a false merge) rather than a random sample across unrelated
 * words, which would trivially all read "no match" and prove nothing. Capped to keep the live
 * call count small for a first-contact spike. */
async function loadNegativeControlPairs(cap = 20): Promise<EquivalencePair[]> {
  const raw = JSON.parse(await readFile(new URL("eval/answer-keys.json", ROOT), "utf8")) as Record<string, unknown>
  const { $comment: _ignored, ...entries } = raw
  const values = new Set<string>()
  function collect(v: unknown): void {
    if (Array.isArray(v)) v.forEach(collect)
    else if (v !== null && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(collect)
    else if (typeof v === "string" && !/^-?\d+$/.test(v)) values.add(v)
  }
  for (const entry of Object.values(entries)) collect((entry as { answer?: unknown }).answer)

  const byPrefix = new Map<string, string[]>()
  for (const v of values) {
    const prefix = v.toLowerCase().slice(0, 2)
    const bucket = byPrefix.get(prefix) ?? []
    bucket.push(v)
    byPrefix.set(prefix, bucket)
  }
  const pairs: EquivalencePair[] = []
  for (const bucket of byPrefix.values()) {
    for (let i = 0; i < bucket.length && pairs.length < cap; i++) {
      for (let j = i + 1; j < bucket.length && pairs.length < cap; j++) {
        pairs.push({ a: bucket[i]!, b: bucket[j]!, contextHint: "distinct values from this project's puzzle answer keys", source: "negative-control", expected: false })
      }
    }
  }
  return pairs
}

async function main(): Promise<void> {
  const pairs = [...(await loadCuratedAliasPairs()), ...NAMED_MISS_PAIRS, ...(await loadNegativeControlPairs())]
  console.log(`Running ${pairs.length} pairwise equivalence checks...`)

  const results: EquivalenceVerdict[] = []
  for (const pair of pairs) {
    const verdict = await judgeEquivalence(pair)
    results.push(verdict)
    const status = verdict.error !== undefined ? `ERROR: ${verdict.error}` : `${verdict.jevMatch} (noul=${verdict.noul?.toFixed(3)})`
    console.log(`[${pair.source}] "${pair.a}" vs "${pair.b}" (expected=${pair.expected}) -> ${status}`)
  }

  const bySource = (source: EquivalencePair["source"]) => results.filter((r) => r.pair.source === source)
  const accuracy = (rs: typeof results) => {
    const scored = rs.filter((r) => r.jevMatch !== undefined)
    const correct = scored.filter((r) => r.jevMatch === r.pair.expected).length
    return { correct, total: scored.length, errors: rs.length - scored.length }
  }

  const summary = {
    curatedAlias: accuracy(bySource("curated-alias")),
    namedMiss: bySource("named-miss").map((r) => ({ a: r.pair.a, b: r.pair.b, jevMatch: r.jevMatch, noul: r.noul })),
    negativeControl: accuracy(bySource("negative-control")),
    totalLatencyMs: results.reduce((s, r) => s + r.latencyMs, 0),
  }
  console.log("\nSummary:", JSON.stringify(summary, null, 2))

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const outPath = new URL(`results/pairwise-equivalence-${timestamp}.json`, import.meta.url)
  await import("node:fs/promises").then((fs) => fs.writeFile(outPath, JSON.stringify({ summary, results }, null, 2)))
  console.log(`\nWrote ${outPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
