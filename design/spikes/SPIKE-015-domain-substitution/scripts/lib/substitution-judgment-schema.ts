// SPIKE-015 §2 step 5 (revised 2026-09-18, replacing the direct-mzn verifier — see SPIKE.md
// §5.5): the forced structured-completion schema for a critic/LLM-as-judge check of whether a
// mechanical prose substitution produced a well-formed puzzle. This judges well-posedness
// (grammar, agreement, leftover artifacts, same logical structure) — never whether the puzzle is
// solvable or what its answer is, per ADR-007/RFC-003 §7.3's established distinction between
// well-posedness and solving/translation correctness. Mirrors mapping-schema.ts's style exactly.

import { Schema } from "effect"
import { toProviderSchema } from "../../../../../src/extraction/types.ts"

export const SubstitutionJudgment = Schema.Struct({
  wellFormed: Schema.Boolean.annotate({
    description:
      "True iff the SUBSTITUTED prose is a grammatically correct, unambiguous statement of the " +
      "same puzzle as the ORIGINAL — every old value fully replaced by its mapped new value, no " +
      "leftover fragment of an old value, correct grammar/agreement (e.g. \"a\"/\"an\") around " +
      "every replaced value, and the same clues/logical structure as the original (only the " +
      "domain's value NAMES differ). False if any of that is violated.",
  }),
  issues: Schema.Array(Schema.String).annotate({
    description: "Concrete problems found (quote the offending text), empty when wellFormed is true.",
  }),
}).annotate({
  description: "A critic's judgment of whether a mechanical value substitution produced a well-formed puzzle.",
})
export type SubstitutionJudgment = Schema.Schema.Type<typeof SubstitutionJudgment>

export const substitutionJudgmentJsonSchema = toProviderSchema(SubstitutionJudgment)
