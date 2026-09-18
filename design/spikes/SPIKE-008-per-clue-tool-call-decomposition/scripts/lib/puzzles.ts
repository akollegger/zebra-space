// SPIKE-008 spike-local helper: load the sample puzzles' prose and answer-key entries, and
// split a puzzle's prose into individually-addressable "clues" for the per-clue harness.
//
// loadAnswerKeys is deliberately duplicated from scripts/eval-extraction.ts's own (unexported)
// version rather than imported — this is throwaway spike code per the spike-create skill's own
// convention, kept intentionally small. loadAliases is NOT duplicated here — ADR-011 §2.2/§4
// consolidated the alias loader into src/eval/aliases.ts's exported loadAnswerValueAliases,
// re-exported below under its prior name so nothing importing `loadAliases` from this file needs
// to change.

import { readFile } from "node:fs/promises"
import { loadAnswerValueAliases } from "../../../../../src/eval/aliases.ts"

const REPO_ROOT = new URL("../../../../../", import.meta.url)
const PUZZLES_DIR = new URL("catalog/puzzles/", REPO_ROOT)
const ANSWER_KEYS_PATH = new URL("eval/answer-keys.json", REPO_ROOT)

export interface AnswerKeyEntry {
  readonly title: string
  readonly answer: unknown
  readonly notes: string
  readonly outcome?: string | undefined
  readonly failing_condition?: string | undefined
  readonly readings?: readonly unknown[] | undefined
  readonly without_premise?: unknown
  readonly with_premise?: unknown
}

export async function loadAnswerKeys(): Promise<Record<string, AnswerKeyEntry>> {
  const raw = JSON.parse(await readFile(ANSWER_KEYS_PATH, "utf8")) as Record<string, unknown>
  const { $comment: _ignored, ...entries } = raw
  return entries as Record<string, AnswerKeyEntry>
}

export const loadAliases = loadAnswerValueAliases

export async function loadPuzzleProse(puzzleId: string): Promise<{ readonly file: string; readonly prose: string }> {
  const files = await import("node:fs/promises").then((fs) => fs.readdir(PUZZLES_DIR))
  const file = files.find((f) => f.startsWith(`${puzzleId}-`) && f.endsWith(".md"))
  if (file === undefined) throw new Error(`No catalog file found for ${puzzleId}`)
  const raw = await readFile(new URL(file, PUZZLES_DIR), "utf8")
  // Strip the YAML front-matter (--- ... ---), same shape src/cli/subcommands/extract.ts's
  // prose path already assumes — the front-matter is metadata, not puzzle text.
  const prose = raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim()
  return { file, prose }
}

export interface SplitClues {
  /** True when the prose had a recognizable numbered clue list to split on. */
  readonly decomposable: boolean
  /** One entry per clue when decomposable; a single entry (the whole prose) otherwise. */
  readonly clues: readonly string[]
  /** Whatever prose preceded the first numbered clue (scenario setup) — always sent alongside
   * each per-clue call, since a clue like "1. The couple's credit tier..." is meaningless
   * without knowing who "the couple" is. */
  readonly preamble: string
  /** Whatever prose followed the last numbered clue (usually the closing question). */
  readonly trailer: string
}

/**
 * Splits puzzle prose on a leading `N. ` numbered-list marker at the start of a line — the
 * shape every classic zebra-style catalog puzzle (PZL-0001/0002/0003/0004/0010/0011/0012/0028/
 * 0038, etc.) already uses. Found live (2026-09-15, this spike): not every catalog puzzle has
 * this shape — PZL-0007 (SEND+MORE=MONEY, an ASCII arithmetic diagram), PZL-0022 (a markdown
 * table of items), and PZL-0033 (a plain prose paragraph) carry no numbered list at all. For
 * those, `decomposable` is false and `clues` is a single entry (the whole prose) — the per-clue
 * harness degenerates to a single call for these puzzles, which is itself a data point for
 * sub-question 2 (net cost): decomposition cannot reduce call count below 1, so these puzzles
 * test the floor, not the mechanism.
 */
export function splitClues(prose: string): SplitClues {
  const lines = prose.split("\n")
  const clueLineRe = /^\s*(\d+)\.\s+/
  const clueStarts: number[] = []
  lines.forEach((line, i) => {
    if (clueLineRe.test(line)) clueStarts.push(i)
  })
  // Require at least 2 numbered items in sequence to call this a clue list (a single "1." could
  // be a stray enumeration, e.g. a footnote) — every real catalog puzzle sampled has 3+.
  if (clueStarts.length < 2) {
    return { decomposable: false, clues: [prose], preamble: "", trailer: "" }
  }
  const preamble = lines.slice(0, clueStarts[0]).join("\n").trim()
  const clues: string[] = []
  for (let i = 0; i < clueStarts.length; i++) {
    const start = clueStarts[i]!
    const end = i + 1 < clueStarts.length ? clueStarts[i + 1]! : lines.length
    clues.push(lines.slice(start, end).join("\n").trim())
  }
  // Trailer: nothing captured above — the last clue's slice already runs to EOF. Puzzles in
  // this sample close with a question on its own line immediately after the last numbered
  // item (no intervening blank-then-prose block), so it rides along inside the last clue's
  // text; keeping it there (rather than special-casing it out) means the last per-clue call
  // also sees the question, which does no harm since the schema still only asks for one
  // clue's constraint.
  return { decomposable: true, clues, preamble, trailer: "" }
}
