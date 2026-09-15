// SPIKE-013 §2 step 3: an `inventory.ts`-shaped alternative with NO LLM call at all —
// wink-nlp's POS tagger enumerates every NOUN/PROPN/NUM/ADJ token as a candidate span. This is
// a much better fit for `inventory`'s actual job (list every candidate mention, no typing yet)
// than SPIKE-002's harder job (recognize a specific CLUE SHAPE via hand-authored custom-entity
// patterns, which hit real friction — hyphenated compounds crashing registration, no voice
// generalization). Confirmed live (2026-09-15) that colors/attribute-values tag as ADJ, not
// NOUN — "red"/"green" — so the POS filter must include ADJ or it silently drops every color
// word, exactly the class of catalog vocabulary this stage exists to enumerate.
//
// Deliberately single-token spans only (no noun-chunk merging) — this spike's time-box; a
// multi-word span like "red house" would need either wink-nlp's own (previously brittle, per
// SPIKE-002) custom-entity patterns or hand-rolled bigram merging, neither attempted here. Where
// this matters is named directly in Findings, not silently absorbed.

import winkNLP, { type ItemToken } from "wink-nlp"
import model from "wink-eng-lite-web-model"
import type { InventoryResult } from "../../../SPIKE-012-graph-shaped-per-clue-pipeline/scripts/lib/inventory.ts"

const nlp = winkNLP(model)
const its = nlp.its

const CANDIDATE_POS = new Set(["NOUN", "PROPN", "NUM", "ADJ"])

export function extractChunkedInventory(prose: string): InventoryResult {
  const doc = nlp.readDoc(prose)
  const seen = new Set<string>()
  const mentions: string[] = []
  doc.tokens().each((t: ItemToken) => {
    const pos = t.out(its.pos)
    if (!CANDIDATE_POS.has(pos)) return
    const text = t.out()
    const key = text.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    mentions.push(text)
  })
  // Deterministic, local — no LLM call, so no cost and nothing to reject (every token IS a
  // literal substring of the prose by construction, unlike inventory.ts's LLM-produced spans,
  // which need runtime validation against the source text).
  return { mentions, rejected: [], costUsd: undefined, calls: 0 }
}
