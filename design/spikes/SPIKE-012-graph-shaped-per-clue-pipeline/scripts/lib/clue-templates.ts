// SPIKE-012 §2 step 5: a small, fixed set of plain-English clue templates, distinct from
// `clue-schema.ts`'s raw per-`ExtractedConstraint`-kind generation only in how they're OFFERED —
// the underlying nine kinds and their per-domain-scoped, entity-scoped schemas are reused
// UNCHANGED (`generateClueTools`, imported below) rather than rebuilt from scratch, since
// SPIKE-008's own entity-scoping fix already solved the "which entity/value is valid here" part
// of this problem; what SPIKE-012 changes is splitting "which kind does this clue need" from
// "fill that kind's slots" into two separate forced-tool calls (per-clue-typed.ts), rather than
// offering all nine kinds at once with `tool_choice: "auto"` — directly testing SPIKE-008's own
// diagnosed risk ("one call per clue offers all nine tools, not a hand-picked one").

import { generateClueTools, type Vocabulary } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/clue-schema.ts"

export const TEMPLATE_IDS = [
  "assignment",
  "linkedAttributes",
  "allDifferent",
  "adjacency",
  "relation",
  "arithmetic",
  "ruleTable",
  "ruleTableConstraint",
  "derivedRule",
  "noConstraint",
] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

/** Plain-English description of each template, shown to the model for classification only —
 * the actual slot-filling schema (step 6) is generated fresh from the fixed vocabulary and never
 * repeats this prose. */
export const TEMPLATE_DESCRIPTIONS: Record<TemplateId, string> = {
  assignment: 'A specific, already-known entity\'s value is fixed directly (e.g. "the first house is red", an ordinal, or a directly-named entity).',
  linkedAttributes: 'Attribute co-occurrence with NO entity named (e.g. "the Englishman lives in the red house") — positive facts only, never negation.',
  allDifferent: "Every entity of some type must have a distinct value for one attribute (rarely stated explicitly as its own clue; usually implied by the puzzle's own setup rather than one numbered clue).",
  adjacency: 'A positional/ordering relation between two entities (e.g. "immediately right of", "next to", "directly before").',
  relation: 'A bare named fact between two entities, consumed by a separate conditional rule clue (e.g. "X and Y share a border") — rare; only use when a LATER clue says "whenever this relation holds, then...".',
  arithmetic: 'A numeric/threshold comparison, OR an exclusion/negation ("X is not Y" is `arithmetic` with comparator "!=", not a separate negation kind), OR one entity\'s value compared to another\'s.',
  ruleTable: 'One fact in a small, closed, static rule between VALUES, not entities (e.g. "paper beats rock") — paired with a `ruleTableConstraint` elsewhere.',
  ruleTableConstraint: 'Requires two values (or entities\' values) to satisfy a previously-declared `ruleTable` (e.g. "you must play a move that beats the opponent\'s last move").',
  derivedRule: 'A conditional rule ("if/whenever X, then Y") applied across entities or values.',
  noConstraint: "This clue asserts NO constraint at all — pure scenario setup, flavor text, or the puzzle's closing question.",
}

const CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    template: { type: "string", enum: [...TEMPLATE_IDS] },
  },
  required: ["template"],
  additionalProperties: false,
} as const

export function classifySystemPrompt(preamble: string): string {
  const listed = TEMPLATE_IDS.map((id) => `- "${id}": ${TEMPLATE_DESCRIPTIONS[id]}`).join("\n")
  return (
    "You are deciding which ONE template a single puzzle clue instantiates — pick exactly one, " +
    "do not fill in any details yet.\n\n" +
    `Scenario: ${preamble}\n\n` +
    `Templates:\n${listed}`
  )
}

export function classifyJsonSchema(): Record<string, unknown> {
  return CLASSIFY_SCHEMA
}

/**
 * The tool name(s) `generateClueTools` produces for one template id — `assignment` and
 * `linkedAttributes` are split into one tool PER domain/entityType (clue-schema.ts's own
 * OpenAI-top-level-anyOf workaround), so this returns every tool whose name matches that
 * template's prefix, letting `requestClueConstraints`'s `tool_choice: "auto"` pick the right
 * one among them — never re-opening the "which kind" question step 6's classify call already
 * closed.
 */
export function toolsForTemplate(templateId: TemplateId, allTools: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  if (templateId === "noConstraint") return {}
  const prefix = templateId === "assignment" || templateId === "linkedAttributes" ? `${templateId}__` : templateId
  return Object.fromEntries(Object.entries(allTools).filter(([name]) => name === prefix || name.startsWith(prefix)))
}

export function generateToolsForVocabulary(vocab: Vocabulary): Record<string, Record<string, unknown>> {
  return generateClueTools(vocab)
}
