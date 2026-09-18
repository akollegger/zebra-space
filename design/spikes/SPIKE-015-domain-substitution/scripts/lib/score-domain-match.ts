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

/** Scores a proposal's own domain name + currentValues against ground truth, per SPIKE-015
 * §2 step 3's comparison rule: name match first, then exact value-set equality (order-
 * insensitive, case/whitespace-normalized) against that same alternative — never a name from
 * one alternative crossed with another's values. */
export function scoreDomainMatch(proposal: DomainMappingProposal, groundTruth: GroundTruthEntry): DomainMatchResult {
  const nameCandidates: DomainAlternative[] = []
  for (const domain of groundTruth.domains) {
    for (const alt of domain.alternatives) {
      if (alt.names.some((n) => normalize(n) === normalize(proposal.domain))) {
        nameCandidates.push(alt)
      }
    }
  }

  if (nameCandidates.length === 0) {
    return { matched: false, reason: `no expected domain has the name "${proposal.domain}"` }
  }

  for (const alt of nameCandidates) {
    if (sameSet(alt.values, proposal.currentValues)) {
      return { matched: true, reason: "domain name and complete value set both match", matchedAlternative: alt }
    }
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
    reason: `domain name "${proposal.domain}" matched but currentValues differs: ${parts.join("; ")}`,
  }
}
