// SPIKE-016 §2 sub-question 1: no stage of the production pipeline currently infers which
// outcome class (src/eval/grader.ts's OutcomeClass) a puzzle belongs to — it's only known via
// the curated eval/answer-keys.json. Can Jev infer it from prose alone?
//
// REDESIGNED SCOPE, per docs.typesafe.ai/model-jaggedness/jev-1.13's "math/counting" and
// "indirection" failure modes: this does NOT ask Jev to determine solvability/uniqueness (a
// solvability COMPUTATION — exactly what the docs say to keep out of Jev, "recognizes the shape
// of an answer rather than tallying"). Instead it classifies the puzzle's RHETORICAL FRAMING —
// a literal, surface-reading classification, Jev's strength — as a Choice over five textual
// signals that happen to line up with the five outcome classes. Report this as
// framing-classification accuracy against the answer key's `outcome` field, never as
// "Jev detects solvability."

import type { Usage } from "@typesafe-ai/sdk"
import { type AskFn, ask } from "./jev-client.ts"

/** grader.ts's OutcomeClass, restated here rather than imported, since a missing `outcome` field
 * on an answer-key entry means "determinate" (grader.ts's own documented default) — this module
 * works from the raw prose only and doesn't need grader.ts's richer verdict types. */
export type OutcomeClass = "determinate" | "cop" | "ambiguous" | "subjective" | "non-problem"

const FRAMING_CRITERIA = {
  determinate: "The prose asks the reader to work out one specific set of facts (who did what, in what order, etc.) that follows necessarily from the given clues.",
  cop: "The prose asks for the BEST or OPTIMAL choice among several valid options (e.g. cheapest, fastest, most points) — not just any answer that fits the clues, but the one that optimizes some stated quantity.",
  ambiguous: "The prose leaves out information needed to settle on one reading — a reasonable reader could fill the gap more than one way and reach different, equally defensible answers.",
  subjective: "The prose asks for a preference, opinion, or value judgment with no single objectively correct answer, even though the clues are all given.",
  "non-problem": "The prose isn't actually posing a solvable puzzle at all — e.g. it's a request that has no puzzle to solve, or asks something that cannot be answered from the given information at all (not just ambiguously, but not answerable in principle).",
} as const

export interface OutcomeFramingResult {
  readonly puzzleId: string
  readonly expected: OutcomeClass
  readonly predicted: OutcomeClass | undefined
  readonly confidence: number | undefined
  readonly probabilities: Readonly<Record<OutcomeClass, number>> | undefined
  readonly latencyMs: number
  /** Token usage for this call (see pairwise-equivalence.ts's EquivalenceVerdict.usage doc). */
  readonly usage: Usage | undefined
  readonly error?: string
}

export async function classifyOutcomeFraming(puzzleId: string, prose: string, expected: OutcomeClass, askFn: AskFn = ask): Promise<OutcomeFramingResult> {
  const response = await askFn(prose, {
    framing: { type: "choice", instructions: "How is this puzzle's prose framed — what kind of answer is it actually asking for?", criteria: FRAMING_CRITERIA },
  })
  if (!response.ok) {
    return { puzzleId, expected, predicted: undefined, confidence: undefined, probabilities: undefined, usage: undefined, latencyMs: response.latencyMs, error: response.error }
  }
  const { choice, confidence, probabilities } = response.result.answers.framing
  return { puzzleId, expected, predicted: choice, confidence, probabilities, usage: response.result.usage, latencyMs: response.latencyMs }
}
