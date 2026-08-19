# Data Model: MiniZinc Solver Integration

## Solve Request

The input to a solve attempt.

| Field | Type | Notes |
|---|---|---|
| `model` | string | MiniZinc model source (`.mzn` content) |
| `data` | string \| undefined | Optional `.dzn` data content |
| `solverId` | string | Defaults to Gecode's solver tag (ADR-002 §2.2) |
| `timeoutMs` | number | Reasonable default (tens of seconds, spec.md Assumptions); not pinned by ADR-002 |

The `-n` solution count passed to `minizinc` is fixed at 2 per ADR-002 §2.4 — an internal
constant (`DEFAULT_MAX_SOLUTIONS`, `src/solver/solve.ts`), not a field on Solve Request at all,
since FR-002 makes this non-negotiable rather than merely defaulted.

## Solve Result

The classified outcome of a solve attempt (research.md Finding 2: determined by parsing stdout,
not exit code). A discriminated union:

| Variant | Carries | When |
|---|---|---|
| `Unsatisfiable` | nothing | stdout contains the `=====UNSATISFIABLE=====` marker |
| `UniquelySolvable` | one `assignment: Record<string, JsonValue>` | exactly one JSON solution object returned |
| `MultiplySatisfiable` | two `assignments: [Record<string, JsonValue>, Record<string, JsonValue>]` | exactly two JSON solution objects returned (search stopped at the cap, per FR-002) |

Each `assignment`'s keys are the model's own variable names (FR-004) — no anonymous indices.

## Solver Errors

Failures (FR-006) are a separate, typed error channel from Solve Result — a solve attempt either
resolves to a Solve Result or fails with one of these, modeled as Effect errors, not exceptions:

| Variant | When (research.md Finding 2) |
|---|---|
| `ToolchainUnavailable` | the `minizinc` executable can't be found/run |
| `ModelSyntaxError` | non-zero exit with a model/data parse error |
| `SolverConfigError` | non-zero exit due to an unresolvable `solverId` |
| `Timeout` | the subprocess is killed after `timeoutMs` elapses |
| `UnexpectedExit` | any other non-zero exit not covered above |
| `UnexpectedOutput` | `minizinc` exited successfully, but its stdout couldn't be classified (`parse.ts`) — a distinct failure mode from a non-zero exit, added after PR #4 review surfaced that this case was being misreported as `UnexpectedExit` with an empty `stderr` |
| `FilesystemError` | a local filesystem operation (creating or cleaning up the temp directory `solve()` stages content into) failed — unrelated to `minizinc` itself |

## Example Catalog Entry

One file under `catalog/mzn/` (ADR-002 §2.6).

| Field | Notes |
|---|---|
| File path | `catalog/mzn/PZL-NNNN-short-name.mzn`, mirroring the corresponding `catalog/puzzles/` entry's id and short name |
| Content | Plain MiniZinc source — variable declarations plus `constraint` statements, no frontmatter (unlike the puzzle catalog; this is code, not a puzzle document) |

**Relationship**: each Example Catalog Entry corresponds to exactly one `catalog/puzzles/` entry
(by shared `PZL-NNNN` id) — a hand-translation, not a generated artifact. This feature seeds
exactly one (`PZL-0004`, per research.md); further entries are follow-up work (ADR-002 §2.6).

## Relationships

- A Solve Request is submitted once per solve attempt; it produces either one Solve Result or
  one Solver Error, never both.
- An Example Catalog Entry's content, when submitted as a Solve Request's `model`, must produce
  a `UniquelySolvable` Solve Result whose `assignment` matches the corresponding catalog puzzle's
  entry in `eval/answer-keys.json` (FR-009, SC-004).
