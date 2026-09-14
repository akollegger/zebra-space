// SPIKE-008 sub-question 5, the back-translation critic's LLM half: judge "does this rendered
// sentence match this one clue" — NL-vs-NL, one clue at a time — rather than today's whole-
// document JSON-vs-prose fidelity critique (extract.ts's critiqueOnce). Can run on a different,
// cheaper model than the extractor; this spike keeps it same-tier for a controlled comparison.

import { requestClueTool } from "./tool-call.ts"

const JUDGMENT_SCHEMA = {
  type: "object",
  properties: {
    accepted: { type: "boolean" },
    issue: { type: "string", description: "Present only when accepted is false: what's wrong." },
  },
  required: ["accepted"],
  additionalProperties: false,
} as const

export interface BackTranslationJudgment {
  readonly accepted: boolean
  readonly issue: string | undefined
  readonly costUsd: number | undefined
}

const SYSTEM_PROMPT =
  "You are checking whether one rendered sentence is a faithful paraphrase of one puzzle clue " +
  "— same meaning, nothing added, nothing dropped, nothing reversed (e.g. \"before\" vs " +
  "\"after\", \"more\" vs \"less\"). Judge only this one clue against this one sentence, not the " +
  "puzzle as a whole."

export async function judgeBackTranslation(
  model: string,
  clueText: string,
  renderedSentences: readonly string[],
): Promise<BackTranslationJudgment> {
  const userPrompt = `Clue:\n\n${clueText}\n\nRendered as:\n${renderedSentences.map((s) => `- ${s}`).join("\n")}`
  const result = await requestClueTool({
    model,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    schemaName: "BackTranslationJudgment",
    jsonSchema: JUDGMENT_SCHEMA,
  })
  if (!result.ok) {
    // A judging call that itself fails structurally is treated as "accepted" (fail open) rather
    // than blocking assembly on a critic malfunction — logged via costUsd/accepted:true so the
    // comparison can still see it happened.
    return { accepted: true, issue: `judge call failed (${result.reason}): ${result.detail}`, costUsd: result.costUsd }
  }
  const value = result.value as { accepted: boolean; issue?: string }
  return { accepted: value.accepted, issue: value.issue, costUsd: result.costUsd }
}
