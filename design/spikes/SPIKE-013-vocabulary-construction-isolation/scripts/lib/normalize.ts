// Shared string normalization for SPIKE-013's own scoring and clustering — reuses the real
// compiler's own sanitizeIdentifier (never a second, potentially-drifting copy — SPIKE-011 §4
// already found the cost of two independent sanitizers disagreeing) plus a case-fold, since
// unlike compile.ts's own identifier-emission use, comparing MODEL-produced names against
// ground truth needs to treat "color"/"Color" as equal — a gap SPIKE-011 §4 also found in the
// real grader (`normalizeToken`) and flagged as a follow-up, not yet fixed there. Applying it
// here, in this spike's own throwaway scoring code, doesn't fix that follow-up — it only means
// this spike's own numbers aren't skewed by the same casing artifact while that fix is pending.

import { sanitizeIdentifier } from "../../../../../src/compiler/compile.ts"

export function normalize(s: string): string {
  return sanitizeIdentifier(s).toLowerCase()
}

export function normalizeSet(values: readonly string[]): ReadonlySet<string> {
  return new Set(values.map(normalize))
}
