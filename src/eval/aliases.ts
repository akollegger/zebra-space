// ADR-011 §2.2: the ONE loader for eval/aliases.json, replacing the two duplicated loadAliases()
// bodies that previously read this same file independently (scripts/eval-extraction.ts,
// design/spikes/SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts). Also exports
// stringsMatch, a convenience wrapper over grader.ts's existing normalizeToken (ADR-011 §2.2/
// research.md Decision 1 — grader.ts's normalizeToken/comparisonKey/AliasTable already are the
// generic shared primitive; this file adds no new comparison logic, only a loader and a
// boolean-shaped convenience call for consumers who don't need normalizeToken's richer
// {normalized, aliasApplied} return shape).

import { readFile } from "node:fs/promises"
import { type AliasTable, normalizeToken } from "./grader.ts"

const ALIASES_PATH = new URL("../../eval/aliases.json", import.meta.url)

export async function loadAnswerValueAliases(): Promise<AliasTable> {
  const raw = JSON.parse(await readFile(ALIASES_PATH, "utf8")) as { aliases?: AliasTable }
  return raw.aliases ?? {}
}

/** True iff a and b normalize to the same token under the existing case/separator/pluralization
 * fold plus the given alias table — never a fuzzy/similarity signal (ADR-011 §2.3, FR-006). */
export function stringsMatch(a: string, b: string, aliases: AliasTable = {}): boolean {
  return normalizeToken(a, aliases).normalized === normalizeToken(b, aliases).normalized
}

export type { AliasTable }
