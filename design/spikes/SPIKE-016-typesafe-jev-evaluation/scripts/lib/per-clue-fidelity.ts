// SPIKE-016 §2 sub-question 2: replays Jev against SPIKE-014's ALREADY-COLLECTED failing
// formalize-mzn drafts (PZL-0010, PZL-0038 — SPIKE-014 SPIKE.md §5.4's three hand-diagnosed
// silent failures: a dropped `alldifferent`, incomplete relational coverage, a self-contradicting
// pair) to test whether a cheap per-clue check would have caught them. Zero new frontier-model
// spend — only new Jev calls against text already on disk.
//
// Per docs.typesafe.ai/model-jaggedness/jev-1.13's "large irrelevant state"/context-rot warning
// and "don't hide multiple judgments in one question": this is a two-step SELECT-then-JUDGE
// pipeline, each call given only the one clue plus the specific constraint line(s) — never the
// whole prose or the whole .mzn file.

import type { Usage } from "@typesafe-ai/sdk"
import { type AskFn, ask } from "./jev-client.ts"

function sumUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
  if (a === undefined && b === undefined) return undefined
  return { input_tokens: (a?.input_tokens ?? 0) + (b?.input_tokens ?? 0), output_tokens: (a?.output_tokens ?? 0) + (b?.output_tokens ?? 0) }
}

/** Extracts each top-level `constraint ...;` statement from a raw .mzn source, in source order.
 * Deliberately simple (MiniZinc statements in this project's own generated output are always
 * `constraint <expr>;` on one logical unit, per compile.ts's own emission style) — not a real
 * MiniZinc parser, since only constraint TEXT is needed for Jev to read, not to re-execute it. */
export function extractConstraintLines(mzn: string): readonly string[] {
  const matches = mzn.match(/constraint\s[\s\S]*?;/g) ?? []
  return matches.map((m) => m.trim())
}

export interface ClueLocalizationResult {
  readonly clue: string
  /** Indices into the draft's constraint-line list that Jev selected as addressing this clue;
   * empty when Jev found no matching line (a real, reportable finding — e.g. a dropped clue). */
  readonly selectedIndices: readonly number[]
  readonly selectConfidence: number | undefined
  /** undefined when selectedIndices is empty — nothing to judge fidelity of. */
  readonly fidelityNoul: number | undefined
  readonly latencyMs: number
  /** Summed token usage across both the select and judge calls (see pairwise-equivalence.ts's
   * EquivalenceVerdict.usage doc). */
  readonly usage: Usage | undefined
  readonly error: string | undefined
}

const NONE_LABEL = "__none__"

/** Step 1 (select): given one clue and the draft's full list of constraint lines, which line(s)
 * (if any) address it? A Choice over line indices plus an explicit "none" option (per
 * primitives/choice.md's own "include an other/none-of-the-above option" guidance) — asked as a
 * single-select first pass; a compound clue spanning multiple lines would need a follow-up, out
 * of scope for this first-contact spike (see SPIKE.md Notes if this limitation bites on the two
 * puzzles tested). */
async function selectAddressingLine(
  clue: string,
  constraintLines: readonly string[],
  askFn: AskFn,
): Promise<{ readonly index: number | undefined; readonly confidence: number | undefined; readonly usage: Usage | undefined; readonly latencyMs: number; readonly error?: string }> {
  const criteria: Record<string, string> = { [NONE_LABEL]: "No constraint line addresses this clue at all." }
  constraintLines.forEach((line, i) => {
    criteria[`line${i}`] = line
  })
  const response = await askFn(
    { clue, constraintLines: [...constraintLines] },
    {
      addressedBy: {
        type: "choice",
        instructions: "Which ONE of `constraintLines` (by its label) is the constraint meant to encode this specific clue? Choose the closest match even if imperfect; choose the none option only if truly nothing addresses it.",
        criteria,
      },
    },
  )
  if (!response.ok) return { index: undefined, confidence: undefined, usage: undefined, latencyMs: response.latencyMs, error: response.error }
  const { choice, confidence } = response.result.answers.addressedBy
  if (choice === NONE_LABEL) return { index: undefined, confidence, usage: response.result.usage, latencyMs: response.latencyMs }
  const index = Number(choice.replace("line", ""))
  return { index, confidence, usage: response.result.usage, latencyMs: response.latencyMs }
}

/** Step 2 (judge): given ONLY the clue and its selected line, does the line fully and correctly
 * capture it? Per jaggedness bullet 1 (literal reading), the boundary case is spelled out
 * explicitly rather than left implied — "fully" means every entity/relation the clue mentions. */
async function judgeFidelity(clue: string, selectedLine: string, askFn: AskFn): Promise<{ readonly noul: number | undefined; readonly usage: Usage | undefined; readonly latencyMs: number; readonly error?: string }> {
  const response = await askFn(
    { clue, constraintLine: selectedLine },
    {
      fullyCaptures: {
        type: "noul",
        instructions: "Does `constraintLine` fully and correctly capture EVERY entity and relation that `clue` mentions, with nothing missing or contradicted?",
        criteria: {
          true: "Every entity/relation the clue mentions is present and correctly related in the constraint line.",
          false: "At least one entity/relation from the clue is missing, wrong, or contradicted by the constraint line.",
        },
      },
    },
  )
  if (!response.ok) return { noul: undefined, usage: undefined, latencyMs: response.latencyMs, error: response.error }
  return { noul: response.result.answers.fullyCaptures.noul, usage: response.result.usage, latencyMs: response.latencyMs }
}

export async function checkClueLocalization(clue: string, constraintLines: readonly string[], askFn: AskFn = ask): Promise<ClueLocalizationResult> {
  const selected = await selectAddressingLine(clue, constraintLines, askFn)
  if (selected.error !== undefined) {
    return { clue, selectedIndices: [], selectConfidence: undefined, fidelityNoul: undefined, usage: selected.usage, latencyMs: selected.latencyMs, error: selected.error }
  }
  if (selected.index === undefined) {
    return { clue, selectedIndices: [], selectConfidence: selected.confidence, fidelityNoul: undefined, usage: selected.usage, latencyMs: selected.latencyMs, error: undefined }
  }
  const judged = await judgeFidelity(clue, constraintLines[selected.index]!, askFn)
  return {
    clue,
    selectedIndices: [selected.index],
    selectConfidence: selected.confidence,
    fidelityNoul: judged.noul,
    usage: sumUsage(selected.usage, judged.usage),
    latencyMs: selected.latencyMs + judged.latencyMs,
    error: judged.error,
  }
}
