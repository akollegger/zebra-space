// SPIKE-015 §2 step 2: the forced structured-completion schema for domain identification and
// substitution. The model sees ONLY raw puzzle prose (never a domain list) and must name one
// domain, report its own complete current value set, and propose a same-arity replacement value
// per current value. Mirrors src/extraction/types.ts's ExtractedVocabulary/Domain style exactly.

import { Schema } from "effect"
import { toProviderSchema } from "../../../../../src/extraction/types.ts"

export const DomainMappingProposal = Schema.Struct({
  domain: Schema.String.annotate({
    description:
      "The name of ONE domain you found in the puzzle prose — a closed set of interchangeable " +
      "named values (e.g. \"color\", \"animal\"), never the entity axis itself (e.g. not " +
      "\"house\") and never a number/quantity (e.g. not \"age\" or \"time\").",
  }),
  currentValues: Schema.Array(Schema.String).annotate({
    description:
      "The COMPLETE current value set for that domain, exactly as it appears in the prose — " +
      "every value, none invented, none omitted.",
  }),
  mapping: Schema.Array(
    Schema.Struct({
      oldValue: Schema.String,
      newValue: Schema.String,
    }),
  ).annotate({
    description:
      "One entry per value in currentValues, each proposing a same-arity, same-kind " +
      "replacement value (e.g. colors -> other colors or another closed named category, " +
      "never colors -> numbers).",
  }),
}).annotate({
  description:
    "One domain identified from puzzle prose alone (no domain list given), its complete " +
    "current value set as you extracted it, and a proposed replacement value for each current " +
    "value.",
})
export type DomainMappingProposal = Schema.Schema.Type<typeof DomainMappingProposal>

export const domainMappingProposalJsonSchema = toProviderSchema(DomainMappingProposal)
