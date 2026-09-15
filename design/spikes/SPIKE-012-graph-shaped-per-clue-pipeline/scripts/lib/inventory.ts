// SPIKE-012 §2 step 2: list every named thing mentioned in the puzzle prose, as LITERAL SPANS
// copied verbatim — no types, no ids, no grouping yet. This is the single most reliably-
// executable operation this design offers a model (SPIKE-011 §5.3's own reasoning: "the model
// chooses or copies; it never constructs"), and it's the first half of what closes SPIKE-009's
// entire identifier-collision failure surface by construction: nothing downstream ever asks the
// model to TYPE an identifier again, only to point at one of these spans by index (group.ts).

import { requestClueTool } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/tool-call.ts"

const INVENTORY_SCHEMA = {
  type: "object",
  properties: {
    mentions: {
      type: "array",
      items: { type: "string" },
      description: "Every named thing mentioned in the puzzle — people, places, objects, attribute values, numbers, categories. One entry per distinct thing; copy the exact words used in the prose, do not paraphrase or normalize case/spelling.",
    },
  },
  required: ["mentions"],
  additionalProperties: false,
} as const

const SYSTEM_PROMPT =
  "You are listing every named thing mentioned in a natural-language logic puzzle, as literal " +
  "spans copied verbatim from the text — not summarized, not typed, not categorized. Include " +
  "people, places, objects, attribute values (colors, numbers, days, etc.), and any other named " +
  "entity a clue could reference. Do not group them, do not invent anything not in the prose, " +
  "and do not normalize spelling or case — copy exactly what the text says, even if the same " +
  "thing is mentioned more than once in slightly different words (list it once, using its " +
  "clearest mention)."

export interface InventoryResult {
  /** Every accepted mention, in the order the model returned them — group.ts refers to these
   * by their index in THIS array, never by re-typing the text. */
  readonly mentions: readonly string[]
  /** Mentions the model returned that were rejected (not a literal substring of the prose) —
   * kept for diagnostics, never included in `mentions`. */
  readonly rejected: readonly string[]
  readonly costUsd: number | undefined
  readonly calls: number
}

/** Every accepted mention must be a literal, case-sensitive substring of the prose — the
 * structural guarantee this stage exists to provide. Whitespace is normalized (collapsed runs,
 * trimmed) before the containment check only, since a model may reflow line-wrapped prose when
 * copying a span that itself spans a line break; the ORIGINAL (unnormalized) mention text is
 * still what's kept and returned, so downstream stages see the model's actual output. */
function isLiteralSubstring(prose: string, mention: string): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim()
  return normalize(prose).includes(normalize(mention))
}

async function requestMentions(model: string, prose: string, extraHint: string): Promise<{ readonly mentions: readonly string[]; readonly costUsd: number | undefined }> {
  const result = await requestClueTool({
    model,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `Puzzle:\n\n${prose}${extraHint}`,
    schemaName: "list_mentions",
    jsonSchema: INVENTORY_SCHEMA,
  })
  if (!result.ok) return { mentions: [], costUsd: result.costUsd }
  const value = result.value as { mentions?: unknown }
  const mentions = Array.isArray(value.mentions) ? value.mentions.filter((m): m is string => typeof m === "string") : []
  return { mentions, costUsd: result.costUsd }
}

/**
 * One forced-tool call over the whole prose (not per-clue — span-copying doesn't need clue
 * isolation, and one call keeps this stage's cost floor at 1). Any returned span that isn't a
 * literal substring is dropped and the call retried ONCE with those specific rejects named, then
 * whatever survives (from either round) is returned — this stage never blocks the pipeline on a
 * stubborn hallucinated span; it just excludes it, the same "reject and move on" posture
 * SPIKE-008's per-clue repair round already established.
 */
export async function extractInventory(model: string, prose: string): Promise<InventoryResult> {
  let totalCost = 0
  let anyCost = false
  const addCost = (c: number | undefined) => {
    if (c !== undefined) {
      totalCost += c
      anyCost = true
    }
  }

  const first = await requestMentions(model, prose, "")
  addCost(first.costUsd)
  let calls = 1
  const accepted = new Set<string>()
  const rejected: string[] = []
  for (const m of first.mentions) {
    if (isLiteralSubstring(prose, m)) accepted.add(m)
    else rejected.push(m)
  }

  if (rejected.length > 0) {
    const hint =
      `\n\nYour previous list included spans that don't appear verbatim in the puzzle text: ` +
      `${rejected.map((r) => `"${r}"`).join(", ")}. List only exact substrings of the puzzle text above.`
    const retry = await requestMentions(model, prose, hint)
    addCost(retry.costUsd)
    calls += 1
    const stillRejected: string[] = []
    for (const m of retry.mentions) {
      if (isLiteralSubstring(prose, m)) accepted.add(m)
      else stillRejected.push(m)
    }
    return { mentions: [...accepted], rejected: stillRejected, costUsd: anyCost ? totalCost : undefined, calls }
  }

  return { mentions: [...accepted], rejected: [], costUsd: anyCost ? totalCost : undefined, calls }
}
