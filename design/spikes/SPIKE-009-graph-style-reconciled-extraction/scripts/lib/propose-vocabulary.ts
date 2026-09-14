// SPIKE-009: per-clue vocabulary proposal — the local-extraction half of "local extract,
// neighborhood reconcile, filter". Unlike SPIKE-008's stage 1 (one global vocabulary call over
// the WHOLE prose before any clue is examined), this asks the model, per clue, only what THIS
// clue's own text implies about entities/domains — deliberately unscoped/free-text, since
// there's no global vocabulary yet to scope against. Reconciliation (reconcile.ts) is what
// turns these local, possibly-redundant, possibly-conflicting proposals into one canonical
// vocabulary.

import { requestClueTool } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/tool-call.ts"

export interface EntityMention {
  readonly surfaceForm: string
  readonly typeGuess: string
  /** Present only when this mention looks like a specific, nameable individual (e.g. "house1")
   * rather than a bare description the solver will bind existentially. */
  readonly canonicalIdGuess?: string
}

export interface DomainMention {
  readonly attributeNameGuess: string
  readonly entityTypeGuess: string
  readonly valueMentioned: string
  /** True for adjacency/positional clues ("directly left of", "immediately before") — the
   * signal reconcile.ts uses to synthesize a missing ordering domain (the PZL-0001 fix). */
  readonly isOrderingHint: boolean
}

export interface VocabularyProposal {
  readonly clueIndex: number
  readonly entityMentions: readonly EntityMention[]
  readonly domainMentions: readonly DomainMention[]
}

const PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    entityMentions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          surfaceForm: { type: "string", description: "The exact phrase this clue used, e.g. \"the red house\", \"Chesterfields\"." },
          typeGuess: { type: "string", description: "A short, stable type label for what kind of thing this is, e.g. \"house\", \"person\". Reuse a typeGuess from what you'd expect earlier clues to have used for the same kind of thing." },
          canonicalIdGuess: { type: "string", description: "A short stable id if this looks like a specific, nameable individual (e.g. \"house1\"); omit if this mention is really a VALUE of some attribute, not an entity." },
        },
        required: ["surfaceForm", "typeGuess"],
        additionalProperties: false,
      },
    },
    domainMentions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          attributeNameGuess: { type: "string", description: "e.g. \"color\", \"nationality\", \"arrival-order\"." },
          entityTypeGuess: { type: "string", description: "Which entity type this attribute is measured on." },
          valueMentioned: { type: "string", description: "The one value THIS clue asserts or references for that attribute, e.g. \"Red\", \"Norwegian\"." },
          isOrderingHint: { type: "boolean", description: "true if this clue's relation is positional/ordering (adjacency, 'before', 'after', 'left of', 'right of') — this attribute needs an entity-indexed, ordered domain, not a plain scalar or unordered one." },
        },
        required: ["attributeNameGuess", "entityTypeGuess", "valueMentioned", "isOrderingHint"],
        additionalProperties: false,
      },
    },
  },
  required: ["entityMentions", "domainMentions"],
  additionalProperties: false,
} as const

const SYSTEM_PROMPT =
  "You are proposing candidate vocabulary (entities and attribute domains) implied by ONE " +
  "clue of a natural-language logic puzzle — you do NOT yet know the full puzzle's vocabulary, " +
  "so propose only what THIS clue's own text implies. Another process will reconcile your " +
  "proposal against every other clue's proposal afterward — you do not need to worry about " +
  "consistency with clues you haven't seen.\n\n" +
  "List every entity this clue mentions (entityMentions) and every attribute/value pairing it " +
  "asserts or references (domainMentions). A clue with no vocabulary content at all (pure " +
  "scenario setup, or a closing question) may propose empty arrays for both — that's a valid, " +
  "expected answer, not an error.\n\n" +
  "Set isOrderingHint true whenever this clue expresses a position or ordering relationship " +
  "between two entities (\"immediately right of\", \"directly before\", \"next to\") — this is " +
  "the single most important signal you can give: it tells the reconciliation step that this " +
  "attribute needs a shared, ordered domain to be meaningful, even if no other clue ever states " +
  "the entities' absolute positions directly."

/**
 * Uses requestClueTool's single-forced-tool call (the same mechanism back-translation-critic.ts
 * already uses) — the tool call itself is always made, but the schema allows BOTH arrays to be
 * empty, which is how a pure scenario-setup clue expresses "no vocabulary here" without needing
 * an "auto"/zero-tool-call path.
 */
export async function proposeVocabulary(model: string, clueIndex: number, clueText: string): Promise<{ readonly proposal: VocabularyProposal; readonly costUsd: number | undefined }> {
  const result = await requestClueTool({
    model,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `Clue:\n\n${clueText}`,
    schemaName: "proposeVocabulary",
    jsonSchema: PROPOSAL_SCHEMA,
  })
  if (!result.ok) {
    // A structurally-invalid or prose response is treated as "no vocabulary proposed" rather
    // than a hard failure — reconciliation still works fine with fewer proposals; the
    // constraint-extraction stage's own failure handling (unchanged from SPIKE-008) is what
    // actually gates correctness.
    return { proposal: { clueIndex, entityMentions: [], domainMentions: [] }, costUsd: result.costUsd }
  }
  const value = result.value as { entityMentions: EntityMention[]; domainMentions: DomainMention[] }
  return { proposal: { clueIndex, entityMentions: value.entityMentions, domainMentions: value.domainMentions }, costUsd: result.costUsd }
}
