# Contract: Solve

This is the one interface this feature exposes to the rest of the project (the future
graph-to-`.mzn` compiler, and any other future caller). Describes the calling contract, not the
implementation — see `plan.md`/`data-model.md` for how it's built.

## Shape

A single operation: given a Solve Request (data-model.md), produce an `Effect` that resolves to
either a Solve Result or fails with a Solver Error — never throws, never returns `null`/`undefined`
in place of a real result (constitution Principle II, Effect-Idiomatic Code).

```text
solve: (request: SolveRequest) => Effect<SolveResult, SolverError>
```

## Guarantees

- **Never leaves temp files behind** (SC-005), regardless of whether the Effect resolves or
  fails.
- **Never waits longer than necessary to classify uniqueness** — resolves as soon as either 0,
  1, or 2 solutions are known (FR-002); never performs full enumeration.
- **Assignment keys are the model's own variable names** (FR-004) — a caller never has to
  correlate anonymous positions back to meaning.
- **Distinguishes "no solution" from "solve failed"** — `Unsatisfiable` is a member of Solve
  Result (a normal, successful outcome), not a Solver Error (research.md Finding 2).

## Non-guarantees (explicitly out of scope for this contract)

- Does not validate that a submitted model is a "good" or "well-formed" puzzle — that's the
  caller's concern (e.g. a future compiler validating its own output before submitting it here).
- Does not translate a puzzle's prose or graph representation into a model — the caller supplies
  already-written MiniZinc source (RFC-002 Non-Goal 2; ADR-002 Context).
- Does not persist results anywhere — a caller that wants to record a result (e.g. into
  `specs/001-catalog-seeding/answer-keys.md`-style records) does so itself.
