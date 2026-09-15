// SPIKE-013 §2 step 2: correctness scoring against ground-truth.ts. Coverage-style matching
// throughout (every expected item must be found; extras are never penalized — mirrors ADR-007
// §2.2's own lesson for the real grader, "the false MISMATCH is fixed by owning answer shape,"
// applied here to structure instead of solved values). Domain-NAME matching tries exact
// normalized string match first, falling back to semantic (embedding) similarity ONLY when
// normalization alone doesn't find a match — catching genuine synonym drift ("nationality" vs.
// "citizenship") string normalization can't, without paying an embedding call for the common
// case where names already match.

import { groundTruthFor } from "./ground-truth.ts"
import { normalize, normalizeSet } from "./normalize.ts"

export interface ProducedEntity {
  readonly id: string
  readonly type: string
}
export interface ProducedDomain {
  readonly variable: string
  readonly entityType: string
  readonly values: readonly string[]
}

export interface DomainMatchResult {
  readonly expectedNames: readonly string[];
  readonly matched: boolean
  readonly matchedProducedName: string | undefined
  readonly matchedViaEmbedding: boolean
}

export interface ScoreResult {
  readonly puzzleId: string
  readonly entityAxisSizeMatch: boolean
  readonly expectedEntityAxisSize: number
  readonly producedEntityAxisSizes: readonly number[]
  readonly domainResults: readonly DomainMatchResult[]
  readonly domainsCovered: number
  readonly domainsTotal: number
  readonly structurallyCorrect: boolean
}

export type SemanticNameMatch = (a: string, b: string) => Promise<boolean>

/** Never claims a semantic match — used when embeddings aren't wired in (e.g. offline unit
 * tests), so only exact normalized matches count. */
export const noSemanticMatch: SemanticNameMatch = async () => false

export async function scoreVocabulary(
  puzzleId: string,
  entities: readonly ProducedEntity[],
  domains: readonly ProducedDomain[],
  semanticNameMatch: SemanticNameMatch = noSemanticMatch,
): Promise<ScoreResult | undefined> {
  const truth = groundTruthFor(puzzleId)
  if (truth === undefined) return undefined

  const sizeByType = new Map<string, number>()
  for (const e of entities) sizeByType.set(e.type, (sizeByType.get(e.type) ?? 0) + 1)
  const producedEntityAxisSizes = [...sizeByType.values()]
  const entityAxisSizeMatch = producedEntityAxisSizes.includes(truth.expectedEntityAxisSize)

  const domainResults: DomainMatchResult[] = []
  for (const expected of truth.domains) {
    let matched = false
    let matchedProducedName: string | undefined
    let matchedViaEmbedding = false

    for (const d of domains) {
      const exactNameMatch = expected.names.some((n) => normalize(n) === normalize(d.variable))
      let nameMatches = exactNameMatch
      let viaEmbedding = false
      if (!nameMatches) {
        for (const n of expected.names) {
          if (await semanticNameMatch(n, d.variable)) {
            nameMatches = true
            viaEmbedding = true
            break
          }
        }
      }
      if (!nameMatches) continue

      const producedValues = normalizeSet(d.values)
      const valuesCovered = expected.valueSets.some((valueSet) => valueSet.every((v) => producedValues.has(normalize(v))))
      if (valuesCovered) {
        matched = true
        matchedProducedName = d.variable
        matchedViaEmbedding = viaEmbedding
        break
      }
    }

    domainResults.push({ expectedNames: expected.names, matched, matchedProducedName, matchedViaEmbedding })
  }

  const domainsCovered = domainResults.filter((d) => d.matched).length
  return {
    puzzleId,
    entityAxisSizeMatch,
    expectedEntityAxisSize: truth.expectedEntityAxisSize,
    producedEntityAxisSizes,
    domainResults,
    domainsCovered,
    domainsTotal: truth.domains.length,
    structurallyCorrect: entityAxisSizeMatch && domainsCovered === truth.domains.length,
  }
}
