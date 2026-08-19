import { Data } from "effect"

// ADR-005 §2.3/§2.4: raised for an unrecognized adjacency relation name or an
// unrecognized/ambiguous DerivedCondition shape — fail-loud per RFC-003 Goal 4, never a
// silent best-effort guess. Independent of src/extraction/types.ts's ExtractionError — this is
// a rendering-stage failure, not a trust-gate failure (ADR-004 §4 / ADR-005 §4).
export class CompileError extends Data.TaggedError("CompileError")<{
  readonly reason: string
}> {}
