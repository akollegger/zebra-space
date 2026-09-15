// SPIKE-013: local sentence embeddings via @huggingface/transformers (transformers.js), fully
// offline after a one-time model download — no API key, no per-call cost, the same property
// SPIKE-003 confirmed for GLiNER2. Model: Xenova/all-MiniLM-L6-v2 (384-dim, mean-pooled,
// L2-normalized) — confirmed live (2026-09-15) to cleanly separate this catalog's own
// categories: within-category cosine similarity 0.66-0.87, cross-category 0.28-0.41 (see
// SPIKE.md §4). Requires `onnxruntime-node` pinned to 1.23.0 in this spike's own package.json
// (1.24.x dropped darwin/x64 prebuilt bindings — see SPIKE.md §4 for the full diagnosis).

import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers"

let extractorPromise: Promise<FeatureExtractionPipeline> | undefined

function getExtractor(): Promise<FeatureExtractionPipeline> {
  extractorPromise ??= pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2")
  return extractorPromise
}

/** Embeds a batch of strings in one call — cheaper than one call per string, and this spike
 * only ever needs to embed a puzzle's own small inventory (well under 30 items) at a time. */
export async function embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
  if (texts.length === 0) return []
  const extractor = await getExtractor()
  const output = await extractor([...texts], { pooling: "mean", normalize: true })
  return output.tolist() as readonly (readonly number[])[]
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!
  return dot
}
