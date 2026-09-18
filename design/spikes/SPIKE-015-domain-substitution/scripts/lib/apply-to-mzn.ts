// SPIKE-015 §2 step 4b: applies the SAME mapping used on the prose to the seed .mzn's enum
// members — NOT by literal string match, since a .mzn's enum-member spelling can differ from
// the prose's own spelling of the same value (the case/separator gap SPIKE-014 §5.7 found and
// fixed for the grader, e.g. LuckyStrike vs. the prose's Lucky Strike). Instead, fold-matches
// via sanitizeIdentifier + a case/separator-insensitive comparisonKey (duplicated from
// src/eval/grader.ts's own private, non-exported one-liner — same duplicate-rather-than-export
// convention SPIKE-008's puzzles.ts documents for throwaway spike helpers).
//
// A mapping entry whose fold-matched identifier isn't found EXACTLY ONCE among the .mzn's
// declared enum members is skipped and recorded, never guessed — mirrors mzn-lint-repair.ts's
// applyFindings discipline (count occurrences, require exactly 1, else push to skipped).

import { sanitizeIdentifier } from "../../../../../src/compiler/compile.ts"
import type { MappingEntry } from "./apply-to-prose.ts"

function comparisonKey(sanitized: string): string {
  return sanitized.toLowerCase().replace(/_/g, "")
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Every declared enum member across every `enum Name = {...};` block in the file (a .mzn can
 * declare more than one enum, e.g. PZL-0002 has COLOR and ANIMAL). */
function declaredEnumMembers(mzn: string): readonly string[] {
  const members: string[] = []
  for (const match of mzn.matchAll(/enum\s+\w+\s*=\s*\{([^}]*)\}/g)) {
    for (const raw of match[1]!.split(",")) {
      const trimmed = raw.trim()
      if (trimmed !== "") members.push(trimmed)
    }
  }
  return members
}

export interface EnumApplySkip {
  readonly oldValue: string
  readonly newValue: string
  readonly reason: string
}

export interface EnumApplyResult {
  readonly mzn: string
  readonly applied: number
  readonly skipped: readonly EnumApplySkip[]
}

/** Applies mapping to the .mzn's enum members by fold-matching each oldValue against every
 * declared enum member, requiring EXACTLY ONE match, then rewriting that member EVERYWHERE in
 * the file (not just the enum declaration line — a constraint elsewhere references the same
 * identifier, e.g. `color[1] = OldMember;`, and leaving those un-renamed breaks compilation). A
 * .mzn with no enum declarations at all (e.g. PZL-0007, whose domain is plain int digits) skips
 * every entry with reason "no enum declarations in this .mzn". */
export function applyMappingToMzn(mzn: string, mapping: readonly MappingEntry[]): EnumApplyResult {
  const members = declaredEnumMembers(mzn)
  let draft = mzn
  let applied = 0
  const skipped: EnumApplySkip[] = []

  if (members.length === 0) {
    for (const { oldValue, newValue } of mapping) {
      skipped.push({ oldValue, newValue, reason: "no enum declarations in this .mzn" })
    }
    return { mzn: draft, applied, skipped }
  }

  for (const { oldValue, newValue } of mapping) {
    const targetKey = comparisonKey(sanitizeIdentifier(oldValue))
    const matches = members.filter((m) => comparisonKey(sanitizeIdentifier(m)) === targetKey)

    if (matches.length === 0) {
      skipped.push({ oldValue, newValue, reason: "not found among declared enum members" })
      continue
    }
    if (matches.length > 1) {
      skipped.push({ oldValue, newValue, reason: `matched ${matches.length} enum members, not unique` })
      continue
    }

    const realMember = matches[0]!
    const replacement = sanitizeIdentifier(newValue)
    const boundary = new RegExp(`\\b${escapeRegExp(realMember)}\\b`, "g")
    draft = draft.replace(boundary, replacement)
    applied += 1
  }

  return { mzn: draft, applied, skipped }
}
