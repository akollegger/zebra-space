// SPIKE-016 §2 sub-question 4: does Jev, asked as three separate decomposed Nouls, match
// SPIKE-015's judge-substitution.ts majority-of-3 FULL-LLM well-formedness verdict — at a
// fraction of the cost?
//
// Per docs.typesafe.ai/model-jaggedness/jev-1.13's "don't hide multiple judgments in one
// question": SPIKE-015's SubstitutionJudgment.wellFormed (substitution-judgment-schema.ts)
// bundles FOUR concerns into one boolean. A literal 1:1 swap (one Jev Noul reusing that same
// bundled criteria) would repeat exactly the anti-pattern the docs warn against, so this
// decomposes it into three separate Nouls (the schema's own four concerns collapse to three —
// "every old value fully replaced" and "no leftover fragment" are the same concern stated twice)
// and AND-gates them in code, mirroring how judge-substitution.ts's own file header describes
// the original bundled criteria verbatim.

import { type AskFn, ask } from "./jev-client.ts"

export interface MappingEntry {
  readonly oldValue: string
  readonly newValue: string
}

export interface DecomposedWellFormedResult {
  readonly wellFormed: boolean | undefined
  readonly noLeftoverOldValue: number | undefined
  readonly grammaticallyCorrect: number | undefined
  readonly sameLogicalStructure: number | undefined
  readonly latencyMs: number
  readonly error?: string
}

/** Three Nouls in one request (TypeSafe evaluates named questions over the same state in
 * parallel — see docs.typesafe.ai/concepts/how-to-build-with-system-one.md), AND-gated at 0.5
 * each into one `wellFormed` verdict. `askFn` is injectable for an offline smoke test. */
export async function judgeWellFormedDecomposed(
  originalProse: string,
  substitutedProse: string,
  // Optional: SPIKE-015's persisted results (design/spikes/SPIKE-015-.../scripts/results/*.json)
  // never recorded the mapping used to produce substitutedProse, only its OUTCOME — so a replay
  // against those already-collected fixtures has no mapping to pass. When absent, the questions
  // below ask Jev to identify what changed by comparing the two proses directly instead of
  // naming it explicitly (more indirection than giving the mapping, but the only option a replay
  // against this particular fixture gap allows — see SPIKE.md Notes).
  mapping: readonly MappingEntry[] = [],
  askFn: AskFn = ask,
): Promise<DecomposedWellFormedResult> {
  const state = {
    originalProse,
    substitutedProse,
    ...(mapping.length > 0 ? { mapping: mapping.map((m) => `"${m.oldValue}" -> "${m.newValue}"`) } : {}),
  }
  const response = await askFn(state, {
    noLeftoverOldValue: {
      type: "noul",
      instructions:
        "Comparing `originalProse` to `substitutedProse` (using `mapping` when given, otherwise " +
        "identifying the changed domain values yourself by comparing the two texts): is every " +
        "occurrence of each old value fully replaced by its new value in `substitutedProse`, with " +
        "no leftover fragment of any old value remaining anywhere in `substitutedProse`?",
      criteria: {
        true: "Every old-value occurrence was replaced; no fragment of an old value remains.",
        false: "At least one old-value occurrence was missed, or a fragment of an old value remains.",
      },
    },
    grammaticallyCorrect: {
      type: "noul",
      instructions:
        "Is `substitutedProse` grammatically correct around every replaced value — correct " +
        "article agreement (e.g. \"a\" vs \"an\") and singular/plural agreement wherever a " +
        "replacement value appears?",
      criteria: {
        true: "Grammar and agreement are correct around every replaced value.",
        false: "At least one replaced value creates a grammar or agreement error (e.g. wrong article, mismatched plurality).",
      },
    },
    sameLogicalStructure: {
      type: "noul",
      instructions:
        "Does `substitutedProse` express the SAME clues and logical structure as `originalProse` " +
        "— every relationship (e.g. an \"X beats Y\", \"X is next to Y\" clue) still connects the " +
        "SAME positions/roles as in the original, with only the domain's value NAMES differing?",
      criteria: {
        true: "Every clue's logical structure is preserved; only value names changed.",
        false: "At least one clue's structure changed, was dropped, or now connects different roles than the original.",
      },
    },
  })
  if (!response.ok) {
    return {
      wellFormed: undefined,
      noLeftoverOldValue: undefined,
      grammaticallyCorrect: undefined,
      sameLogicalStructure: undefined,
      latencyMs: response.latencyMs,
      error: response.error,
    }
  }
  const { noLeftoverOldValue, grammaticallyCorrect, sameLogicalStructure } = response.result.answers
  const wellFormed = noLeftoverOldValue.noul >= 0.5 && grammaticallyCorrect.noul >= 0.5 && sameLogicalStructure.noul >= 0.5
  return {
    wellFormed,
    noLeftoverOldValue: noLeftoverOldValue.noul,
    grammaticallyCorrect: grammaticallyCorrect.noul,
    sameLogicalStructure: sameLogicalStructure.noul,
    latencyMs: response.latencyMs,
  }
}
