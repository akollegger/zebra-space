// SPIKE-015 §2 step 4a: literal find-and-replace of the mapping against puzzle prose. Safe
// unconditionally — step 3 (score-domain-match.ts) already confirmed these exact value strings
// are the puzzle's real current values, so they are guaranteed to appear verbatim in the prose.

export interface MappingEntry {
  readonly oldValue: string
  readonly newValue: string
}

/** Replaces every occurrence of each oldValue with its newValue. Uses split/join rather than a
 * single .replace() to catch every occurrence — a value can appear more than once in prose (the
 * domain's intro sentence, plus later clues). */
export function applyMappingToProse(prose: string, mapping: readonly MappingEntry[]): string {
  let draft = prose
  for (const { oldValue, newValue } of mapping) {
    draft = draft.split(oldValue).join(newValue)
  }
  return draft
}
