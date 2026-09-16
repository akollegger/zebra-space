// SPIKE-013 §2 step 4: a `group.ts`-shaped alternative with NO LLM call — embed every
// inventory mention (embeddings.ts, local, zero-network after the one-time model download),
// then a single-linkage greedy merge over cosine similarity: a mention joins the first existing
// group with which ANY current member exceeds the threshold; otherwise it starts a new group.
// Deliberately NOT a general clustering library (k-means, DBSCAN) — this session's own earlier
// reasoning holds: group sizes in this catalog are small enough (well under 30 items per
// puzzle) that a ~15-line hand-rolled merge is more transparent and testable than tuning
// hyperparameters for an algorithm built for much larger datasets.
//
// Same threshold as semantic-match.ts (0.6) for the same reason — 2026-09-15's direct
// measurement (SPIKE.md §4) found within-category similarity 0.66-0.87 and cross-category
// 0.28-0.41 on this catalog's own vocabulary, so 0.6 sits cleanly inside that gap without
// needing a second, independently-tuned constant.

import { embedBatch, cosineSimilarity } from "./embeddings.ts"
import type { InventoryGroup, GroupResult } from "../../../SPIKE-012-graph-shaped-per-clue-pipeline/scripts/lib/group.ts"

const THRESHOLD = 0.6

interface WorkingGroup {
  label: string
  memberIndices: number[]
  memberVectors: (readonly number[])[]
}

export async function extractEmbeddedGroups(inventory: readonly string[]): Promise<GroupResult> {
  if (inventory.length === 0) return { groups: [], costUsd: undefined, calls: 0 }
  const vectors = await embedBatch(inventory)

  const working: WorkingGroup[] = []
  inventory.forEach((text, index) => {
    const vec = vectors[index]!
    let best: { group: WorkingGroup; sim: number } | undefined
    for (const g of working) {
      const sim = Math.max(...g.memberVectors.map((v) => cosineSimilarity(v, vec)))
      if (sim >= THRESHOLD && (best === undefined || sim > best.sim)) best = { group: g, sim }
    }
    if (best !== undefined) {
      best.group.memberIndices.push(index)
      best.group.memberVectors.push(vec)
    } else {
      working.push({ label: text, memberIndices: [index], memberVectors: [vec] })
    }
  })

  const groups: InventoryGroup[] = working.map((g) => ({ label: g.label, memberIndices: g.memberIndices }))
  // Local, deterministic (given the same model weights) — no LLM call, no cost. One "call"
  // recorded for the batch embedding request, for parity with the other variants' call
  // counting, even though it's free and local.
  return { groups, costUsd: undefined, calls: 1 }
}
