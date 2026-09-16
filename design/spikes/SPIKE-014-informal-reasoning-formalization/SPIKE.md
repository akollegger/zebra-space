---
id: SPIKE-014
title: Informal Reasoning, Then Formalize the Whole CSP
status: done
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
6. **`formalize-mzn+oracle-repair` (3rd variant, added 2026-09-16, per §5.4/§6's own recommended
   next step)**: compile/solve as a REPAIR ORACLE, not a fidelity gate — RFC-003 §7.3's original
   framing, and the exact principle SPIKE-012's `oracle-repair.ts` already validated for the
   `ExtractedCsp` path. `formalize-mzn` has no per-clue tagging to localize a repair to (a single
   undifferentiated MiniZinc blob, unlike SPIKE-012's per-clue-tagged constraints) — this variant
   instead feeds back the WHOLE previous model plus the SPECIFIC solve-outcome signal (§5.4's own
   three diagnosed mechanisms restated as repair hints: a compile error, "no solution" pointing at
   an over-strict/contradictory constraint, "multiple solutions" pointing at a likely-missing
   `alldifferent` or an incompletely-covered relational clue) and asks for a corrected whole
   model. Bounded to ONE repair round per rep, matching SPIKE-008/012's own precedent for
   predictable cost. Repair triggers on `SOLVE_ERROR` always, or on
   `Unsatisfiable`/`MultiplySatisfiable` only when the puzzle's own answer-key entry declares it
   `determinate` (or omits `outcome`, which defaults to determinate) — other puzzle types
   (COP, ambiguous, non-problem, subjective) can legitimately be non-unique, so repair must not
   fire on solution-count alone without checking what the puzzle actually is.
7. **`formalize-mzn+lint-repair` (4th variant, added 2026-09-16, after §5.5 diagnosed WHY
   oracle-repair's recovery rate was so low)**: §5.5 found the whole-model-regeneration repair
   call is exposed to the same failure mode as the original formalization — it can fix what it's
   hinted at while silently breaking or leaving broken something else, since regenerating the
   entire file gives no guarantee the unaffected parts stay unaffected. This variant splits
   "repair" into two narrower steps instead of one broad one: (a) a LINT pass — same problem
   description as `oracle-repair`'s hint, but the model returns STRUCTURED FINDINGS
   (`{locate, issue, suggestedFix}[]`, a forced tool call) rather than a rewritten file, where
   `locate` must be an exact, verbatim substring of the CURRENT draft; (b) APPLY each finding as
   an exact-match string replacement, in CODE — not by asking the model to write the file again —
   mirroring the Edit tool's own contract: a `locate` that doesn't match the draft exactly once
   is skipped (recorded, never guessed), and everything outside a matched region is left
   byte-for-byte untouched. The draft is kept in-memory (an explicit string threaded through the
   pipeline, not re-derived each round) rather than materialized on disk — sufficient for what
   this variant measures, and simpler than standing up a real patch/diff library for a spike.
   Still bounded to ONE lint-then-apply round per rep, for direct comparison against
   `oracle-repair`'s own one-round bound.

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

**2026-09-16 — the user pushed on failure-mode characterization after the spike was already
`done`** ("syntactic problems are fixable, semantic ones will likely remain a challenge") —
re-inspected §5.3's raw result JSON specifically to check this against actual data rather than
answer in the abstract. Found the real axis is self-flagging vs. silent, not syntactic vs.
semantic, and — checked specifically, not assumed — zero of the 42 runs produced the dangerous
"confidently wrong, no signal" case, though that's an observation from a small sample, not a
guarantee (this session's own `direct-solve` work already found that exact failure mode is real
in free prose). Written up as §5.4.

**2026-09-16 — folded oracle-repair in as a 3rd variant**, per §5.4/§6's own recommended next
step: `formalize-mzn+oracle-repair`, adapting SPIKE-012's oracle-repair.ts principle (compile/
solve as a repair oracle, not a fidelity gate) to a flat MiniZinc blob with no per-clue tagging
to localize to. Live dry run on the two hardest known cases (PZL-0010, PZL-0038) first, at n=2:
repair reliably triggered and incorporated its hint (e.g. correctly added a missing
`alldifferent` when told to), but 0/4 recovered to MATCH — confirming the mechanism works before
committing to the full n=3×14 sweep. Full sweep: 12/42 MATCH vs. `formalize-mzn` alone's 13/42,
at 60% more cost — flat-to-slightly-worse, not an improvement. Written up as §5.5.

**2026-09-16 — the user pointed out oracle-repair wasn't actually a linter-shaped fix**: "this
isn't introducing a linter-like collection of actionable feedback with suggested remediation,
followed by targeted line-edits." Correct, and it explains §5.5's low recovery rate precisely —
full-file regeneration is exposed to the same failure mode as the original formalization call.
Proposed and built the split (lint → structured findings; apply → exact-match code-driven edits)
as a 4th variant, confirming in-memory draft (not a real on-disk file) was sufficient before
building. Verified `applyFindings` offline (5 checks: clean apply, untouched-region preservation,
non-unique-match skip, not-found skip, sequential multi-finding application) before spending
anything; a live dry run on the same two hardest puzzles showed the exact-match mechanism's own
failure boundary directly — the identical finding, resampled, sometimes reproduces the draft
byte-for-byte and sometimes doesn't. Full sweep: 12/42 MATCH, same as oracle-repair, at $0.0154 —
the surgical-application half of the redesign worked exactly as intended (14/18 findings applied
cleanly, confirmed never to touch untouched regions), but recovery to MATCH did not improve
(0/14), isolating the actual bottleneck as diagnostic accuracy, not application mechanics.
Written up as §5.6. (Also fixed a real document-structure bug found while writing this up: §5.3
had drifted to a physical position after "## 6. Conclusion" from an earlier edit, silently
breaking the section's logical order without erroring — reordered the whole file.)

**2026-09-16 — ran the one comparison §5.4-era analysis was missing: does `formalize-mzn` at
the FRONTIER tier (`claude-sonnet-4.5`, same tier as its own 93%-MATCH `direct-solve` traces)
show the same solve-vs-formalize asymmetry as `gpt-4o-mini`, or is the gap cheap-tier-specific?**
Raw run graded 9/42 (21%) — but manually re-solving and cross-checking every one of the 17
`SOLVE_UNIQUE`+`MISMATCH` cases against `eval/answer-keys.json` found all 17 were the puzzle's
actual correct answer under a spelling convention `src/eval/grader.ts`'s token normalization
couldn't bridge (PascalCase-merged vs. underscore-separated vs. ALL-CAPS — the model is free to
author a MiniZinc identifier however it likes, with no code-mediated step tying its spelling back
to the answer key's own literal string, unlike `ExtractedCsp`-based paths). This is a real grader
defect, not a `formalize-mzn`-specific one — see §5.7 for the fix, its blast radius across every
other spike/architecture in this project, and the corrected numbers for every affected result in
this spike (§5.2, §5.3, §5.5, §5.6 all shift up slightly; the qualitative conclusions do not).

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

> **Correction (2026-09-16, see §5.7):** regraded after fixing a grader token-normalization gap —
> **12/42 (29%)**, not 11/42 (PZL-0038 rep1 was actually correct, graded MISMATCH only because the
> model's identifier spelling didn't match the answer key's literal string). Table and prose below
> are the original run and left as the historical record §5.3 explicitly compares against.

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

### 5.3 The narrow fix worked, partially — 13/42 MATCH, `SOLVE_ERROR` down from 36% to 21%

> **Correction (2026-09-16, see §5.7):** regraded after fixing the same grader gap as §5.2 —
> **13/42 (31%), unchanged.** None of this run's `SOLVE_UNIQUE`+`MISMATCH` cases turned out to be
> a spelling-convention false negative, so this section's before/after table and every downstream
> comparison against it (§5.5, §5.6) needs only the "before" (§5.2) column corrected, not this one.

Applied all three targeted fixes from §5.2/§6's recommended next step: a mechanical
find-and-replace normalizing doubled escape-backslashes (`/\\`→`/\`, `\\/`→`\/`) applied
regardless of the prompt, plus two prompt instructions (numeric quantities are `int`, not
`enum`; each `exists`/`forall` is its own closed scope, nest rather than chain). Re-ran the
identical n=3 × 14 sweep. Raw: `results/formalize-mzn-2026-09-16T10-53-55-723Z.json`, **$0.0114**.

| Outcome | Before (§5.2) | After |
|---|---|---|
| `SOLVE_ERROR` | 15/42 (36%) | 9/42 (21%) |
| `SOLVE_UNIQUE` | 16/42 | 19/42 |
| **MATCH** | **11/42 (26%)** → corrected 12/42 (29%, §5.7) | **13/42 (31%)** (unchanged, §5.7) |

A real, further improvement — confirmed live on the three originally-failing puzzles before the
full re-run: PZL-0010 (escaped operators) and PZL-0028 (generator scoping) no longer show those
specific errors at all. **But the fix was partial, not complete, on two counts:**

- **The `enum`-for-numeric-values mistake recurred** — once on PZL-0012 again (`enum TIME = {9,
  11, 16};`, the exact same puzzle) and newly on PZL-0018 (`enum HOUSES = {1, 2, 3};`, a
  DIFFERENT puzzle previously unaffected). A prompt instruction reduces but does not reliably
  eliminate this mistake — expected, since prompting shapes probability, not a hard guarantee,
  and this is exactly why the instruction was paired with (not substituted for) the fully
  mechanical operator-escaping fix wherever a mechanical fix was actually possible.
- **Two NEW `SOLVE_ERROR` causes appeared that weren't in the original three** — PZL-0001
  invented a nonexistent MiniZinc builtin (`` no function or predicate with name `find' ``), and
  PZL-0011 hit a float-typed intermediate variable declaration issue (`var float: dtiRatio =
  combinedDebt / ...`) not seen before. Also a fresh identifier collision on PZL-0022
  (`` identifier `rice' already defined ``) — the SAME class as before, just on a different
  puzzle this run. None of this is a regression from the fix itself (the three targeted causes
  did shrink); it's normal LLM sampling variance surfacing a different slice of the same broad
  "the model doesn't always write flawless MiniZinc" reality — `SOLVE_ERROR` is a large,
  heterogeneous bucket, not one bug with three faces.

### 5.4 Characterizing `formalize-mzn`'s semantic failures: self-flagging vs. silent, not syntactic vs. semantic

The user's framing going in was "syntactic problems are fixable, semantic ones will likely
remain a challenge" — directionally right, but the actual dividing line in the data is sharper:
whether a semantic slip changes the solve's OUTCOME CLASS (self-flagging, catchable without the
answer key) or lands on a different, wrong, but still-unique answer (silent, catchable only with
ground truth). Every non-MATCH result that compiled and solved (20/42, §5.3's post-fix run) falls
into one of three concrete mechanisms:

- **Silently dropping an explicitly-stated global constraint** (PZL-0038, whose Stage-1 solve was
  already `MATCH`). The prose says outright "one animal per pen"; the model correctly encoded
  three of five animal assignments and the rabbit-before-wolf clue, and simply never emitted
  `alldifferent(pens)`. Nothing catches this at compile time — the program is well-formed, just
  permissively under-constrained. Result: `MultiplySatisfiable`, not a wrong unique answer.
- **Incomplete relational coverage** (PZL-0010, Stage-1 solve already `MATCH`). A compound
  ordering clue across four positions was only partially transcribed — three pairwise relations
  captured, one (East relative to North/West) missing entirely, leaving a partial order where the
  puzzle needs a total one. A genuine transcription gap, not a typo. Result: `MultiplySatisfiable`.
- **Self-contradiction across restated constraints** (PZL-0010, a different rep). Two separate
  `constraint` lines directly negate each other (`order[2]` must be Pedestrian-or-East in one
  line, neither in another) — apparently from encoding overlapping clues twice without
  cross-checking consistency. Result: `Unsatisfiable`.

**None of the 42 runs produced the genuinely dangerous case** — a syntactically valid, uniquely
solvable model that grades `MISMATCH` on a determinate puzzle, with zero signal anything went
wrong. Every semantic slip observed moved the *solution count* itself (to 0 or >1) rather than
landing on a different exactly-one-solution set. This plausibly reflects real structure in this
puzzle genre — these puzzles are usually tightly constrained, so garbling a constraint more often
changes cardinality than swaps in a different valid unique answer — but it is an observation
from n=3×14=42 samples, not a guarantee: this same session's `direct-solve` work already found the
"confident, wrong, no signal" failure mode is real in free prose (PZL-0001, `gpt-4o-mini`), and
nothing about MiniZinc's syntax makes a model structurally immune to producing its equivalent —
it simply didn't appear in this sample.

**Confirms RFC-003 §7.3's orthogonality claim concretely, not just in the abstract**: 4 of the
semantic failures occurred on puzzles whose Stage-1 reasoning was already correct (`MATCH`) —
Stage 2 (formalization) introduced the error independently. Correct reasoning does not insure
against a bad transcription; solvability and translation-fidelity really are separate risks.

**What's actionable now, and what isn't**: the self-flagging failures (`Unsatisfiable`/
`MultiplySatisfiable`) have a concrete, already-validated remedy in this project — SPIKE-012's
oracle-repair pattern (re-prompt using the specific solve-outcome signal as a localized
correction cue) — a cheap next experiment for `formalize-mzn`, not a research problem. The
silent, confidently-wrong case has no mechanical remedy from inside this pipeline at all (no
compile/solve signal distinguishes it from a correct result); catching it would need either an
independent second formalization to cross-check against, or ground truth, neither available at
deployment time. That ceiling doesn't move with more prompt engineering.

### 5.5 `formalize-mzn+oracle-repair` (3rd variant): the mechanism works exactly as designed, and that isn't enough

> **Correction (2026-09-16, see §5.7):** regraded after the same grader fix — **13/42 (31%)**, not
> 12/42. The one flipped case (PZL-0003 rep 0) was never actually repaired (`repaired: false` in
> the raw record) — it was a correct solve mis-graded from the start, so the 17-repair breakdown
> table below (7/17 still `SOLVE_ERROR`, 9/17 reached a valid solve but still wrong, 1/17 recovered
> to `MATCH`) is **unchanged**; only the overall denominator moved. `formalize-mzn+oracle-repair`
> now ties `formalize-mzn` alone (§5.3's 13/42) exactly, sharpening "no measurable effect" from an
> approximate reading to an exact one.

Built and ran the repair loop §5.4/§6 recommended: one bounded round, whole-model feedback (the
previous MiniZinc plus the specific solve-outcome signal, restated as one of §5.4's three
diagnosed mechanisms), triggered on `SOLVE_ERROR` always or on `Unsatisfiable`/
`MultiplySatisfiable` only for puzzles the answer key declares determinate. Same n=3 × 14 sweep,
same source traces. Raw: `results/formalize-mzn-oracle-repair-2026-09-16T13-46-27-278Z.json`,
**$0.0182** (60% more than §5.3's `formalize-mzn` alone).

| | `formalize-mzn` (§5.3) | `formalize-mzn+oracle-repair` |
|---|---|---|
| MATCH | 13/42 (31%) | 12/42 (29%) → corrected 13/42 (31%, §5.7) |
| Cost | $0.0114 | $0.0182 |

**Flat-to-slightly-worse, not an improvement** — the 1-point difference is well within noise for
n=42, so the honest reading is "no measurable effect," not "repair hurt." Repair triggered
17/42 times (40% of all reps needed it); of those:

| Result after repair | Count |
|---|---|
| Still `SOLVE_ERROR` (repair itself introduced another syntax mistake) | 7/17 (41%) |
| Reached a valid solve, still wrong grade | 9/17 (53%) |
| Recovered to `MATCH` | 1/17 (6%) |

**The mechanism behaves exactly as predicted in §5.4/§6 — that's the finding, not a bug.** The
one success (PZL-0007) confirms repair CAN work. But a single generic, whole-model hint mostly
either fails the same way again (a repair call is just as capable of introducing a NEW syntax
mistake as the original call, since it's the same model doing similar work) or nudges the model
toward a DIFFERENT wrong model rather than the specific fix needed — visible concretely in a
follow-up inspection of PZL-0038's repaired attempt: the hint correctly prompted the model to add
the missing `alldifferent` (fixing exactly what was hinted), but the underlying quantifier-scope
bug (`exists` where `forall` was needed — a mechanism not named in this run's generic hint) was
untouched, so it stayed `MultiplySatisfiable` anyway. **Without SPIKE-012's per-clue localization
— which `formalize-mzn`'s flat, undifferentiated text structurally cannot provide — a repair
round can fix what it's specifically told, but has no way to discover a DIFFERENT problem it
wasn't told about.** That's the real cost of giving up per-clue tagging for the representation
win §5.2 found: repair-ability is one of the things `ExtractedCsp`'s structure was buying, even
though its own formalization accuracy was worse to begin with.

### 5.6 `formalize-mzn+lint-repair` (4th variant): surgical application works, diagnosis remains the bottleneck

> **Correction (2026-09-16, see §5.7):** regraded after the same grader fix — **13/42 (31%)**, not
> 12/42. The one flipped case (PZL-0001 rep 2) proposed zero findings — repair never fired for
> it — so, exactly as in §5.5, the repair-specific numbers below (18 findings proposed, 14/18
> applied cleanly, 0/14 triggered repairs recovered to `MATCH`) are **unchanged**; only the overall
> denominator moved. `formalize-mzn+lint-repair` now ties `formalize-mzn` alone (§5.3's 13/42)
> exactly, same as §5.5.

§5.5's whole-model regeneration is exposed to the same failure mode as the original
formalization call — it can fix what it's hinted at while silently breaking or leaving broken
something else, since nothing guarantees the unaffected parts stay unaffected. Split repair into
two narrower steps to test that hypothesis directly: (a) LINT — one forced tool call returning
STRUCTURED FINDINGS (`{locate, issue, suggestedFix}[]`) instead of a rewritten file, where
`locate` must be an exact, verbatim substring of the current draft; (b) APPLY — each finding as
an exact-match string replacement, in CODE, mirroring the Edit tool's own contract: a `locate`
that doesn't match the draft exactly once is skipped (recorded, never guessed), so everything
outside a matched region stays byte-for-byte untouched. Draft kept in-memory. Verified offline
first (5 checks: clean single-finding apply, untouched-region preservation, a non-unique-match
skip, a not-found skip, sequential multi-finding application) — all zero-cost, all passed before
spending anything. Same trigger condition as §5.5. Raw:
`results/formalize-mzn-lint-repair-2026-09-16T14-55-14-668Z.json`, **$0.0154**.

| | `formalize-mzn` (§5.3) | `+oracle-repair` (§5.5) | `+lint-repair` |
|---|---|---|---|
| MATCH | 13/42 (31%) | 12/42 (29%) → corrected 13/42 | 12/42 (29%) → corrected 13/42 |
| Cost | $0.0114 | $0.0182 | $0.0154 |

Same flat-to-slightly-worse headline as `oracle-repair` — but the mechanism behind that number is
now genuinely different, and worth separating from the number itself.

**The surgical-application half of the redesign worked exactly as intended.** 18 findings were
proposed across 14 triggered repairs; 14/18 (78%) applied cleanly — the model's `locate` snippet
matched the current draft exactly once. Re-running one puzzle's lint call standalone (PZL-0010)
showed the mechanism's own failure boundary directly: the identical finding, resampled, sometimes
reproduces the draft byte-for-byte (applies) and sometimes drifts by even a little whitespace
(silently, correctly, skipped rather than misapplied) — the honest cost of exact-match
discipline is trading recall (an occasional real fix goes unapplied because the snippet didn't
reproduce verbatim) for precision (never a wrong guess), by design, not a flaw.

**But 0/14 triggered repairs recovered to `MATCH`** — nominally worse than `oracle-repair`'s
1/17, though at this sample size (14 vs. 17 trials, 0 vs. 1 successes) the difference isn't
statistically meaningful; the honest reading is both are near-zero. Of the 9 reps that stayed
`SOLVE_ERROR` after repair, 8 had their finding APPLIED cleanly — meaning the surgical edit went
in exactly as proposed, and either the model's own `suggestedFix` text was itself syntactically
broken, or a second, undiagnosed problem remained untouched. A concrete example: PZL-0012's
finding correctly added `alldifferent(drugTime)` — the exact fix the hint pointed at — and
applied without disturbing anything else, but the puzzle still graded `MultiplySatisfiable`: the
constraint set remained incomplete in a way the one-shot lint pass never surfaced (an
under-specified meal-time boundary condition, the same class of gap §5.4 already catalogued).

**This isolates the actual bottleneck cleanly: it was never really about HOW a fix gets
applied.** §5.5 speculated that oracle-repair's low recovery rate came from whole-file
regeneration silently corrupting the parts that were already right. This variant tests that
hypothesis directly by removing the corruption risk entirely (exact-match, code-applied edits,
verified never to touch untouched regions) — and the recovery rate did not improve. The real
constraint is DIAGNOSTIC accuracy under a single, coarse, outcome-class-only signal (no per-clue
ground truth, no independent check on whether a proposed fix is actually complete), not the
mechanics of applying whatever gets diagnosed. A linter-shaped repair is a genuine engineering
improvement in one respect — it can never make things worse outside what it explicitly touches,
a real, verifiable safety property `oracle-repair` lacks — but it inherits the SAME diagnostic
ceiling, because diagnosis and application were never actually the same problem; only
application was fixed here.

### 5.7 A real grader defect, its fix, its blast radius, and the frontier-tier comparison it unblocked

**The frontier-tier comparison this spike's own §6 (original version) left untested**: does
`formalize-mzn` show the same ~35-point gap below its own tier's `direct-solve` rate at the
FRONTIER tier (`claude-sonnet-4.5`, 93% `direct-solve` MATCH) that it shows at the cheap tier
(`gpt-4o-mini`, 64% `direct-solve` vs. 31% `formalize-mzn`)? Reused the already-collected
`claude-sonnet-4.5` `direct-solve` traces as Stage 1, added a `MODEL` env-var override to
`run-formalize-mzn.ts` so Stage 1 and Stage 2 are the same tier (the correct apples-to-apples
comparison), and ran the identical n=3×14 sweep. Raw MATCH: **9/42 (21%)** — a *worse* rate than
the cheap tier, which on its face would have meant frontier capability makes NO difference to
formalization accuracy specifically, a genuinely strange result worth doubting before accepting.

**Doubting it paid off.** Manually re-solving and cross-checking all 17 `SOLVE_UNIQUE`+`MISMATCH`
cases in this run against `eval/answer-keys.json` by hand found **all 17 were the puzzle's actual
correct answer** — e.g. PZL-0001 (the hardest puzzle in the catalog) solved perfectly, graded
`MISMATCH` because the model wrote `LuckyStrike`/`OldGold` where the answer key spells them
`Lucky Strike`/`Old Gold`. The root cause: `src/eval/grader.ts`'s `normalizeToken` sanitized
identifiers (via `compile.ts`'s `sanitizeIdentifier`) but never folded case or bridged separator
conventions, so a model free to author a MiniZinc identifier directly — with no code step tying
its spelling back to the answer key's own literal string, unlike `ExtractedCsp`-based paths where
`compile.ts` derives the identifier from the SAME string the grader normalizes — produced a false
`MISMATCH` whenever it chose a different (but semantically identical) spelling convention.

**Fixed** by folding `sanitizeIdentifier`'s output to a case/separator-insensitive comparison key
(lowercase, strip underscores) before comparing — still an exact comparison of the SAME sanitized
identifier under different renderings, never a fuzzy match across genuinely different values (see
`src/eval/grader.ts`'s `comparisonKey`, commit on branch `fix/grader-token-normalization-gap`).

**Blast radius, checked systematically rather than assumed** — every committed result file across
every spike with a compile/solve/grade pipeline was scanned for `SOLVE_UNIQUE`+`MISMATCH` cases
(the only combination where this false-negative class can hide) and each hit was manually
re-verified:

| Architecture | Records checked | Cases found | Confirmed false negatives (this bug) |
|---|---|---|---|
| SPIKE-008 (`full-critic`, `per-clue`, `+grounded`, `+back-translation`) | 176 | 0 | — |
| SPIKE-009 | 28 | 0 | — |
| SPIKE-010 | 28 | 0 | — |
| SPIKE-012 (`graph-pipeline`, `+oracle-repair`) | 98 | 3 | 2 (PZL-0003, both variants) |
| SPIKE-014 `formalize-json` | 42 | 1 | 0 (PZL-0007 — a different, still-open grading issue, see below) |
| SPIKE-014 `formalize-mzn` (frontier) | 42 | 17 | 17 |

Every `ExtractedCsp`-mediated architecture (SPIKE-008/009/010) came back clean — `compile.ts`
deriving identifiers mechanically from the same strings the grader normalizes is a real structural
guarantee, confirmed at scale, not just in theory. It is not airtight: SPIKE-012's 2 exceptions
came from the *extraction* step itself choosing different casing (`"paper"` vs. the answer key's
`"Paper"`) — the same underlying gap, one step earlier in the pipeline. The 3rd SPIKE-012 case
(PZL-0007) was a genuinely broken extraction (empty `domains`/`constraints`), unrelated. `formalize-
mzn`, the one variant where the model authors identifiers with no mechanical tie to the answer
key's spelling, is overwhelmingly where this gap lived.

**One case resisted the fix and stayed open**: `formalize-json`'s PZL-0007 (SEND+MORE=MONEY)
solved to the exact correct digit assignment (S=9,E=5,N=6,D=7,M=1,O=0,R=8,Y=2) but still grades
`MISMATCH` — regrading confirms this is NOT the case/separator bug (the missing tokens are bare
digits, which pass through normalization unchanged either way), but some other representation
mismatch between this puzzle's per-word-scoped domain structure and what `gradeFlatRecord` expects
to find. Left as a distinct, unresolved, lower-priority finding — out of scope for this fix.

**Every affected number in this spike, re-graded (free — re-solves already-stored MiniZinc, no new
LLM calls; see `scripts/regrade.ts`)**:

| Result | Old MATCH | Corrected MATCH |
|---|---|---|
| §5.2 `formalize-mzn` (`gpt-4o-mini`, pre-fix prompt) | 11/42 (26%) | **12/42 (29%)** |
| §5.3 `formalize-mzn` (`gpt-4o-mini`, post-fix prompt) | 13/42 (31%) | **13/42 (31%)** — unchanged |
| §5.5 `formalize-mzn+oracle-repair` | 12/42 (29%) | **13/42 (31%)** |
| §5.6 `formalize-mzn+lint-repair` | 12/42 (29%) | **13/42 (31%)** |
| `formalize-mzn` (`claude-sonnet-4.5`, frontier) | 9/42 (21%) | **20/42 (48%)** |
| §5.1 `formalize-json` (`gpt-4o-mini`) | 0/42 | **0/42** — unchanged (PZL-0007 above is a different, still-open issue) |

**None of this spike's qualitative conclusions change.** `formalize-mzn` still clearly beats
`formalize-json`; the repair variants still show no measurable improvement over `formalize-mzn`
alone (now an exact tie at 13/42 rather than an approximate one, see §5.5/§5.6's own correction
notes); `full-critic`'s 2/14 (14%) is still beaten. **The frontier-tier finding does change,
though, and matters more than the cheap-tier corrections**: `claude-sonnet-4.5`'s corrected 48%
formalize-mzn rate is still well below its own 93% `direct-solve` rate — a real ~45-point gap, not
a grading artifact — confirming the original spike's central finding (the LLMs this project
targets are more capable of SOLVING a puzzle than of TRANSLATING/COMPILING it into a solvable
form) generalizes to the frontier tier, and isn't a cheap-tier-specific familiarity gap with
MiniZinc. It's real, and it's the same shape at both tiers measured so far.

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

**`formalize-mzn`'s 29-31% MATCH (corrected, §5.7) is the strongest result any compile/solve-
VERIFIED architecture has reached across this entire spike line** (SPIKE-008 through SPIKE-014) — genuinely ahead of
`full-critic`'s 2/14 (14%), at roughly 1/100th the cost ($0.01-0.02 vs. ~$2.10 for a 14-puzzle
pass), and reached with a single call per puzzle, no critic loop, no per-clue decomposition. It
remains well below `direct-solve`'s own raw judge-graded rate (64%/93%) — but that comparison
isn't apples-to-apples: `direct-solve` has no compilable artifact and is graded by a judge
reading prose, while `formalize-mzn`'s number survives an independent, mechanical compile-and-
solve gate direct-solve was never subjected to.

**The two Stage-2 representations' failure modes don't overlap at all** — `formalize-json`'s
were both properties of the JSON schema itself (identifier collisions the schema still lets the
model freely type; violations deep in a 134-`anyOf`-union structure). `formalize-mzn`'s dominant
failure (`SOLVE_ERROR`) is MiniZinc's own compiler catching real mistakes — an escaped-operator
typo, a category-vs-quantity modeling error, a generator-scoping misunderstanding — none of which
resemble a JSON-schema violation. Trading one schema's failure surface for a completely
different, and evidently more tractable, one is the actual mechanism behind this result, not a
coincidence.

**Two repair mechanisms were tried on top of `formalize-mzn`, and neither improved the MATCH
rate — for an interesting, well-isolated reason.** `oracle-repair` (§5.5, whole-model
regeneration from a coarse hint) and `lint-repair` (§5.6, structured findings applied as
exact-match edits) landed at the same 13/42 (corrected, §5.7) as no repair at all — an exact tie,
not merely "within noise." §5.6 specifically isolates WHY: making the application mechanism provably safe (never
touches anything outside what it's told to fix) did not change the outcome, which means the
bottleneck was never really about how a fix gets applied — it's that a single, coarse,
outcome-class-only signal (no per-clue ground truth, no independent check that a proposed fix is
complete) isn't enough to reliably diagnose what's actually wrong. `ExtractedCsp`'s per-clue
tagging (SPIKE-012) is what makes ITS OWN repair loop able to localize a fix precisely; giving
that up for `formalize-mzn`'s representation win (§5.1 vs. §5.2/§5.3) also gives up that
diagnostic leverage, and no amount of engineering the APPLICATION step recovers it.

**Recommended next steps**:
1. `formalize-mzn`'s remaining `SOLVE_ERROR` causes (§5.3) are narrow and plausibly cheap to
   address further, but that's implementation hardening (prompt-tuning iteration), not this
   spike's own empirical question — which is answered: the architecture works, and the
   representation choice matters enormously (§5.1 vs. §5.2/§5.3).
2. §5.4's self-flagging/silent distinction, not "syntactic vs. semantic," is the axis worth
   designing around — a silent, confidently-wrong unique result has no mechanical remedy and
   won't from prompting alone; any future work claiming higher confidence in this architecture
   should say explicitly which of the two failure classes its evidence actually rules out.
3. A real fix for `formalize-mzn`'s repair ceiling (§5.5/§5.6) needs better DIAGNOSIS, not a
   better patch-application mechanism — that half is already solved. Candidates worth trying
   before assuming this ceiling is fixed: an independent second formalization pass to
   cross-check against (closer to what `ExtractedCsp`'s per-clue structure gives SPIKE-012 for
   free), or asking the model to verify its OWN model against each individual clue in turn
   (closer to SPIKE-008's back-translation critic, previously found only partially effective for
   this exact class of problem) before repair, not after.
4. This spike's method (solve first, formalize the completed solve, verify via compile/solve) is
   confirmed as sound and worth building on; the open engineering questions are now narrowly
   about `formalize-mzn`'s prompt quality and repair diagnosis, not about whether this
   architectural direction is worth pursuing.
5. **§5.7's grader fix is committed and this spike's numbers are corrected**, but two follow-ups
   remain genuinely open: (a) `formalize-json`'s PZL-0007 grading gap (a per-word-scoped domain
   structure vs. `gradeFlatRecord`'s expectations) is unrelated to this fix and still unexplained;
   (b) the frontier-tier `formalize-mzn` corrected rate (48%) vs. its own `direct-solve` rate (93%)
   confirms the solve-vs-formalize gap is real and tier-independent, which sharpens (not
   undermines) recommendation 3 above — better diagnosis, not more prompt engineering at the
   cheap tier alone, is the right next investment.

Status: done.
