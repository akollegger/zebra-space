// SPIKE-015 §2 step 4a: find-and-replace of the mapping against puzzle prose.
//
// NOT case-sensitive-safe by construction — found live 2026-09-18 (SPIKE.md §5.5), caught by
// judge-substitution.ts's own critic on its first run against PZL-0003: the seed's intro
// sentence uses lowercase values ("paper-rock-scissors"), but its numbered rules capitalize the
// SAME words as sentence-initial subjects ("Paper beats rock."). A model's reported
// `currentValues` reflects the intro's casing; matching only that exact string (the original
// case-sensitive `split().join()`) silently left every capitalized occurrence unsubstituted
// while the lowercase mid-sentence occurrences (inside "beats X") were replaced — a puzzle whose
// old and new domains were both present at once. Matching case-insensitively and re-applying
// each individual match's own casing (all-caps, capitalized, or as-is) to the replacement fixes
// this without needing every occurrence in the prose to share one casing.
//
// Word-boundary regression found live 2026-09-18, same debugging session: matching
// case-insensitively without word boundaries makes a short oldValue match INSIDE an unrelated
// word — "Red" case-insensitively matches the "red" inside "numbeRed" ("Three houses stand in
// a row, numbered 1 to 3..."), corrupting it to "numbeOrange". The original case-sensitive
// version never hit this (capitalized "Red" never matched lowercase "red" inside "numbered"),
// so relaxing case-sensitivity reintroduced a DIFFERENT failure mode. `\b...\b` word boundaries
// fix this: a match must start/end at a word edge, so "numbered" no longer contains a match for
// "red" (its interior character transitions aren't word boundaries), while every real
// standalone occurrence ("Red House", "red", "RED") still matches.

export interface MappingEntry {
  readonly oldValue: string
  readonly newValue: string
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Re-applies one matched occurrence's own casing style to a replacement value: all-uppercase
 * stays all-uppercase, a capitalized (first-letter-upper) match capitalizes the replacement's
 * first letter, anything else (e.g. already lowercase, or mixed) is left as the replacement was
 * given. */
function matchCase(matched: string, replacement: string): string {
  if (matched.length > 1 && matched === matched.toUpperCase() && matched !== matched.toLowerCase()) {
    return replacement.toUpperCase()
  }
  if (matched[0] === matched[0]?.toUpperCase() && matched.slice(1) === matched.slice(1).toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1)
  }
  return replacement
}

/** Replaces every occurrence of each oldValue with its newValue, case-insensitively, preserving
 * each individual match's own casing on the replacement (see file header for why this is
 * necessary, not just nice-to-have), in ONE combined pass over the ORIGINAL prose.
 *
 * Single-pass, not sequential — found live via review: applying each mapping entry as its own
 * separate `.replace()` call, one after another against an accumulating draft, means a later
 * entry can match text a PRIOR entry just wrote. A perfectly valid overlapping/cyclic remap
 * like A->B, B->C would then replace every A with B, then that same now-B text with C — the
 * prose no longer reflects the submitted mapping (A ends up as C, never as B). Matching every
 * oldValue in one combined alternation against the ORIGINAL string avoids this: every match is
 * found in pre-existing text, never in another replacement's output. Longest oldValue first in
 * the alternation, so a multi-word entry (e.g. "game move") wins over a shorter one that's also
 * one of its words (e.g. "move") when both could match at the same position. */
export function applyMappingToProse(prose: string, mapping: readonly MappingEntry[]): string {
  if (mapping.length === 0) return prose
  const byLength = [...mapping].sort((a, b) => b.oldValue.length - a.oldValue.length)
  const pattern = new RegExp(`\\b(${byLength.map((m) => escapeForRegExp(m.oldValue)).join("|")})\\b`, "gi")
  return prose.replace(pattern, (matched) => {
    const entry = byLength.find((m) => m.oldValue.toLowerCase() === matched.toLowerCase())
    return entry === undefined ? matched : matchCase(matched, entry.newValue)
  })
}
