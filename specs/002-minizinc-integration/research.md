# Research: MiniZinc Solver Integration

All findings below are from hands-on testing against the actual local toolchain
(`minizinc` 2.9.7, installed via Homebrew), not just documentation — several correct real
gaps in ADR-002's assumptions.

## Finding 1: Gecode is not registered out of the box on this dev machine

**Discovery**: `minizinc --solvers` initially listed only MIP solvers (COIN-BC, CPLEX, Gurobi,
HiGHS, SCIP, Xpress) — no Gecode, despite Homebrew's `minizinc` formula declaring `gecode` as a
required dependency (confirmed via `brew info minizinc`). Running any model with no solver
selected failed with `Error: configuration error: no solver with tag org.gecode.gecode found`.

**Root cause**: the Gecode Homebrew formula builds `fzn-gecode` and installs Gecode's `mznlib`
(global-constraint redefinitions), but does not register a MiniZinc solver configuration
(`.msc`) file anywhere MiniZinc's driver searches by default.

**Fix**: `minizinc --config-dirs` reports a per-user solver directory
(`~/.minizinc/solvers`). Placing a `gecode.msc` there — pointing `executable` at the installed
`fzn-gecode` binary and `mznlib` at Gecode's installed mznlib path — registers it correctly;
`minizinc --solvers` then lists Gecode as the default solver.

**Decision**: this project's setup/quickstart docs must include this registration step (or a
setup script that performs it) as a prerequisite — it is not automatic on at least this
Homebrew-based setup, and is likely to trip up other contributors' environments too. This is new
information beyond what ADR-002 assumed ("ships bundled... no extra install step") — worth
flagging back to that ADR, though it doesn't change the ADR's core decision (Gecode is still the
right default; it just needs an explicit registration step this project should document/automate,
not a manual one-off per environment).

## Finding 2: unsatisfiable is a *successful* run (exit code 0), not a failure

**Discovery**: tested a deliberately unsatisfiable model. `minizinc` exited **0** and printed
`=====UNSATISFIABLE=====` to stdout (plus, in this case, a compile-time warning to stderr, which
does not always appear — unsatisfiability found only during search produces no such warning).

**Contrast**: genuine failures (a model syntax error, an unknown `--solver` id) both exit **1**
with an `Error:` message.

**Decision**: FR-002's 0/1/2 classification must be determined by **parsing stdout**, not by
branching on exit code. Exit code 0 covers both "solution(s) found" and "provably no solution" —
the distinguishing signal is the literal `=====UNSATISFIABLE=====` marker versus one or more
JSON solution objects (each followed by a `----------` separator). Only a non-zero exit code
indicates a real failure (FR-006).

## Finding 3: `-n <k>` + `--output-mode json` work exactly as ADR-002 committed to, once Gecode is registered

Confirmed directly: `minizinc -n 2 --output-mode json <model>` against a model with exactly one
solution returns one JSON object; against a model with more than one, returns exactly 2 JSON
objects (each `{ "var": value, ... }`, separated by `----------`) without searching further.
This validates ADR-002 §2.4's core mechanism — no changes needed there.

## Finding 4: ADR-002 §2.5 mis-attributes the `all_different`/`alldifferent` example to PZL-0004

**Discovery**: while preparing to hand-translate an example, re-examined PZL-0004 (Whodunit)'s
actual clue structure (three independent categories — suspect, weapon, room — narrowed by direct
elimination clues like "the culprit is not Colonel Mustard"). This needs only simple `!=`
comparisons; it has no "these values must all differ from each other" relationship, so it does
not exercise `all_different` at all.

**Correction**: PZL-0006 (Four Queens — "no two queens share a column") is catalog's actual
`all_different` example. ADR-002 §2.5's citation should be corrected to reference PZL-0006 (or
PZL-0001, which also needs it across each attribute category) instead of PZL-0004.

**Impact on this feature**: none — this feature's seed example (FR-008) doesn't require
`all_different`, so Whodunit (per spec.md's Assumptions) remains a fine, simple first choice.
Recommend raising the ADR-002 correction as a follow-up edit, separate from this spec's scope.

## Decision: seed example is PZL-0004 (Whodunit)

Confirmed compatible with the toolchain as tested: 3 independent variables (`culprit`, `weapon`,
`room`), each an enumerated 3-value domain, narrowed by 6 direct exclusion clues — translates
directly to MiniZinc `var` declarations with an inline domain and `constraint x != Y` statements,
no global constraints needed. Solvable with the registered Gecode solver using the same
`-n 2 --output-mode json` invocation this feature commits to.

## Finding 5: a fully-exhausted search under `-n <k>` appends a `==========` marker

**Discovery**: when `-n 2` is requested but the model only has 1 solution, MiniZinc prints the
solution, a `----------` separator, and then a bare `==========` line — its "search complete"
marker — instead of stopping right after the one solution. Naively splitting stdout on
`----------` and parsing every non-empty chunk as JSON throws on that marker chunk.

**Fix**: `src/solver/parse.ts`'s `classifySolutions` explicitly filters out a chunk that equals
`==========` before attempting to parse it as JSON. Caught by this feature's own test suite
(SC-002 failed with a misleading `UnexpectedExit` until fixed) — a good argument for keeping
`@effect/platform`'s dependency swap (see tasks.md T001) and this parsing edge case both
documented here rather than only in commit history.

## Finding 6: enum-typed variables are wrapped as `{"e": "Name"}` in JSON output, not a bare string

**Discovery**: `catalog/mzn/PZL-0004-whodunit.mzn` declares `culprit`/`weapon`/`room` as MiniZinc
`enum` types (for readability — `Plum` instead of an opaque `1..3` int). Their
`--output-mode json` values come back as `{"e": "Plum"}`, not the bare string `"Plum"`.

**Impact**: `data-model.md`'s `Assignment = Record<string, JsonValue>` still holds — a nested
object is valid JSON — but a consumer comparing an enum-backed assignment value against a plain
string needs to know to unwrap `.e` first. Not fixed generically in `parse.ts` (that would be
guessing at a schema this feature doesn't own); `tests/solver/catalog-examples.test.ts` (T013)
compares against the wrapped shape directly, and this is noted here for whoever builds the
compiler that generates enum-typed models going forward.

## Decision: temp file naming and cleanup

Node's `node:fs/promises` `mkdtemp` (using `os.tmpdir()` as the prefix base) creates a
per-invocation temp directory; the `.mzn` (and optional `.dzn`) are written inside it, and the
whole directory is removed (`rm(..., { recursive: true })`) in an Effect `ensuring`/`finally`
equivalent after the subprocess completes — covers both success and failure paths per FR-005,
without needing manual per-file cleanup bookkeeping.
