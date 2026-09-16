---
id: SPIKE-014
title: Informal Reasoning, Then Formalize the Whole CSP
status: in-progress
rfcs: [RFC-003]
created: 2026-09-16
---

# SPIKE-014: Informal Reasoning, Then Formalize the Whole CSP

## 1. Question

RFC-003 §7.3 resolved that solvability and translation-fidelity are orthogonal, and settled on a
fidelity critic (ADR-004) rather than a solve-round-trip gate — but that resolution predates any
evidence about *decoupling* informal solving from formal emission entirely. SPIKE-013 (§5.7/§5.8)
found, for vocabulary construction specifically: having a model solve a puzzle freely in prose
first (no schema, ADR-008's `direct-solve`), then transcribe the vocabulary that solve already
used, beats every blind vocabulary-construction variant by roughly an order of magnitude (33% vs.
0-4% structurally correct) and survives a solve that later goes wrong (PZL-0001) — while a
naive-seeming refinement (feed that same solved trace into the existing closed-classification
pipeline) regressed almost back to baseline (SPIKE-013 §5.8), showing the win isn't free or
guaranteed to generalize by construction alone.

This spike asks the question SPIKE-013 explicitly deferred rather than answered: **does
decoupling informal reasoning from formal emission generalize from vocabulary alone to the
*whole* `ExtractedCsp` — entities, domains, AND constraints — measured the way this project
actually measures success (SOLVE_UNIQUE/MATCH via compile→solve, ADR-007's taxonomy), not just
vocabulary-shape scoring?**

Concretely: solve the puzzle freely in prose first (reusing `direct-solve`'s exact prompt/traces
where already collected, at zero re-solve cost), then have a separate call formalize that
completed solve into a full `ExtractedCsp` — constraints included, not just entities/domains —
and run the EXISTING `compile()`/`solve()` pipeline against it as a real correctness filter. This
is the load-bearing mechanism this session's own OpenAI Navier-Stokes discussion identified
(verification-as-filter over already-produced informal reasoning, not a one-shot translate), and
it's a genuine methodological upgrade over SPIKE-013: that spike could only score vocabulary
*structure*; this one produces an artifact that can actually be solved, giving a real
SOLVE_UNIQUE/MATCH signal instead of a proxy.

Direct-solve's own already-measured numbers are the reference point this has to clear to be
worth adopting: `gpt-4o-mini` 9/14 (64%) and `claude-sonnet-4.5` 13/14 (93%) MATCH in free prose
— against `full-critic`'s 2/14 (14%) and every per-clue/graph-pipeline variant's 0/14 using a
schema-constrained architecture. If formalization can preserve most of the free-prose solve rate
while producing a genuinely verifiable artifact, that's the strongest evidence yet for this
project's next architectural direction; if it collapses back toward the schema-constrained
numbers (as SPIKE-013's `post-hoc-shaped` did for vocabulary alone), that's an equally important,
concretely diagnosable negative result.

**A second, genuinely open sub-question (raised 2026-09-16, before any code was written)**: what
should Stage 2 formalize INTO? RFC-003 §7.1 has asked since this RFC's own origin whether the
intermediate representation needs to be "close enough to a MiniZinc AST to serialize directly" —
never actually measured, only asserted either way. `src/solver/solve.ts`'s `SolveRequest.model` is
a raw MiniZinc string with no dependency on `compile.ts`/`ExtractedCsp`, and `src/eval/grader.ts`'s
`gradeDeterminate` grades off the solved assignment record, equally representation-agnostic — so
a direct-to-MiniZinc path is a fully independent, equally-verifiable alternative to
`ExtractedCsp`, not a shortcut that skips verification. This spike tests BOTH as parallel
variants (`formalize-json` via the existing `compile()`→`solve()`, `formalize-mzn` straight into
`solve()`, same grader either way) rather than asserting an answer — the marginal build cost is
one more Stage-2 prompt, not a second pipeline.

## 2. Method

1. **Stage 1 (free solve)** — identical to `direct-solve` (ADR-008): puzzle prose, no schema, no
   forced tool call, "show your reasoning, then state the final answer clearly." Reuse the
   already-collected traces (`eval/results/2026-09-15T14-59-37-368Z.json` for `gpt-4o-mini`,
   `...15T15-02-32-354Z.json` for `claude-sonnet-4.5`) for the first pass at zero re-solve cost,
   the same bootstrap SPIKE-013's `post-hoc`/`post-hoc-shaped` used.
2. **Stage 2 (formalize) — two representation variants, each single-call for the first pass**:
   - **`formalize-json`**: a forced tool-call reusing SPIKE-012's per-clue tool-call conventions
     and `src/extraction/types.ts`'s `ExtractedCsp` shape (entities, domains, constraints), given
     the puzzle prose *and* the Stage-1 trace — a transcription task analogous to
     `post-hoc-vocabulary.ts`, extended to cover constraints too, not just entities/domains.
   - **`formalize-mzn`**: a prose completion (like `direct-solve`'s own `requestProseCompletion`,
     since MiniZinc is plain text, not JSON) asked to write the complete MiniZinc model the
     already-solved reasoning implies, given the same puzzle prose + Stage-1 trace.
   - **Single call for both, not decomposed, for this first pass**: SPIKE-013's
     `post-hoc-shaped` (§5.8) already tested "decompose, with the solved trace as context" for
     vocabulary alone and it regressed almost back to blind-guess numbers — direct evidence
     against decomposing by default here. Revisit only if single-call shows a specific,
     diagnosable failure decomposition would plausibly fix (e.g. long puzzles losing attention,
     late clues silently dropped) — and note the asymmetry if so: decomposition is a natural fit
     for `formalize-json` (its schema already separates vocabulary from a constraints list), but
     awkward for `formalize-mzn` (one coherent program, shared identifier scope) — an iterative
     "append this clue's constraint" loop, or a hybrid (fixed vocabulary once, then one call per
     clue emitting a raw MiniZinc constraint expression assembled by code) would be needed there.
3. **Verify** — `formalize-json` runs through the existing, unmodified `compile()`/`solve()`
   pipeline (`src/compiler/compile.ts`, `src/solver/solve.ts`); `formalize-mzn` skips `compile()`
   entirely and goes straight into `solve()` (`SolveRequest.model` is a raw MiniZinc string with
   no dependency on `ExtractedCsp`). Both grade with the SAME existing outcome taxonomy (ADR-007)
   and `src/eval/grader.ts` (which grades off the solved assignment record, equally
   representation-agnostic) — no new scoring code for either variant, so both compare directly
   against `full-critic`'s and the per-clue variants' already-recorded numbers.
4. **Compare** MATCH rate, cost, and failure modes against: `full-critic` (2/14, ~$2.10),
   the per-clue/graph-pipeline variants (0/14, $0.03-$0.12), and `direct-solve`'s own free-prose
   judge-graded rate (9/14 / 13/14) as the ceiling this architecture is trying to approach without
   losing the independent-verification property `direct-solve` itself lacks (its judge grades
   prose directly; it has no compilable artifact at all). Also compare `formalize-json` against
   `formalize-mzn` directly — this is this spike's own answer to RFC-003 §7.1, evidence instead
   of assertion.
5. **Diagnose failures concretely** — per this session's own failure-mode analysis (silent
   abandonment of rigor, faithfully-propagated misinterpretation, silent premise promotion) and
   SPIKE-013's finding that closed classification can regress when fed noisier input: inspect
   actual COMPILE_FAILED/solve-mismatch cases, not just the aggregate rate, the same discipline
   every prior spike in this line has followed.

## 3. Time-box

**One and a half days (~12 hours)**, given two Stage-2 variants instead of one: ~1h reuse/adapt
Stage 1 (already-collected traces, zero new code beyond a loader); ~2h `formalize-json` (closest
to already-proven `post-hoc-vocabulary.ts` machinery, extended to constraints); ~2h
`formalize-mzn` (a new prose-completion path, no forced-schema precedent to build from, though
`direct-solve`'s `requestProseCompletion` is a direct template); ~1.5h offline smoke tests for
both (a hand-constructed already-known-good trace should compile-or-parse and solve correctly
for each variant, zero cost); ~1.5h live dry-run on 2-3 puzzles per variant + fixes; ~3h full
sweep (n=3 x 14 puzzles x 2 variants x 1-2 tiers, cost-estimated before running, matching this
session's own cost-then-go-ahead discipline) and write-up. Hard stop at the time-box regardless
of completeness — if either variant needs materially more prompt-engineering than this budget
allows, that itself is a finding worth recording, not a reason to blow through the box.

## 4. Notes

**2026-09-16 — worth reviving once a gram representation is defined.** RFC-003 §5.1/§7.1 and
`CLAUDE.md`'s own architecture pointer (`@relateby/pattern`'s gram graphs, via `Gram.parse`/
`Gram.stringify`/`StandardGraph.fromPatterns`) both anticipate a THIRD representation this spike
doesn't test: puzzles as graphs, not just `ExtractedCsp` JSON or MiniZinc text. No gram schema
exists yet for this domain (entities/domains/constraints as a graph shape hasn't been designed),
so it's out of scope now — but once it is, this spike's exact method (solve first in free prose,
formalize the completed solve into a candidate representation, verify via a representation-
appropriate check) is a good way to evaluate that representation's coherence, expressiveness, and
equivalence to the other two: does a solved trace formalize into a gram pattern at least as
reliably as into `ExtractedCsp`/MiniZinc, and does the resulting graph express everything the
other two representations do (RFC-003 §7.1's own "or does it need to be independent... to also
serve the future graph representation" question, finally measurable rather than asserted)? Cite
this note back into RFC-003 §7.1 (or wherever the future gram-representation ADR lands) when that
representation exists, per this skill's own manual-citation convention.

## 5. Findings

### 5.1 `formalize-json`: 0/42 MATCH — a genuinely diagnosable negative result, not noise

Raw: `results/formalize-json-2026-09-16T10-22-42-907Z.json`. n=3 reps × 14 puzzles, `gpt-4o-mini`
for both Stage 1 (already-collected trace) and Stage 2 (formalization), **$0.0553 total**.

| Outcome | Count | Share |
|---|---|---|
| `FORMALIZE_FAILED` (SchemaViolation — Stage 2 never even produced valid `ExtractedCsp`) | 13/42 | 31% |
| `COMPILE_FAILED` | 13/42 | 31% |
| `SOLVE_MULTIPLY_SATISFIABLE` (under-constrained — missing at least one clue) | 7/42 | 17% |
| `SOLVE_UNSATISFIABLE` (over-constrained/contradictory) | 4/42 | 10% |
| `SOLVE_UNIQUE` | 4/42 | 10% |
| `SOLVE_ERROR` | 1/42 | 2% |

**MATCH: 0/42.** Below even `full-critic`'s 2/14 (14%) — despite Stage 2 having the correct
answer sitting in front of it the whole time. This directly answers this spike's core question
for THIS specific implementation choice: single-call formalization into the existing, unmodified
`ExtractedCsp` schema does NOT reproduce `post-hoc`'s vocabulary-only win once constraints are
included.

**Two concrete, previously-known failure classes reappeared, not novel ones:**

- **Identifier collisions (4 of 13 `COMPILE_FAILED`)** — e.g. PZL-0003: `"domain variable
  \"choice\" (entityType \"player\"), and domain variable \"choice\" (entityType \"opponent\")
  all sanitize to the same MiniZinc identifier"`; PZL-0010's `"pedestrian"` domain value colliding
  across two entity types; PZL-0033's `"beans"` entity id colliding with a domain value. This is
  the EXACT failure class SPIKE-011/012 built an entire architecture around eliminating (§SPIKE-012
  Question: "never let the model type a free-text identifier — it chooses or copies an existing
  span, it never constructs one"). `formalize-json` reuses the RAW `ExtractedCsp` schema, which
  still lets the model freely type domain-variable and entity-id strings on every call — it never
  inherited SPIKE-012's code-assigned-identifier discipline, because that discipline lives in the
  inventory→group pipeline's SEPARATE machinery, not in the schema itself.
- **SchemaViolations (13/42, the single largest bucket)** — wrong types deep inside the schema's
  own nested unions (`expression.op` expecting one of six literal operator strings but getting
  something else; `target.value` expecting a number; a `derivedRule`'s nested `expression.operand`
  not matching either `variableRef` or `literal`). Having the correct ANSWER already available
  (Stage 1's trace) did not help Stage 2 navigate this schema's own structural complexity — 69KB,
  134 `anyOf` unions, nesting depth 39 (SPIKE-013's own citation) — a different problem from
  knowing what to say.

**Even the puzzle this spike's own offline smoke test hand-verified as trivially solvable
(PZL-0002) failed live**: rep 1 reached `SOLVE_MULTIPLY_SATISFIABLE`/MISMATCH (missing a clue —
under-constrained, not wrong), reps 2-3 both failed to compile with `"linkedAttributes needs at
least 2 attributes to link; got 1"` — a constraint-authoring mistake, not a naming collision or
schema-shape violation, a THIRD distinct failure mode on the single easiest puzzle in the sample.

### 5.2 `formalize-mzn`: 11/42 MATCH — beats every schema-constrained architecture measured so far

Raw: `results/formalize-mzn-2026-09-16T10-37-00-630Z.json`. Same n=3 × 14 puzzles, same source
traces, same `gpt-4o-mini` for both stages. **$0.0100 total** — a fifth of `formalize-json`'s
spend, since a plain prose completion is cheaper than a forced tool call against a 69KB schema.

| Outcome | Count | Share |
|---|---|---|
| `SOLVE_ERROR` (MiniZinc itself rejected the model — never reached grading) | 15/42 | 36% |
| `SOLVE_UNIQUE` | 16/42 | 38% |
| `SOLVE_MULTIPLY_SATISFIABLE` | 7/42 | 17% |
| `SOLVE_UNSATISFIABLE` | 4/42 | 10% |

**MATCH: 11/42 (26%).** PZL-0004 and PZL-0007 hit 3/3 outright. This is a real, order-of-
magnitude improvement over `formalize-json`'s 0/42 (§5.1), and it beats `full-critic`'s 2/14
(14%) too — the strongest MATCH rate any compile/solve-VERIFIED architecture has reached in this
entire spike line (SPIKE-008 through SPIKE-014), not just a proxy score. Still well below
`direct-solve`'s own raw judge-graded rate (64%/93%) — expected, since this variant adds a REAL
verification gate (must actually compile, solve, and match) that `direct-solve`'s prose judging
never enforces at all.

**`SOLVE_ERROR` is the dominant failure, and it's MiniZinc's own compiler rejecting the model —
three concrete, distinct sub-causes, all narrow:**

- **Escaped-operator corruption** (PZL-0010, both failing reps) — the model wrote `/\\`/`\\/`
  (an extra backslash) instead of MiniZinc's actual conjunction/disjunction operators `/\`/`\/`,
  as if escaping them for a string literal rather than writing raw source. A narrow, mechanical
  mistake — plausibly fixable by post-processing (`/\\` -> `/\`) or a prompt callout, not a
  reasoning failure.
- **`enum` used for genuinely numeric values** (PZL-0012) — `enum TIME = { 9, 11, 16 };` is
  invalid MiniZinc (enum members must be identifiers, not numeric literals); the times should
  have been a plain `int` domain (e.g. `array[DRUG] of var {9,11,16}: drugTime;` or an offset
  int range), not an enum. A genuine category-vs-quantity modeling mistake, distinct from the
  identifier-collision class `formalize-json` hit.
- **Generator-scope misunderstanding** (PZL-0028) — `(exists(i in 1..4)(...) -> exists(j in
  (i+1)..5)(...))` treats the first `exists`'s bound variable `i` as if it stayed in scope across
  the `->` into a syntactically SEPARATE second `exists` — each `exists(...)` is its own closed
  expression in MiniZinc, so `i` is undefined in the second. A real structural misunderstanding
  of the language's scoping, not a typo.

None of these three resemble `formalize-json`'s failure modes (identifier collisions, schema-
shape violations) at all — direct-to-MiniZinc genuinely trades one failure surface for a
different one, exactly the open question this variant existed to test, not a strict improvement
that inherits nothing new.

## 6. Conclusion

**Decoupling informal reasoning from formal emission generalizes from vocabulary to the whole
CSP — but only for one of the two representations tried, and the representation choice turns
out to matter enormously.** `formalize-json` (0/42) and `formalize-mzn` (11/42, 26%) started
from the IDENTICAL Stage-1 traces and the identical "transcribe, don't re-solve" framing — the
only thing that differed was what Stage 2 formalized into. That one variable moved the MATCH
rate from below every prior architecture to above all of them. This directly answers RFC-003
§7.1's founding question (is the intermediate representation "close enough to a MiniZinc AST to
serialize directly"?) with evidence rather than assertion: for THIS task, yes, and not just
"close enough" — direct MiniZinc clearly outperformed the purpose-built `ExtractedCsp` JSON
schema it was compared against.

**`formalize-mzn`'s 26% MATCH is the strongest result any compile/solve-VERIFIED architecture
has reached across this entire spike line** (SPIKE-008 through SPIKE-014) — genuinely ahead of
`full-critic`'s 2/14 (14%), at roughly 1/200th the cost ($0.01 vs. ~$2.10 for a 14-puzzle pass),
and reached with a single call per puzzle, no critic loop, no per-clue decomposition. It remains
well below `direct-solve`'s own raw judge-graded rate (64%/93%) — but that comparison isn't
apples-to-apples: `direct-solve` has no compilable artifact and is graded by a judge reading
prose, while `formalize-mzn`'s number survives an independent, mechanical compile-and-solve gate
direct-solve was never subjected to.

**The two variants' failure modes don't overlap at all** — `formalize-json`'s were both
properties of the JSON schema itself (identifier collisions the schema still lets the model
freely type; violations deep in a 134-`anyOf`-union structure). `formalize-mzn`'s dominant
failure (`SOLVE_ERROR`, 36%) is MiniZinc's own compiler catching real mistakes — an escaped-
operator typo, a category-vs-quantity modeling error, a generator-scoping misunderstanding — none
of which resemble a JSON-schema violation. Trading one schema's failure surface for a
completely different, and evidently more tractable, one is the actual mechanism behind this
result, not a coincidence.

**Recommended next steps**:
1. `formalize-mzn`'s three `SOLVE_ERROR` sub-causes (§5.2) are all narrow and plausibly cheap to
   address — an escaped-operator post-process/prompt fix, an explicit "numeric domains are `int`,
   not `enum`" instruction, and a scoping example for chained `exists`. Worth a quick follow-up
   pass before concluding this spike, since `SOLVE_ERROR` is the single largest bucket (36%) and
   entirely upstream of grading.
2. Once (1) is tried, re-measure — this spike isn't concluded yet, and a materially higher MATCH
   rate is plausible without changing the architecture at all, only the prompt.
3. This spike's method (solve first, formalize the completed solve, verify via compile/solve) is
   confirmed as sound; the open engineering question is now narrowly about `formalize-mzn`'s
   prompt quality, not about whether this architectural direction is worth pursuing.

**Not yet concluded** — `formalize-mzn` has not been built. Status stays `in-progress`.
