// SPIKE-014 §2 step 6 (3rd variant, added 2026-09-16 per §5.4/§6's own recommended next step):
// compile/solve as a REPAIR ORACLE, not a fidelity gate — RFC-003 §7.3's original framing, the
// same principle SPIKE-012's oracle-repair.ts already validated for the ExtractedCsp path.
//
// `formalize-mzn` has no per-clue tagging to localize a repair to — a single undifferentiated
// MiniZinc blob, unlike SPIKE-012's per-clue-tagged constraints (SPIKE-012's own
// clueIndicesTouchingError heuristic has no equivalent here). So this repair pass feeds back the
// WHOLE previous model plus the SPECIFIC solve-outcome signal, and asks for a corrected whole
// model — coarser than SPIKE-012's localization, but still targeted, not a blind re-ask.
//
// The three hint variants below restate SPIKE-014 §5.4's own diagnosed mechanisms (a silently
// dropped explicit global constraint, incomplete relational coverage, self-contradiction across
// restated constraints) as actionable repair guidance, since those are the concrete, observed
// causes of Unsatisfiable/MultiplySatisfiable on this catalog — not a generic "try again."

import { Effect } from "effect"
import { requestProseCompletion } from "../../../../../src/eval/direct-solve.ts"
import { extractMzn, normalizeEscapedOperators } from "./formalize-mzn.ts"

function repairSystemPrompt(): string {
  return [
    "You previously formalized a logic puzzle's worked solution as a MiniZinc model, but the",
    "model has a problem. You are given the puzzle, the worked solution, your previous MiniZinc",
    "model, and the SPECIFIC problem observed when it was compiled/solved. Produce a CORRECTED,",
    "COMPLETE MiniZinc model that fixes the problem — write the whole corrected model, not just a",
    "description of the fix. Preserve everything that was already correct; change only what the",
    "observed problem requires.",
    "",
    "Common causes, matched to what you're told went wrong:",
    "- A compile error usually means a syntax mistake (see MiniZinc's own error message below) or",
    "  an identifier reused across two different things (MiniZinc's identifier and enum-member",
    "  namespaces are GLOBAL).",
    "- NO solution (UNSATISFIABLE) usually means you included a constraint that is too strict,",
    "  wrong, or directly contradicts another constraint you wrote for an overlapping clue.",
    "- MULTIPLE solutions, when this puzzle should have exactly one, usually means you omitted",
    "  something the puzzle actually states — check especially for a missing `alldifferent`",
    "  where the puzzle implies every entity gets a distinct value (e.g. \"one X per Y\"), and for",
    "  a compound relational clue (an ordering or pairing across several things) where you may",
    "  have only captured PART of the relationships it implies, not all of them.",
    "",
    "Output ONLY the corrected MiniZinc source — no prose commentary before or after it.",
  ].join("\n")
}

function repairUserPrompt(prose: string, trace: string, previousMzn: string, problem: string): string {
  return [
    `Puzzle:\n\n${prose}`,
    `Worked solution:\n\n${trace}`,
    `Your previous MiniZinc model:\n\n${previousMzn}`,
    `Observed problem:\n\n${problem}`,
  ].join("\n\n")
}

export interface MznRepairResult {
  readonly mzn: string | undefined
  readonly costUsd: number | undefined
  readonly ok: boolean
  readonly error?: string
}

/** One repair call: given the puzzle prose, the solved trace, the previous (broken) MiniZinc
 * model, and a description of the SPECIFIC problem the solve oracle observed, produce a
 * corrected model. Mirrors formalize-mzn.ts's own Effect.catch-before-runPromise pattern. */
export async function repairMinizinc(model: string, prose: string, trace: string, previousMzn: string, problem: string): Promise<MznRepairResult> {
  const attempt = await Effect.runPromise(
    requestProseCompletion({
      model,
      systemPrompt: repairSystemPrompt(),
      userPrompt: repairUserPrompt(prose, trace, previousMzn, problem),
    }).pipe(
      Effect.map((result): MznRepairResult => ({ mzn: normalizeEscapedOperators(extractMzn(result.value)), costUsd: result.costUsd, ok: true })),
      Effect.catch((e) => Effect.succeed<MznRepairResult>({ mzn: undefined, costUsd: e.costUsd, ok: false, error: e.message })),
    ),
  )
  return attempt
}
