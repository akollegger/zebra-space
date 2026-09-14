// SPIKE-008 sub-question 5 (grounded revision): today's fidelity critic (extract.ts's
// critiqueOnce) judges JSON against prose with zero access to the compile/solve signal the
// harness already computes and discards — and the review that sharpened this spike found it
// has ~31% precision and never once caught a compile failure. This module uses the real
// compiler/solver to name a SPECIFIC likely-wrong clue when a per-clue-assembled ExtractedCsp
// is Unsatisfiable or MultiplySatisfiable, entirely offline (no LLM call) — the finding itself
// costs nothing; only feeding it back as a revision prompt (in per-clue-extract.ts's repair
// path, not yet wired) would cost a call.
//
// Per-clue provenance (not available to a monolithic assembly) is what makes this tractable:
// each constraint is already tagged with the clue index that produced it (per-clue-extract.ts's
// `PerClueCallLog`), so "drop one clue's constraints, recompile, resolve" can point at a clue
// number directly, not just an opaque constraint array position.

import { Effect } from "effect"
import { compile } from "../../../../../src/compiler/compile.ts"
import { solve } from "../../../../../src/solver/solve.ts"
import type { ExtractedCsp, ExtractedConstraint } from "../../../../../src/extraction/types.ts"

export interface ClueTaggedConstraint {
  readonly clueIndex: number
  readonly constraint: ExtractedConstraint
}

export type GroundedFinding =
  | { readonly kind: "solved"; readonly detail: string }
  | { readonly kind: "compile-failed"; readonly reason: string }
  | {
      readonly kind: "unsatisfiable-conflict"
      /** Clue indices whose removal, one at a time, restored satisfiability — a clue in this
       * list is a plausible culprit, not a certainty (dropping any sufficiently-constraining
       * clue from an unsat model can restore satisfiability; this narrows the search space for
       * a revision prompt, it doesn't pinpoint the error). */
      readonly suspectClueIndices: readonly number[]
    }
  | {
      readonly kind: "underconstrained"
      /** Variables that differ between the two returned assignments — the ones a clue is
       * missing to pin down. */
      readonly underconstrainedVariables: readonly string[]
    }

function assignmentsDiffer(a: Record<string, unknown>, b: Record<string, unknown>): readonly string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const differing: string[] = []
  for (const key of keys) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) differing.push(key)
  }
  return differing
}

/**
 * Compiles and solves the fully-assembled CSP; on Unsatisfiable, drops one clue's constraints
 * at a time (bounded — this sample tops out around 14 clues, so at most 14 extra compile+solve
 * round trips, all local and free) and checks which single-clue removal restores
 * satisfiability. On MultiplySatisfiable, reports which variables differ across the two
 * returned assignments (the ones some clue failed to pin down) rather than a clue index, since
 * under-constraint is a property of what's MISSING, not any one present clue.
 */
// Note: this pinned effect build (4.0.0-rc line) is missing Effect.either/Effect.fromEither
// (CLAUDE.md's dependency notes) — every fallible step below is caught with Effect.catch into
// a success-typed { ok, ... } variant instead, matching the rest of this codebase's own pattern
// (extract.ts, harness.ts) rather than reaching for combinators this pinned version lacks.

type CompileOutcome = { readonly ok: true; readonly mzn: string } | { readonly ok: false; readonly reason: string }

function compileSafely(csp: ExtractedCsp): Effect.Effect<CompileOutcome, never> {
  return compile(csp).pipe(
    Effect.map((mzn): CompileOutcome => ({ ok: true, mzn })),
    Effect.catch((error) => Effect.succeed<CompileOutcome>({ ok: false, reason: error.reason })),
  )
}

type SolveOutcome = { readonly ok: true; readonly result: import("../../../../../src/solver/types.ts").SolveResult } | { readonly ok: false }

function solveSafely(mzn: string): Effect.Effect<SolveOutcome, never> {
  return solve({ model: mzn }).pipe(
    Effect.map((result): SolveOutcome => ({ ok: true, result })),
    Effect.catch(() => Effect.succeed<SolveOutcome>({ ok: false })),
  )
}

export function groundedFinding(
  extractedCsp: ExtractedCsp,
  tagged: readonly ClueTaggedConstraint[],
): Effect.Effect<GroundedFinding, never> {
  return Effect.gen(function* () {
    const compiled = yield* compileSafely(extractedCsp)
    if (!compiled.ok) {
      return { kind: "compile-failed" as const, reason: compiled.reason }
    }
    const solved = yield* solveSafely(compiled.mzn)
    if (!solved.ok) {
      return { kind: "solved" as const, detail: "solver failed to run (toolchain/timeout) — not a constraint-content finding" }
    }
    if (solved.result._tag === "UniquelySolvable") {
      return { kind: "solved" as const, detail: "uniquely solvable — no grounded revision signal to report" }
    }
    if (solved.result._tag === "MultiplySatisfiable") {
      const [a, b] = solved.result.assignments
      return { kind: "underconstrained" as const, underconstrainedVariables: assignmentsDiffer(a, b) }
    }

    // Unsatisfiable: drop one clue's constraints at a time and recheck.
    const clueIndices = [...new Set(tagged.map((t) => t.clueIndex))]
    const suspects: number[] = []
    for (const dropIndex of clueIndices) {
      const withoutClue: ExtractedCsp = {
        ...extractedCsp,
        constraints: tagged.filter((t) => t.clueIndex !== dropIndex).map((t) => t.constraint),
      }
      const recompiled = yield* compileSafely(withoutClue)
      if (!recompiled.ok) continue // dropping a clue can break a cross-reference — not a signal either way
      const resolved = yield* solveSafely(recompiled.mzn)
      if (resolved.ok && resolved.result._tag !== "Unsatisfiable") suspects.push(dropIndex)
    }
    return { kind: "unsatisfiable-conflict" as const, suspectClueIndices: suspects }
  })
}
