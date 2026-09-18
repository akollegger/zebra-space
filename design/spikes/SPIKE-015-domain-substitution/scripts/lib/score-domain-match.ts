// SPIKE-015 §2 step 3: scores the model's own domain identification against the puzzle's
// catalog front-matter (groundTruthFor, from SPIKE-013) BEFORE anything downstream runs — the
// primary finding this variant is designed to surface. This is a prose-space name/value-string
// comparison (case/whitespace only) — a DIFFERENT concern from step 4's identifier-spelling fold
// (sanitizeIdentifier + comparisonKey), which matches against a .mzn's enum-member spelling, not
// prose-value spelling. Do not conflate the two normalizations.

import type { DomainAlternative, GroundTruthEntry } from "../../../SPIKE-013-vocabulary-construction-isolation/scripts/lib/ground-truth.ts"
import type { DomainMappingProposal } from "./mapping-schema.ts"

export interface DomainMatchResult {
  readonly matched: boolean
  readonly reason: string
  /** Which expectedDomains alternative matched, when matched === true — step 4 needs this to
   * know which domain's TRUE values are being remapped for the .mzn fold-match. */
  readonly matchedAlternative?: DomainAlternative
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

/** Relaxed name match — exact, or either string containing the other (case/whitespace
 * normalized). Found live 2026-09-18 (PZL-0003): the model named the domain "game move"/"game
 * moves" where ground truth calls it "move" — a qualifier word and plain pluralization a human
 * grader would accept instantly, which strict equality rejected outright, discarding a rep whose
 * currentValues may well have been entirely correct. Substring containment covers both real
 * cases ("move" is a substring of both "game move" and "game moves") without requiring a full
 * synonym table. */
function nameResembles(proposedName: string, acceptableNames: readonly string[]): boolean {
  const proposed = normalize(proposedName)
  return acceptableNames.some((n) => {
    const accepted = normalize(n)
    return proposed === accepted || proposed.includes(accepted) || accepted.includes(proposed)
  })
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const normA = new Set(a.map(normalize))
  const normB = new Set(b.map(normalize))
  if (normA.size !== normB.size) return false
  for (const v of normA) if (!normB.has(v)) return false
  return true
}

function missingFrom(expected: readonly string[], actual: readonly string[]): readonly string[] {
  const normActual = new Set(actual.map(normalize))
  return expected.filter((v) => !normActual.has(normalize(v)))
}

function inventedIn(expected: readonly string[], actual: readonly string[]): readonly string[] {
  const normExpected = new Set(expected.map(normalize))
  return actual.filter((v) => !normExpected.has(normalize(v)))
}

/** Scores a proposal's own domain name + currentValues against ground truth. Checks VALUE-SET
 * matches first, independent of name, so a near-miss name never hides a fully correct value-set
 * finding (found live 2026-09-18: the old name-first order short-circuited before ever looking
 * at currentValues, making a near-miss name indistinguishable from a genuinely wrong domain). A
 * value-matching alternative whose name also (approximately) resembles the proposal is a full
 * match; a value-matching alternative whose name does NOT resemble it is reported as its own
 * distinct, informative near-miss rather than silently treated the same as "nothing matched at
 * all". Only when NO alternative's values match anything does this fall back to a name-based
 * diagnosis, for a concrete missing/invented-values reason. */
export function scoreDomainMatch(proposal: DomainMappingProposal, groundTruth: GroundTruthEntry): DomainMatchResult {
  const valueMatches: DomainAlternative[] = []
  for (const domain of groundTruth.domains) {
    for (const alt of domain.alternatives) {
      if (sameSet(alt.values, proposal.currentValues)) valueMatches.push(alt)
    }
  }

  for (const alt of valueMatches) {
    if (nameResembles(proposal.domain, alt.names)) {
      return { matched: true, reason: "domain name (approximately) and complete value set both match", matchedAlternative: alt }
    }
  }

  if (valueMatches.length > 0) {
    const acceptableNames = valueMatches.flatMap((alt) => alt.names).join(", ")
    return {
      matched: false,
      reason: `currentValues exactly match a real domain (name(s): ${acceptableNames}), but proposed domain name "${proposal.domain}" doesn't resemble it`,
    }
  }

  const nameCandidates: DomainAlternative[] = []
  for (const domain of groundTruth.domains) {
    for (const alt of domain.alternatives) {
      if (nameResembles(proposal.domain, alt.names)) nameCandidates.push(alt)
    }
  }

  if (nameCandidates.length === 0) {
    return { matched: false, reason: `no expected domain resembles the name "${proposal.domain}"` }
  }

  // Report against the first name-matching candidate for a concrete, actionable diff.
  const alt = nameCandidates[0]!
  const missing = missingFrom(alt.values, proposal.currentValues)
  const invented = inventedIn(alt.values, proposal.currentValues)
  const parts: string[] = []
  if (missing.length > 0) parts.push(`missing [${missing.join(", ")}]`)
  if (invented.length > 0) parts.push(`invented [${invented.join(", ")}]`)
  return {
    matched: false,
    reason: `domain name "${proposal.domain}" resembles an expected domain but currentValues differs: ${parts.join("; ")}`,
  }
}
