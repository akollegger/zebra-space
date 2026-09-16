// SPIKE-014 §2 step 7 (4th variant, added 2026-09-16 after §5.5 diagnosed WHY
// `formalize-mzn+oracle-repair`'s recovery rate was so low): a linter-shaped repair instead of a
// whole-file-regeneration repair. §5.5's own finding: asking the model to "produce a CORRECTED,
// COMPLETE MiniZinc model" is the SAME unconstrained generative task as the original
// formalization, just with a hint appended — nothing protects the parts that were already
// correct, which is exactly why repair sometimes fixed the hinted issue while leaving (or
// introducing) a different one untouched.
//
// This splits repair into two narrower steps:
// 1. LINT — same problem description as oracle-repair's hint, but the model returns STRUCTURED
//    FINDINGS (a forced tool call), each an exact, verbatim snippet of the CURRENT draft that
//    needs to change, why, and its exact replacement — never a rewritten file.
// 2. APPLY — each finding is applied as an exact-match string replacement, IN CODE, not by
//    asking the model to write the file again. Mirrors the Edit tool's own contract: a `locate`
//    that doesn't match the draft EXACTLY ONCE is skipped (recorded, never guessed), so
//    everything outside a matched region stays byte-for-byte untouched.

import { requestClueTool } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/tool-call.ts"

const LINT_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          locate: {
            type: "string",
            description:
              "An EXACT, VERBATIM substring of the CURRENT MiniZinc model below — copy it character-for-character, including whitespace. Must occur only where you intend to fix it. Keep it as SHORT as possible while still uniquely identifying the spot (e.g. one constraint line or a short clause) — never the whole file, and never a full copy of an unrelated section.",
          },
          issue: { type: "string", description: "What's wrong with this specific part of the model." },
          suggestedFix: {
            type: "string",
            description: "The exact replacement text for the located snippet ONLY — not a rewrite of anything else in the model.",
          },
        },
        required: ["locate", "issue", "suggestedFix"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
} as const

function lintSystemPrompt(): string {
  return [
    "You previously formalized a logic puzzle's worked solution as a MiniZinc model, but the",
    "model has a problem. You are given the puzzle, the worked solution, your previous MiniZinc",
    "model, and the SPECIFIC problem observed when it was compiled/solved.",
    "",
    "Do NOT rewrite the model. Instead, identify one or more SPECIFIC, LOCALIZED findings, each",
    "an exact snippet of the CURRENT model that needs to change, why, and its exact replacement.",
    "",
    "Common causes, matched to what you're told went wrong:",
    "- A compile error usually means a syntax mistake (see MiniZinc's own error message below) or",
    "  an identifier reused across two different things (MiniZinc's identifier and enum-member",
    "  namespaces are GLOBAL).",
    "- NO solution (UNSATISFIABLE) usually means a constraint is too strict, wrong, or directly",
    "  contradicts another constraint you wrote for an overlapping clue.",
    "- MULTIPLE solutions, when this puzzle should have exactly one, usually means something the",
    "  puzzle states was omitted or under-encoded — check especially for a missing",
    "  `alldifferent` where the puzzle implies every entity gets a distinct value, and for a",
    "  compound relational clue (an ordering or pairing across several things, or a quantifier",
    "  like `exists`/`forall`) where only PART of the relationship — or the wrong quantifier",
    "  (e.g. `exists` where `forall` was actually needed to bind EVERY case, not just one) — was",
    "  encoded.",
  ].join("\n")
}

function lintUserPrompt(prose: string, trace: string, previousMzn: string, problem: string): string {
  return [
    `Puzzle:\n\n${prose}`,
    `Worked solution:\n\n${trace}`,
    `Current MiniZinc model:\n\n${previousMzn}`,
    `Observed problem:\n\n${problem}`,
  ].join("\n\n")
}

export interface LintFinding {
  readonly locate: string
  readonly issue: string
  readonly suggestedFix: string
}

export interface LintResult {
  readonly findings: readonly LintFinding[]
  readonly costUsd: number | undefined
  readonly ok: boolean
  readonly error?: string
}

/** One forced-tool-call: given the puzzle, trace, current draft, and the specific problem
 * observed, return STRUCTURED FINDINGS — never a rewritten file. */
export async function lintMinizinc(model: string, prose: string, trace: string, previousMzn: string, problem: string): Promise<LintResult> {
  const result = await requestClueTool({
    model,
    systemPrompt: lintSystemPrompt(),
    userPrompt: lintUserPrompt(prose, trace, previousMzn, problem),
    schemaName: "lint_minizinc",
    jsonSchema: LINT_SCHEMA,
  })
  if (!result.ok) return { findings: [], costUsd: result.costUsd, ok: false, error: `${result.reason}: ${result.detail}` }
  const value = result.value as { findings: readonly LintFinding[] }
  return { findings: value.findings, costUsd: result.costUsd, ok: true }
}

export interface ApplyResult {
  readonly mzn: string
  readonly applied: number
  readonly skipped: readonly { readonly locate: string; readonly reason: string }[]
}

/** Applies each finding as an exact-match replacement, sequentially — a later finding's `locate`
 * is checked against the draft AS ALREADY PATCHED by earlier findings in this same batch, the
 * same way applying several edits in one session would compound. Mirrors the Edit tool's own
 * safety contract: `locate` must occur exactly once in the CURRENT draft, or the finding is
 * skipped (recorded, never guessed) — never a partial or fuzzy match. */
export function applyFindings(mzn: string, findings: readonly LintFinding[]): ApplyResult {
  let draft = mzn
  let applied = 0
  const skipped: { locate: string; reason: string }[] = []
  for (const finding of findings) {
    const occurrences = draft.split(finding.locate).length - 1
    if (occurrences === 0) {
      skipped.push({ locate: finding.locate, reason: "not found in current draft" })
      continue
    }
    if (occurrences > 1) {
      skipped.push({ locate: finding.locate, reason: `matched ${occurrences} times, not unique` })
      continue
    }
    draft = draft.replace(finding.locate, finding.suggestedFix)
    applied += 1
  }
  return { mzn: draft, applied, skipped }
}
