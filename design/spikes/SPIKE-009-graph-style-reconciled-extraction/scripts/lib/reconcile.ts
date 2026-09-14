// SPIKE-009: deterministic cross-clue reconciliation — turns a list of per-clue local
// VocabularyProposals into one canonical ExtractedVocabulary. Pure, offline-testable, no LLM
// call (an explicit scope decision for this pass — see SPIKE.md §2/§4: near-duplicate/fuzzy
// merging is deferred, not built here).

import type { Vocabulary } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/clue-schema.ts"
import type { VocabularyProposal } from "./propose-vocabulary.ts"

function normalize(s: string): string {
  return s.trim().toLowerCase()
}

export interface ReconciledEntity {
  readonly id: string
  readonly type: string
  /** Every (normalized) surface form / canonicalIdGuess that merged into this entity. */
  readonly mergedFrom: readonly string[]
  readonly clueIndices: readonly number[]
}

export interface ReconciledDomain {
  readonly variable: string
  readonly entityType: string
  readonly values: readonly string[]
  readonly clueIndices: readonly number[]
  /** True when this domain was synthesized by step 5 (an ordering hint with no backing domain)
   * rather than proposed directly by any clue — kept for diagnostics/Findings, not used by
   * assembly. */
  readonly synthesized: boolean
}

export interface ReconciliationResult {
  readonly vocabulary: Vocabulary
  readonly entities: readonly ReconciledEntity[]
  readonly domains: readonly ReconciledDomain[]
  /** clueIndex -> ids of entities/domains(variable names) that clue contributed to something
   * that survived reconciliation — used by filter.ts to drop constraints from clues whose only
   * contribution never survived. */
  readonly survivingClueIndices: ReadonlySet<number>
}

/**
 * Steps 2-3 (SPIKE.md §2): exact-match merge of entity mentions within a normalized-typeGuess
 * bucket, on normalized canonicalIdGuess OR normalized surfaceForm.
 */
function mergeEntities(proposals: readonly VocabularyProposal[]): ReconciledEntity[] {
  const byType = new Map<string, { readonly key: string; readonly typeGuess: string; readonly clueIndices: number[]; readonly mergedFrom: Set<string> }[]>()

  for (const proposal of proposals) {
    for (const mention of proposal.entityMentions) {
      const type = normalize(mention.typeGuess)
      const key = normalize(mention.canonicalIdGuess ?? mention.surfaceForm)
      const bucket = byType.get(type) ?? []
      byType.set(type, bucket)
      const existing = bucket.find((e) => e.key === key)
      if (existing !== undefined) {
        existing.clueIndices.push(proposal.clueIndex)
        existing.mergedFrom.add(normalize(mention.surfaceForm))
        if (mention.canonicalIdGuess !== undefined) existing.mergedFrom.add(normalize(mention.canonicalIdGuess))
        continue
      }
      const mergedFrom = new Set([normalize(mention.surfaceForm)])
      if (mention.canonicalIdGuess !== undefined) mergedFrom.add(normalize(mention.canonicalIdGuess))
      bucket.push({ key, typeGuess: mention.typeGuess, clueIndices: [proposal.clueIndex], mergedFrom })
    }
  }

  const result: ReconciledEntity[] = []
  for (const [type, bucket] of byType) {
    bucket.forEach((entry, i) => {
      result.push({
        id: `${type}${i + 1}`,
        type: entry.typeGuess,
        mergedFrom: [...entry.mergedFrom],
        clueIndices: entry.clueIndices,
      })
    })
  }
  return result
}

interface DomainCandidate {
  readonly attributeNameGuess: string
  readonly entityTypeGuess: string
  readonly values: Set<string>
  readonly clueIndices: number[]
  readonly anyOrderingHint: boolean
}

/** Step 3: exact-match merge of domain mentions on (normalized attributeNameGuess, normalized
 * entityTypeGuess). Values accumulate as a union; anyOrderingHint is true if ANY merged mention
 * flagged it. */
function mergeDomainMentions(proposals: readonly VocabularyProposal[]): DomainCandidate[] {
  const byKey = new Map<string, DomainCandidate & { readonly values: Set<string>; readonly clueIndices: number[] }>()
  for (const proposal of proposals) {
    for (const mention of proposal.domainMentions) {
      const key = `${normalize(mention.attributeNameGuess)}::${normalize(mention.entityTypeGuess)}`
      const existing = byKey.get(key)
      if (existing !== undefined) {
        existing.values.add(mention.valueMentioned)
        existing.clueIndices.push(proposal.clueIndex)
        if (mention.isOrderingHint) (existing as { anyOrderingHint: boolean }).anyOrderingHint = true
        continue
      }
      byKey.set(key, {
        attributeNameGuess: mention.attributeNameGuess,
        entityTypeGuess: mention.entityTypeGuess,
        values: new Set([mention.valueMentioned]),
        clueIndices: [proposal.clueIndex],
        anyOrderingHint: mention.isOrderingHint,
      })
    }
  }
  return [...byKey.values()]
}

