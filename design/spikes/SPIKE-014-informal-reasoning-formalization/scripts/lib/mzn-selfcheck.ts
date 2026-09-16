// SPIKE-014 §2 step 8 (5th variant, added 2026-09-16 in response to "any hypothesis about how
// to close the [direct-solve vs. formalize-mzn] gap?"): neither `+oracle-repair` (§5.5) nor
// `+lint-repair` (§5.6) can even ATTEMPT a repair on a `SOLVE_UNIQUE`+`MISMATCH` rep — both only
// trigger on `SOLVE_ERROR`/`Unsatisfiable`/`MultiplySatisfiable`, because there is no ground
// truth at deployment time to detect a syntactically-fine-but-wrong unique solve. But there IS a
// cheap substitute for ground truth already sitting in the pipeline: Stage 1's own worked
// solution already states a candidate final answer. This variant adds ONE self-consistency
// check — does the SOLVED assignment match what Stage 1's own reasoning concluded? — that fires
// on `SOLVE_UNIQUE` specifically, the one outcome class every prior repair variant was blind to.
//
// A discrepancy is not proof of a WRONG answer (Stage 1 could be wrong instead of Stage 2) — it's
// a signal worth investigating, same epistemic status as `Unsatisfiable`/`MultiplySatisfiable`
// already have for the other repair variants. When they disagree, feed the discrepancy into the
// SAME lint-repair mechanism §5.6 already validated (structured findings, exact-match applied in
// code) rather than inventing a new apply mechanism — §5.6's own finding was that the surgical
// application half was never the bottleneck, only diagnosis was; this is a better diagnosis, not
// a new applicator.

import { requestClueTool } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/tool-call.ts"
import type { Assignment } from "../../../../../src/solver/types.ts"

const SELFCHECK_SCHEMA = {
  type: "object",
  properties: {
    consistent: {
      type: "boolean",
      description: "true if the solved assignment matches the conclusion your own worked solution above reached, false if they disagree on any value.",
    },
    discrepancy: {
      type: "string",
      description: "If NOT consistent: which value(s) differ and what your worked solution actually concluded for them. Empty string if consistent.",
    },
  },
  required: ["consistent", "discrepancy"],
  additionalProperties: false,
} as const

function systemPrompt(): string {
  return [
    "You are given a logic puzzle, a worked solution you already produced for it, and a solved",
    "assignment obtained by compiling and solving a MiniZinc model that was formalized FROM that",
    "same worked solution. Your ONLY job is to check: does the solved assignment match the final",
    "conclusion your own worked solution reached? Compare values, not variable names or",
    "formatting — the MiniZinc model may name things differently than your prose did.",
    "",
    "Do not re-solve the puzzle from scratch and do not judge the solved assignment against the",
    "puzzle itself — only check it against what YOUR OWN worked solution already concluded.",
  ].join("\n")
}

function userPrompt(prose: string, trace: string, assignment: Assignment): string {
  return [
    `Puzzle:\n\n${prose}`,
    `Your worked solution:\n\n${trace}`,
    `Solved assignment (from the MiniZinc model formalized from your worked solution):\n\n${JSON.stringify(assignment, null, 2)}`,
  ].join("\n\n")
}

export interface SelfCheckResult {
  readonly consistent: boolean
  readonly discrepancy: string
  readonly costUsd: number | undefined
  readonly ok: boolean
  readonly error?: string
}

/** One forced-tool-call: does the solved assignment match Stage 1's own stated conclusion? The
 * only signal in this spike's whole repair line that can fire on a `SOLVE_UNIQUE` rep — every
 * other repair variant (§5.5/§5.6) is blind to this outcome class entirely. */
export async function checkSelfConsistency(model: string, prose: string, trace: string, assignment: Assignment): Promise<SelfCheckResult> {
  const result = await requestClueTool({
    model,
    systemPrompt: systemPrompt(),
    userPrompt: userPrompt(prose, trace, assignment),
    schemaName: "check_self_consistency",
    jsonSchema: SELFCHECK_SCHEMA,
  })
  if (!result.ok) return { consistent: true, discrepancy: "", costUsd: result.costUsd, ok: false, error: `${result.reason}: ${result.detail}` }
  const value = result.value as { consistent: boolean; discrepancy: string }
  return { consistent: value.consistent, discrepancy: value.discrepancy, costUsd: result.costUsd, ok: true }
}
