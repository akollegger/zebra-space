// Wires score.ts's optional embedding fallback to embeddings.ts. A fixed similarity threshold,
// not tuned per name pair — 2026-09-15's own direct measurement (SPIKE.md §4) found a wide gap
// between within-category (0.66-0.87) and cross-category (0.28-0.41) similarity on this
// catalog's actual vocabulary; a threshold anywhere in 0.5-0.6 sits cleanly in that gap. Chosen
// higher than the midpoint (0.55) deliberately, since a false POSITIVE here (accepting an
// unrelated domain name as a match) would silently inflate this spike's own correctness numbers
// — the failure mode this spike exists to measure honestly, not paper over.

import { embedBatch, cosineSimilarity } from "./embeddings.ts"
import { normalize } from "./normalize.ts"
import type { SemanticNameMatch } from "./score.ts"

const THRESHOLD = 0.6

const cache = new Map<string, readonly number[]>()

async function embeddingFor(text: string): Promise<readonly number[]> {
  const key = normalize(text)
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const [vec] = await embedBatch([text])
  cache.set(key, vec!)
  return vec!
}

export const embeddingSemanticMatch: SemanticNameMatch = async (a, b) => {
  if (normalize(a) === normalize(b)) return true // caller already checks this, but stay correct standalone
  const [va, vb] = await Promise.all([embeddingFor(a), embeddingFor(b)])
  return cosineSimilarity(va, vb) >= THRESHOLD
}
