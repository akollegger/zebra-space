// SPIKE-015 §2 step 5 (revised — see SPIKE.md §5.5): the critic call, replacing the direct-mzn
// verifier. Given the ORIGINAL prose, the SUBSTITUTED prose, and the mapping that produced it,
// judges whether the substitution is well-formed — never asked to solve anything. Mirrors
// request-mapping.ts's Effect.map/Effect.catch-before-runPromise pattern exactly.

import { Effect } from "effect"
import { requestStructuredCompletion } from "../../../../../src/extraction/provider.ts"
import type { ProviderError, SchemaRejected, SchemaViolation } from "../../../../../src/extraction/types.ts"
import { SubstitutionJudgment, substitutionJudgmentJsonSchema } from "./substitution-judgment-schema.ts"

function systemPrompt(): string {
  return [
    "You are checking whether a mechanical find-and-replace substitution on a logic puzzle's",
    "prose produced a well-formed result. You will see the ORIGINAL prose, the SUBSTITUTED",
    "prose (every occurrence of each old value replaced by its mapped new value), and the",
    "MAPPING itself.",
    "",
    "Judge ONLY well-formedness: every old value fully replaced (no leftover fragment of an old",
    "value anywhere), correct grammar and agreement around each replaced value (e.g. \"a\" vs",
    "\"an\", singular/plural), and the same clues and logical structure as the original — only",
    "the domain's value NAMES should differ. Do NOT attempt to solve the puzzle, and do not",
    "judge whether the new values are a \"better\" or \"more interesting\" choice — only whether",
    "the substitution itself was applied cleanly.",
  ].join("\n")
}

function userPrompt(originalProse: string, substitutedProse: string, mapping: readonly { readonly oldValue: string; readonly newValue: string }[]): string {
  const mappingLines = mapping.map((m) => `- "${m.oldValue}" -> "${m.newValue}"`).join("\n")
  return `Mapping applied:\n${mappingLines}\n\nOriginal prose:\n\n${originalProse}\n\nSubstituted prose:\n\n${substitutedProse}`
}

export interface JudgeSubstitutionResult {
  readonly judgment: SubstitutionJudgment | undefined
  readonly costUsd: number | undefined
  readonly ok: boolean
  readonly error?: string
}

function errorDetail(e: ProviderError | SchemaRejected | SchemaViolation): string {
  switch (e._tag) {
    case "ProviderError":
      return e.message
    case "SchemaRejected":
      return e.providerMessage
    case "SchemaViolation":
      return e.detail
  }
}

/** One critic call: judges whether a mechanical prose substitution is well-formed. Never solves
 * the puzzle — see substitution-judgment-schema.ts's header for why (ADR-007/RFC-003 §7.3's
 * well-posedness/solving distinction). */
export async function judgeSubstitution(
  model: string,
  originalProse: string,
  substitutedProse: string,
  mapping: readonly { readonly oldValue: string; readonly newValue: string }[],
): Promise<JudgeSubstitutionResult> {
  const attempt = await Effect.runPromise(
    requestStructuredCompletion({
      model,
      systemPrompt: systemPrompt(),
      userPrompt: userPrompt(originalProse, substitutedProse, mapping),
      schemaName: "SubstitutionJudgment",
      jsonSchema: substitutionJudgmentJsonSchema,
      schema: SubstitutionJudgment,
    }).pipe(
      Effect.map((result): JudgeSubstitutionResult => ({ judgment: result.value, costUsd: result.costUsd, ok: true })),
      Effect.catch((e) =>
        Effect.succeed<JudgeSubstitutionResult>({ judgment: undefined, costUsd: e.costUsd, ok: false, error: `${e._tag}: ${errorDetail(e)}` }),
      ),
    ),
  )
  return attempt
}
