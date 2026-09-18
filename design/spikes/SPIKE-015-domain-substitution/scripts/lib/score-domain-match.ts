// SPIKE-015 §2 step 3: scores the model's own domain identification against the puzzle's
// catalog front-matter (groundTruthFor, from SPIKE-013) BEFORE anything downstream runs — the
// primary finding this variant is designed to surface. This is a prose-space name/value-string
// comparison — a DIFFERENT concern from step 4's identifier-spelling fold (sanitizeIdentifier +
// comparisonKey applied to a .mzn's enum-member spelling), but both now go through the SAME
// shared fold (ADR-011, `src/eval/aliases.ts`'s `stringsMatch`) rather than two independent
// normalizations, so a spelling variant accepted in one place is accepted the same way in the
// other. Do not reintroduce a local case/whitespace-only heuristic here.
//
// Migrated 2026-09-18 (ADR-011 §4's deferred follow-up, spec.md's resolved clarification option
// A): this file's own `nameResembles` substring-containment heuristic — built specifically
// because strict equality rejected "game move"/"game moves" against ground truth's "move" — is
// exactly the domain-name-alias case ADR-011 §2.2 designed `AliasTable`/`stringsMatch` for.
// `DomainAlternative.names` (SPIKE-013's own shape) already IS a curated list of acceptable
// names for one domain — the per-puzzle domain-name alias table ADR-011 §2.2 describes, per
// `specs/007-string-equivalence-matching/data-model.md`'s documented adapter
// (`{ [names[0]]: names.slice(1) }`). Using `stringsMatch` picks up the deterministic
// case/whitespace/pluralization fold (so "game move"/"game moves" now match "move" via the fold
// itself, not a substring heuristic) plus any curated variant in `names`, and drops substring
// containment entirely — a genuine synonym like "action" vs. "move" correctly still doesn't
// match, since substring containment never covered that gap either (SPIKE.md §5.2).

import type { DomainAlternative, GroundTruthEntry } from "../../../SPIKE-013-vocabulary-construction-isolation/scripts/lib/ground-truth.ts"
import { stringsMatch } from "../../../../../src/eval/aliases.ts"
import type { DomainMappingProposal } from "./mapping-schema.ts"

export interface DomainMatchResult {
  readonly matched: boolean
  readonly reason: string
  /** Which expectedDomains alternative matched, when matched === true — step 4 needs this to
   * know which domain's TRUE values are being remapped for the .mzn fold-match. */
  readonly matchedAlternative?: DomainAlternative
}

/** True iff `proposedName` matches any of a domain's own curated acceptable names, via the
 * shared fold (ADR-011) — case/whitespace/pluralization variance for free, plus any additional
 * variant `names` itself lists, never substring containment or an unlisted synonym. */
function nameResembles(proposedName: string, acceptableNames: readonly string[]): boolean {
  if (acceptableNames.length === 0) return false
  const [canonical, ...variants] = acceptableNames as [string, ...string[]]
  return stringsMatch(proposedName, canonical, { [canonical]: variants })
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const remaining = [...b]
  for (const value of a) {
    const i = remaining.findIndex((v) => stringsMatch(value, v))
    if (i === -1) return false
    remaining.splice(i, 1)
  }
  return true
}

function missingFrom(expected: readonly string[], actual: readonly string[]): readonly string[] {
  return expected.filter((v) => !actual.some((a) => stringsMatch(v, a)))
}

function inventedIn(expected: readonly string[], actual: readonly string[]): readonly string[] {
  return actual.filter((v) => !expected.some((e) => stringsMatch(v, e)))
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
