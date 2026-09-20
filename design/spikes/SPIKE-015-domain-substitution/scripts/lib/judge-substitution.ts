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
    "\"an\", singular/plural), and that each RELATIONSHIP in the substituted prose (e.g. an \"X",
    "beats Y\" clue) still connects the SAME positions in the value list as the corresponding",
    "relationship did in the original prose — only the value NAMES should differ, not which",
    "value plays which role in which clue.",
    "",
    "Do NOT judge a relationship by any real-world or common-sense meaning of the new value",
    "names (e.g. real-world rock-paper-scissors-lizard-spock rules, or any other domain",
    "knowledge about what the new words normally mean) — the puzzle's own clues are the ONLY",
    "source of truth for what beats what, is left of what, etc.; a substituted relationship is",
    "correct whenever it mirrors the original's relationship structure, however arbitrary it may",
    "seem. Do NOT attempt to solve the puzzle, and do not judge whether the new values are a",
    "\"better\" or \"more interesting\" choice — only whether the substitution itself was applied",
    "cleanly and consistently.",
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
 * well-posedness/solving distinction). Noisy on its own (SPIKE.md §5.5/§5.6 found
 * same-input-different-verdict cases) — prefer judgeSubstitutionMajority below for anything
 * whose result gets reported as a finding. */
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

export interface JudgeSubstitutionMajorityResult {
  /** undefined when every vote's call failed, OR when the successful votes tie with no strict
   * majority (possible when a failed vote leaves an even-sized pool, e.g. one failure out of
   * the default 3 leaving a 1-1 split) — see `error` in either case. Never silently resolved to
   * `false`. */
  readonly wellFormed: boolean | undefined
  /** Issues from the votes that agree with the majority verdict, deduplicated. */
  readonly issues: readonly string[]
  /** Sum of every vote's cost, including failed calls (a failed call may still be billed). */
  readonly costUsd: number
  /** Every successful vote's own verdict, for transparency/debugging a disagreement. */
  readonly votes: readonly { readonly wellFormed: boolean; readonly issues: readonly string[] }[]
  readonly ok: boolean
  readonly error?: string
}

/** Repeats judgeSubstitution `voteCount` times (in parallel — same cost either way) and takes a
 * strict majority verdict, to filter out the single-call noise SPIKE.md §5.5/§5.6 found
 * (byte-identical input scoring a different verdict from one call to the next). Defaults to 3
 * votes — odd, so no tie is possible at the default. A failed call is excluded from voting but
 * still counted in `costUsd`; if every call fails, `wellFormed` is undefined and `error` is set. */
export async function judgeSubstitutionMajority(
  model: string,
  originalProse: string,
  substitutedProse: string,
  mapping: readonly { readonly oldValue: string; readonly newValue: string }[],
  voteCount = 3,
): Promise<JudgeSubstitutionMajorityResult> {
  const results = await Promise.all(
    Array.from({ length: voteCount }, () => judgeSubstitution(model, originalProse, substitutedProse, mapping)),
  )
  const costUsd = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
  const successful = results.filter((r): r is JudgeSubstitutionResult & { judgment: SubstitutionJudgment } => r.ok && r.judgment !== undefined)

  if (successful.length === 0) {
    const errors = results.map((r) => r.error).filter((e): e is string => e !== undefined)
    return { wellFormed: undefined, issues: [], costUsd, votes: [], ok: false, error: errors.join("; ") || "all judge calls failed" }
  }

  const trueVotes = successful.filter((r) => r.judgment.wellFormed).length
  const votes = successful.map((r) => ({ wellFormed: r.judgment.wellFormed, issues: r.judgment.issues }))

  // A tie (even pool, exactly half true) has no strict majority — found live via review: with
  // the default 3 votes, one failed call leaves a 2-vote pool that can split 1-1, and
  // `trueVotes > successful.length / 2` would silently resolve that to `false`, misreporting a
  // genuine tie as a negative verdict. Report indeterminate instead of guessing.
  if (successful.length % 2 === 0 && trueVotes * 2 === successful.length) {
    return {
      wellFormed: undefined,
      issues: [],
      costUsd,
      votes,
      ok: false,
      error: `no strict majority: ${trueVotes}/${successful.length} votes said well-formed (a tie)`,
    }
  }

  const wellFormed = trueVotes > successful.length / 2
  const agreeing = successful.filter((r) => r.judgment.wellFormed === wellFormed)
  const issues = [...new Set(agreeing.flatMap((r) => r.judgment.issues))]

  return {
    wellFormed,
    issues,
    costUsd,
    votes,
    ok: true,
  }
}