/** Whether an existing domain candidate already looks like an ordered/numeric domain over this
 * entity type — a plain heuristic (every value parses as an integer) good enough to decide
 * "does an ordering domain already exist" without needing a dedicated "isOrdered" proposal
 * field. */
function looksOrdered(values: ReadonlySet<string>): boolean {
  return [...values].every((v) => /^\d+$/.test(v))
}

/**
 * Step 4 (entity-indexed vs. scalar, decided AFTER merging) + step 5 (synthesize a positional
 * domain for an ordering hint with no backing ordered domain — the PZL-0001 fix). Returns final
 * ReconciledDomain[] plus updated ReconciledEntity[] (step 5 may need to synthesize entities
 * when no independent entity set exists for the ordering hint's type — see inline comment).
 */
function resolveDomains(candidates: readonly DomainCandidate[], entities: readonly ReconciledEntity[]): { readonly domains: ReconciledDomain[]; readonly entities: ReconciledEntity[] } {
  const domains: ReconciledDomain[] = []
  let workingEntities = [...entities]

  const entitiesOfType = (type: string) => workingEntities.filter((e) => normalize(e.type) === normalize(type))

  for (const candidate of candidates) {
    domains.push({
      variable: candidate.attributeNameGuess,
      entityType: candidate.entityTypeGuess,
      values: [...candidate.values],
      clueIndices: candidate.clueIndices,
      synthesized: false,
    })
  }

  // Step 5: for every ordering-hinted candidate whose entity type has no domain that already
  // looks ordered, synthesize one. "No backing domain" is checked against the FULL set of
  // resolved domains so far (including other merged candidates for the same type), not just
  // the ordering-hinted one itself — a puzzle may separately declare a genuine position domain
  // that the ordering clue itself never mentioned by name.
  for (const candidate of candidates) {
    if (!candidate.anyOrderingHint) continue
    const sameTypeDomains = domains.filter((d) => normalize(d.entityType) === normalize(candidate.entityTypeGuess))
    const hasOrderedDomain = sameTypeDomains.some((d) => looksOrdered(new Set(d.values)))
    if (hasOrderedDomain) continue

    let entitiesForType = entitiesOfType(candidate.entityTypeGuess)
    // No independently-proposed entities exist for this type at all — this is exactly
    // PZL-0010's shape (an "arrival-order" attribute with no entity ever separately named):
    // synthesize one entity per distinct value the ordering-hinted candidate itself
    // accumulated, since those values ARE the participants being ordered.
    if (entitiesForType.length === 0) {
      const synthesizedType = candidate.entityTypeGuess
      const newEntities: ReconciledEntity[] = [...candidate.values].map((value, i) => ({
        id: `${normalize(synthesizedType)}_synth${i + 1}`,
        type: synthesizedType,
        mergedFrom: [normalize(value)],
        clueIndices: candidate.clueIndices,
      }))
      workingEntities = [...workingEntities, ...newEntities]
      entitiesForType = newEntities
    }

    const positionalVariable = `${candidate.attributeNameGuess}-position`
    if (!domains.some((d) => d.variable === positionalVariable)) {
      domains.push({
        variable: positionalVariable,
        entityType: candidate.entityTypeGuess,
        values: entitiesForType.map((_, i) => String(i + 1)),
        clueIndices: candidate.clueIndices,
        synthesized: true,
      })
    }
  }

  return { domains, entities: workingEntities }
}

export function reconcile(proposals: readonly VocabularyProposal[]): ReconciliationResult {
  const mergedEntities = mergeEntities(proposals)
  const domainCandidates = mergeDomainMentions(proposals)
  const { domains, entities } = resolveDomains(domainCandidates, mergedEntities)

  const survivingClueIndices = new Set<number>()
  for (const e of entities) for (const i of e.clueIndices) survivingClueIndices.add(i)
  for (const d of domains) for (const i of d.clueIndices) survivingClueIndices.add(i)

  const vocabulary: Vocabulary = {
    entities: entities.map((e) => ({ id: e.id, type: e.type })),
    domains: domains.map((d) => ({ variable: d.variable, entityType: d.entityType, values: d.values })),
  }

  return { vocabulary, entities, domains, survivingClueIndices }
}
