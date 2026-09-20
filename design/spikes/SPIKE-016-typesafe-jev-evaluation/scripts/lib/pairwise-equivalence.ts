// SPIKE-016 §2 sub-question 3: does a Jev Noul match/beat the curated alias+lemmatizer fold
// (src/eval/aliases.ts's stringsMatch, built on src/eval/grader.ts's normalizeToken/
// comparisonKey per ADR-011) at deciding whether two value-strings refer to the same thing?
//
// Per docs.typesafe.ai/model-jaggedness/jev-1.13: pairwise equivalence needs CONTEXT, not bare
// tokens — SPIKE-015's own named misses ("action"/"game" vs. "move") are only synonymous WITHIN
// a puzzle's domain, not in general English. `contextHint` is required, not optional, for this
// reason — a bare two-string call would produce false negatives for the wrong reason (Jev
// correctly saying "no" under general English when the puzzle-specific context says "yes").

import { type AskFn, ask } from "./jev-client.ts"

export interface EquivalencePair {
  readonly a: string
  readonly b: string
  /** The puzzle/domain context the pair must be judged within — required, see file header. */
  readonly contextHint: string
  /** Where this pair came from, for grouping in Findings (curated-alias / named-miss / negative-control). */
  readonly source: "curated-alias" | "named-miss" | "negative-control"
  /** The expected verdict per this experiment's own ground truth for that source (curated-alias
   * and negative-control pairs have a known answer; named-miss pairs are the open question). */
  readonly expected: boolean
}

export interface EquivalenceVerdict {
  readonly pair: EquivalencePair
  readonly jevMatch: boolean | undefined
  readonly noul: number | undefined
  readonly latencyMs: number
  readonly error?: string
}

/** One Noul call per pair. `askFn` is injectable so an offline smoke test can stub it — see
 * jev-client.ts's `AskFn` doc comment. */
export async function judgeEquivalence(pair: EquivalencePair, askFn: AskFn = ask): Promise<EquivalenceVerdict> {
  const response = await askFn(
    { contextHint: pair.contextHint, valueA: pair.a, valueB: pair.b },
    {
      sameValue: {
        type: "noul",
        instructions:
          "In the context described by `contextHint`, do `valueA` and `valueB` refer to the SAME " +
          "underlying value — the same specific thing, just spelled, cased, or worded differently " +
          "(including a synonym that means the same thing ONLY within this specific context)?",
        criteria: {
          true: "Same value: a spelling/casing/pluralization variant, or a context-specific synonym for the same thing.",
          false: "Genuinely different values, even if superficially similar in spelling or general meaning.",
        },
      },
    },
  )
  if (!response.ok) {
    return { pair, jevMatch: undefined, noul: undefined, latencyMs: response.latencyMs, error: response.error }
  }
  const noul = response.result.answers.sameValue.noul
  return { pair, jevMatch: noul >= 0.5, noul, latencyMs: response.latencyMs }
}
