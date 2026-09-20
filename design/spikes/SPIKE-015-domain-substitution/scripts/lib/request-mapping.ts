// SPIKE-015 §2 step 2: the LLM call. The model sees ONLY raw puzzle prose — never a domain list,
// never the answer key, never the .mzn file. It identifies ONE domain and proposes a same-arity
// remapping. Mirrors SPIKE-014's formalize-json.ts pattern exactly: Effect.map/Effect.catch
// convert the whole failure channel into a success-shaped result before Effect.runPromise, so a
// plain async script function can await without try/catch on tagged errors.

import { Effect } from "effect"
import { requestStructuredCompletion } from "../../../../../src/extraction/provider.ts"
import type { ProviderError, SchemaRejected, SchemaViolation } from "../../../../../src/extraction/types.ts"
import { DomainMappingProposal, domainMappingProposalJsonSchema } from "./mapping-schema.ts"

function systemPrompt(): string {
  return [
    "You are given a logic puzzle. Read ONLY the prose below — no domain list, no answer key,",
    "no other context is available to you, and none should be assumed.",
    "",
    "Identify exactly ONE domain used in the puzzle: a closed set of interchangeable NAMED",
    "values (e.g. colors, animals, professions) that the puzzle assigns to entities or",
    "positions. Do NOT pick the entity axis itself (e.g. the houses/positions/days something",
    "is assigned TO) and do NOT pick a NUMBER or quantity (a time, a count, a score, an",
    "amount) even if its values look like labels (e.g. clock times) — a domain qualifies only",
    "if its values are genuinely interchangeable names with no arithmetic or ordering relationship",
    "between them.",
    "",
    "Report that domain's COMPLETE current value set exactly as the prose states it — every",
    "value used, none invented, none left out. Then propose ONE replacement value per current",
    "value: same arity (exactly as many new values as old), same kind (e.g. colors -> other",
    "colors, or another closed named category like drinks — never colors -> numbers, and never",
    "collapsing two different old values onto the same new value).",
  ].join("\n")
}

function userPrompt(prose: string): string {
  return `Puzzle:\n\n${prose}`
}

export interface RequestMappingResult {
  readonly proposal: DomainMappingProposal | undefined
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

/** One call: given ONLY raw puzzle prose, identify one domain and propose a same-arity
 * remapping. Mirrors formalize-json.ts's Effect.catch-before-runPromise pattern. */
export async function requestDomainMapping(model: string, prose: string): Promise<RequestMappingResult> {
  const attempt = await Effect.runPromise(
    requestStructuredCompletion({
      model,
      systemPrompt: systemPrompt(),
      userPrompt: userPrompt(prose),
      schemaName: "DomainMappingProposal",
      jsonSchema: domainMappingProposalJsonSchema,
      schema: DomainMappingProposal,
    }).pipe(
      Effect.map((result): RequestMappingResult => ({ proposal: result.value, costUsd: result.costUsd, ok: true })),
      Effect.catch((e) =>
        Effect.succeed<RequestMappingResult>({ proposal: undefined, costUsd: e.costUsd, ok: false, error: `${e._tag}: ${errorDetail(e)}` }),
      ),
    ),
  )
  return attempt
}
