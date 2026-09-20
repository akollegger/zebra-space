// SPIKE-015 §2 step 3: scores the model's own domain identification against the puzzle's
// catalog front-matter (groundTruthFor, from SPIKE-013) BEFORE anything downstream runs — the
// primary finding this variant is designed to surface. This is a prose-space value-string
// comparison — a DIFFERENT concern from step 4's identifier-spelling fold (sanitizeIdentifier +
// comparisonKey applied to a .mzn's enum-member spelling), but both go through the SAME shared
// fold (ADR-011, `src/eval/aliases.ts`'s `stringsMatch`) rather than two independent
// normalizations, so a spelling variant accepted in one place is accepted the same way in the
// other. Do not reintroduce a local case/whitespace-only heuristic here.
//
// Name-matching dropped as a scoring GATE (2026-09-18, per user decision, superseding the
// ADR-011-migrated `nameResembles`-as-gate design in the previous revision of this file):
// neither `apply-to-prose.ts` nor `apply-to-mzn.ts` ever reads the model's proposed domain
// NAME — both operate purely on the proposed VALUES (literal replace / fold-matched enum
// rewrite). So requiring the name to also resemble ground truth was scoring an artifact of how
// the model self-reports its choice, not something the downstream mechanism needs. §5.3 found
// this chasing morphological variance ("game move(s)" vs "move") and running into genuine
// synonym variance ("action"/"game" vs "move") that curation alone can't close — both are
// symptoms of gating on a signal the pipeline doesn't actually depend on. Value-set equality
// (already the primary signal per §5.1) is now the sole scoring gate; the proposed name is
// reported for human legibility only, never used to accept or reject a rep.

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

/** Informational only (never a scoring gate — see file header): true iff `proposedName`
 * resembles any of a domain's own curated acceptable names, via the shared fold (ADR-011) —
 * case/whitespace/pluralization variance for free, plus any additional variant `names` itself
 * lists. Used only to decide what to print in `reason` when multiple value-matching
 * alternatives exist, and to note a name mismatch for a human reader. */
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

/** Scores a proposal's own currentValues against ground truth by VALUE-SET equality alone —
 * domain name is informational only (see file header), never gates matched/not-matched. When
 * more than one alternative's value set matches (ambiguous — not observed in this catalog so
 * far), the name is used only to pick which one to report as `matchedAlternative`, defaulting
 * to the first. When no alternative's values match, diagnoses against whichever alternative is
 * numerically closest (fewest missing+invented values) rather than a name-matched candidate, so
 * the diagnosis is always the most informative one available even when the name is unrelated. */
export function scoreDomainMatch(proposal: DomainMappingProposal, groundTruth: GroundTruthEntry): DomainMatchResult {
  const valueMatches: DomainAlternative[] = []
  for (const domain of groundTruth.domains) {
    for (const alt of domain.alternatives) {
      if (sameSet(alt.values, proposal.currentValues)) valueMatches.push(alt)
    }
  }

  if (valueMatches.length > 0) {
    const preferred = valueMatches.find((alt) => nameResembles(proposal.domain, alt.names)) ?? valueMatches[0]!
    const reason = nameResembles(proposal.domain, preferred.names)
      ? "domain name and complete value set both match"
      : `complete value set matches (name(s): ${preferred.names.join(", ")}); proposed domain name "${proposal.domain}" doesn't resemble it — informational only, does not affect the match`
    return { matched: true, reason, matchedAlternative: preferred }
  }

  let best: { readonly alt: DomainAlternative; readonly missing: readonly string[]; readonly invented: readonly string[] } | undefined
  for (const domain of groundTruth.domains) {
    for (const alt of domain.alternatives) {
      const missing = missingFrom(alt.values, proposal.currentValues)
      const invented = inventedIn(alt.values, proposal.currentValues)
      if (best === undefined || missing.length + invented.length < best.missing.length + best.invented.length) {
        best = { alt, missing, invented }
      }
    }
  }

  if (best === undefined) {
    return { matched: false, reason: "puzzle has no expected domains to compare against" }
  }

  const parts: string[] = []
  if (best.missing.length > 0) parts.push(`missing [${best.missing.join(", ")}]`)
  if (best.invented.length > 0) parts.push(`invented [${best.invented.join(", ")}]`)
  return {
    matched: false,
    reason: `closest expected domain (name(s): ${best.alt.names.join(", ")}) has a different value set: ${parts.join("; ")}`,
  }
}
