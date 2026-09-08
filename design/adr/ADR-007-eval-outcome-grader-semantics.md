---
id: ADR-007
title: Eval Outcome Taxonomy and Grader Semantics
status: proposed
rfcs: [RFC-004]
created: 2026-09-06
specs: []
---

# ADR-007: Eval Outcome Taxonomy and Grader Semantics

## 1. Context

The eval harness (`scripts/eval-extraction.ts`, documented in `eval/README.md`) runs every
catalog puzzle through extract → compile → solve and compares the solved assignment against
`eval/answer-keys.json`. Three defects in that harness make its pass rate unreliable in both
directions, and all three are visible in committed artifacts rather than inferred.

First, the comparison (`flatten`/`compareAnswer`) reduces both sides to flat token sets and
checks subset inclusion. For parallel-array answers (PZL-0001, PZL-0002, PZL-0006, PZL-0008,
PZL-0010) that verifies vocabulary only: a transposed pairing scores MATCH. For subset-shaped
answers it does the opposite: PZL-0014's expected 3-item subset compared against a full
assignment scores a false MISMATCH. Exact string matching adds a third error: an LLM's
`book_set` against the answer key's "hardcover book set" scores MISMATCH on a correct solve.

Second, the outcome taxonomy (`EXTRACT_FAILED` … `MATCH`/`MISMATCH`, plus `NO_ANSWER_KEY`)
treats every non-unique solve as failure. Twenty-five of the 39 catalog puzzles are
non-problems, optimization problems, ambiguous, or subjective — classes whose correct result
is not a unique assignment. PZL-0018 is the sharp case: a non-problem built on a deliberately
uniquely-solvable house model, so correct refusal scores MISMATCH and confident wrongness
scores MATCH. Correct behavior and bugs are indistinguishable.

Third, a single run is reported as a pass rate, while extraction is stochastic: the same
commit has scored anywhere from 0/14 to 3/14 in a day. No repeat runs, no frequency, no
cost accounting, no budget guard — a full matrix across models and workflows would spend
blindly (roughly 700 billed puzzle-runs at current defaults).

[RFC-004](../rfc/RFC-004-computational-decision-making.md) §5 supplies the vocabulary this decision
applies: four problem classes (§5.3), two solving regimes (§5.2), and the rule that
multiplicity must be expressible as an expected, passing outcome (§3). Its open question
§7.3 (expected-outcome vocabulary) is what this ADR resolves; §7.4 (correct behavior on
ambiguity), §7.5 (valuations for subjective problems), and §7.9 (solver outcome extension)
constrain the grading semantics below without being reopened here.

## 2. Decision

### 2.1 Expected-outcome vocabulary, one code per problem class

Each `eval/answer-keys.json` entry carries an `outcome` class marker: `determinate` (the
default when absent), `cop`, `ambiguous`, `subjective`, or `non-problem`. COP entries
(PZL-0022–PZL-0027) gain an explicit `"outcome": "cop"` marker; every other non-determinate
entry already carries one. Per-class expectations:

- **determinate**: the pipeline must reach `UniquelySolvable`, and the assignment must equal
  the recorded answer under §2.2's comparison. Verdict `MATCH` is a pass.
- **cop**: the demand is find-best, so the expectation is the recorded optimum *value*, not
  an arrangement. A per-puzzle optimum table names the field: PZL-0022 `total_value` 18,
  PZL-0023 `total_hours` 20, PZL-0024 `total_cost` 15, PZL-0025 `num_crates` 3, PZL-0026
  `total_priority` 18, PZL-0027 `total_distance_miles` 80. Verdict `OPTIMUM_ATTAINED` (a pass)
  when an enumerated solution attains the optimum value; `FEASIBLE_ONLY` (reported, excluded
  from the pass-rate denominator) when the pipeline solves *successfully* but the optimum
  does not appear in its capped output. `INFEASIBLE` (a failure, counted in the denominator)
  when the solve result is `Unsatisfiable` — an infeasible model is a wrong extraction, not a
  variant of feasible-but-suboptimal, and `FEASIBLE_ONLY` never covers it. Arrangement is
  never compared: PZL-0025's notes record the minimum count as unique but the grouping as
  not, and PZL-0027 records two reversal-equivalent optimal tours as one answer.
- **ambiguous**: the entry's `readings[]` each record a `result` (`uniquely solvable`,
  `multiply satisfiable`, `unsatisfiable`) plus an `answer` or `solution_count` where
  determinate. The pipeline silently picks one reading; verdict `READING_MATCHED` (a pass)
  when the pipeline's outcome equals some reading's result, with the answer additionally
  compared when that reading records one. Otherwise `NO_MATCHING_READING` (a failure).
- **subjective**: the entry records `without_premise` (the premise-free result) and
  `with_premise` (the determined answer given the unstated premise). The pipeline supplies
  no premises, so the expectation is the premise-free class: every catalog entry in this
  class maps to `MultiplySatisfiable` (unconstrained, underdetermined, and 2–4-solution
  cases alike — the solver's trichotomy cannot distinguish them, and the distinction does
  not change the verdict). Verdict `PREMISE_FREE_MATCH` (a pass) on that outcome.
  `PREMISE_SILENTLY_PROMOTED` (a failure) when the pipeline returns `UniquelySolvable` with
  an assignment matching the `with_premise` answer — the silent-promotion detector
  RFC-004 §5.7 calls for. PZL-0038 is the twin that proves the detector cuts both ways: it
  carries `outcome: determinate` with a nested `answer`, grades as determinate, and an
  `Unsatisfiable` there fails with the note that an inapplicable premise was likely imported.
- **non-problem**: the expectation is `DECLINE_WITH_DEFECT`, naming the failing condition in
  RFC-004 §5.1's terms from the entry's `failing_condition` (PZL-0015/0016 Demand, PZL-0017
  Determinate answer-space, PZL-0018 Relevance, PZL-0019 Constitutive constraints, PZL-0020
  Determinate atoms, PZL-0021 Sufficiency). The pipeline has no decline path, so no run can
  pass yet: runs report `UNDECLINED` (excluded from the pass-rate denominator, never a
  silent MATCH — the PZL-0018 trap stays visibly open rather than miscounted). This exclusion
  covers only the case where no decline mechanism exists at all. A harness that does have one
  — [ADR-008](ADR-008-direct-solve-baseline.md)'s direct-solve judge can determine a model
  failed to decline and was wrong — must map that outcome to a counted failure, never to
  `UNDECLINED`: conflating "no mechanism" with "mechanism present but wrong" would let a real,
  attributable failure disappear from the denominator. `DECLINED_CORRECTLY` is the reserved
  pass verdict for a future decline path.

Pass rate is passes over graded runs: `MATCH`, `OPTIMUM_ATTAINED`, `READING_MATCHED`,
`PREMISE_FREE_MATCH`, and `DECLINED_CORRECTLY` count; `FEASIBLE_ONLY` and `UNDECLINED` are
reported alongside, not inside, the rate. `INFEASIBLE` counts as a failure like `MISMATCH`,
never excluded. Declining to count an ungradable run is what makes the rate honest; counting
it either way would reintroduce the false verdicts this ADR removes.

### 2.2 Grader comparison semantics for determinate answers

Normalization first: every string token passes through the compiler's own
`sanitizeIdentifier` (reused by import, never duplicated — the duplicate already drifted
once) plus the existing integer passthrough, then through a versioned alias table
(`eval/aliases.json`, `canonical → [variants]`, exact lookup only). The table opens with the
one evidenced case (`book_set` ↔ "hardcover book set"); applying an alias is recorded in the
run's raw JSON, so no normalization is ever silent.

Pairing-aware rules, per answer shape:

- **Parallel arrays** (PZL-0001, PZL-0002, PZL-0008, PZL-0010 after entity recovery):
  expected keys align to actual keys by normalized vocabulary overlap (each expected array
  takes the unmatched actual array sharing the most tokens; ties and same-length collisions
  fail loudly as unalignable rather than guessing). Rows — the positional tuples across
  aligned arrays — compare as multisets. Order-invariant (a reversed entity-declaration
  order still matches) and pairing-sensitive (a transposed array changes which values
  co-occur, so it mismatches). The vocabulary-only blind spot is closed; no generic fallback
  is claimed for shapes outside these rules.
- **PZL-0006 row-keyed mapping**: an explicit per-puzzle rule, not a generic mechanism. Both
  sides reduce to row→column pair sets: the expected `{row_to_column: {r: c}}` directly; the
  actual either from a numeric-keyed record directly or from a positional array under the
  documented assumption that rows are numbered 1..n in index order. Pair sets compare
  exactly. The assumption is recorded in the rule — this is the one named remainder, and it
  names its condition rather than claiming generality.
- **PZL-0014 subset shape**: an expected single-key `{items: [...]}` answer uses subset
  semantics — every expected item must appear among the actual assignment's values; extra
  actual values are not a mismatch. The false MISMATCH is fixed by owning answer shape
  (RFC-004 §7.8) at the grader layer rather than by special-casing the puzzle.
- **Everything else determinate** (digit maps, flat records, single values): the status-quo
  token-subset check with flat-record compound tokens, which already verifies pairing for
  that shape.

### 2.3 Stability, cost, and comparison mechanics

Repeat runs: `--runs N` (matrix default 3, single-run default 1). Every repeat gets a logged
seed/run-id; raw JSON keeps per-repeat detail; the report gains a per-puzzle frequency table
("7 reliable / 4 flaky / 3 never") replacing the single snapshot as the stability signal.

Model registry: `eval/models.json` (versioned) with entries carrying model id, tier
(`local` / `free` / `paid` / `frontier`), dollar cost-per-call estimate, verification
status, and provider notes (schema-compat caveats). The local tier routes through the
existing `ZEBRA_OPENROUTER_BASE_URL_OVERRIDE` seam where possible, carries a $0 estimate,
and still counts calls; a native local path (GLiNER2, Ollama-style) is a separate workflow
variant, not an assumed-free entry. Only `verified` entries run; an unverified tier is
reported as skipped-with-reason, and dropping a tier entirely requires recorded evidence
(schema-rejection rate, pass frequency), never assumption.

Dollar budget: `--budget-usd` is a hard gate in two places. Before spending, a pre-run
estimate (registry cost × planned calls across puzzles × repeats × cells) aborts when it
exceeds the budget. During the run, an accumulator stops the run when spend exceeds it.
Spend per call is the SDK's reported `usage.cost` when present (the `@openrouter/sdk`
`ChatResult.usage` shape — token counts plus cost — is confirmed in the pinned SDK's types;
live values are verified during the pilot, §4) else the registry estimate. Spend is
recorded per cell and per puzzle in the raw JSON.

Comparative matrix: cells are verified registry models (at least one per tier, starting
with the current defaults) crossed with three workflow ablations — (a) the full critic
loop, (b) single-shot no-critic, (c) extract plus compile-error repair retry with no
fidelity critic. Ablations (b) and (c) get new pipeline entry points rather than flags:
`extractSingleShot` exported from `src/extraction/extract.ts` (one cheap-tier call, no
critic, reusing `extractOnce`), and a compile-repair loop owned by the eval runner
composing the exported `extractOnce` with `compile` — the compiler stays out of the
extraction module's dependency closure, preserving ADR-004/ADR-005's layering. Each cell
defaults to a stratified 8-puzzle subset spanning all five classes (PZL-0002, PZL-0004,
PZL-0022, PZL-0028, PZL-0033, PZL-0038, PZL-0015, PZL-0018); the baseline cell (defaults,
full critic loop) always runs all 39; `--full` opts every cell into all 39. Runs stay
sequential — concurrency needs rate-limit evidence first. Output is one raw JSON per cell
plus a per-puzzle × cell comparison table (verdicts, frequency, cost) in a new
`eval/matrix.md`.

### 2.4 Harness seam (added 2026-09-06 — alternative harnesses, prompts, tools)

The three ablations above are instances of a general seam, not the seam itself. Matrix
cells are now model × registered harness (`src/eval/harness.ts`), where a harness owns
everything from prose to a reached `SolveResult` through three stage-separated Effects —
`extract`, `compile`, `solve` — each recorded (and failed) independently, so stage
diagnostics survive without the runner knowing the stages. Consequences of the shape:

- **Prompts are identified, never embedded.** `src/extraction/extract.ts` exports
  `EXTRACTION_PROMPT_VERSION` plus the prompt text; every run records `harnessId` and
  `promptVersion` in its raw JSON and per-puzzle records. A prompt A/B is a new harness id
  or a bumped version — a pass-rate shift is attributable to the prompt edit, never silent.
- **`extractedCsp` crosses the seam as `unknown`.** A harness with its own representation
  (graph CSP, local NER, a different schema) still fits; harnesses producing this
  pipeline's `ExtractedCsp` pass it through so entity-vocabulary recovery keeps working.
- **Budgets are per-harness.** Each harness declares `maxCallsPerPuzzle` (12/1/2 for the
  three built-ins, 0 for fully local), so the pre-run estimate and accumulator scale to the
  harness instead of assuming the critic loop's worst case.
- **Legacy flags are preserved.** `--no-critic` / `--compile-repair-only` map to harness
  ids; `--harness <id>` (and `--harness` on the matrix runner as a cell filter) selects any
  registered harness directly. A new harness is a new file plus a registry entry — the
  runner, grader, frequency, budget, and matrix table all work unchanged. Holding that
  guarantee requires the matrix runner to enumerate harnesses and their `maxCallsPerPuzzle`
  programmatically from the registry (`listHarnesses()`), never through a separately
  maintained id list — a hardcoded copy is exactly how a new harness would silently fail to
  appear.

## 3. Alternatives Considered

- **Keep vocabulary-subset grading and fix only the taxonomy.** Rejected: the false MATCH on
  transposed arrays and the false MISMATCH on subsets and paraphrases are measurement errors,
  not classification gaps. A correct taxonomy over incorrect comparisons still miscounts.
- **Semantic/fuzzy name matching instead of an explicit alias table.** Rejected: fuzzy
  matching trades false MISMATCHes for silent false MATCHes with no audit trail. The table
  is exact, versioned, and its applications are logged — promotion stays visible.
- **Count `FEASIBLE_ONLY` and `UNDECLINED` as passes (or as failures).** Rejected both ways:
  as passes they claim optimum/decline behavior never demonstrated; as failures they punish
  the pipeline for missing capabilities (optimization, decline path) that belong to other
  workstreams. Exclusion with a named verdict is the only accurate accounting.
- **Decline-via-`EXTRACT_FAILED` for non-problems.** Rejected: failing for the wrong reason
  is still failure (RFC-004 §5.7's attribution rule), and a prose-comprehension failure on
  PZL-0018 is indistinguishable from correct refusal under that mapping.
- **Live per-model cost calibration instead of a registry.** Rejected: calibration spends
  money to learn what price pages already state, and cannot price a run *before* it. The
  registry estimates upfront; actuals refine per-cell spend after.
- **Parallel matrix execution.** Rejected for now: the harness and `live.test.ts` both run
  sequentially as a deliberate rate-limit/cost choice, and no evidence yet supports
  changing it.
- **A single-label-per-puzzle class schema extended to cover PZL-0013-style compounds.**
  Deferred: no catalog puzzle in the graded set currently needs multi-label handling, and
  RFC-004 §7.14 leaves the question open. The vocabulary gains a label when a puzzle
  requires one, not before.

## 4. Consequences

- `eval/answer-keys.json` gains `"outcome": "cop"` markers on PZL-0022–PZL-0027 (the only
  class missing them); its `$comment` provisional-taxonomy note now points here instead of
  only at the open question. New versioned files: `eval/models.json`, `eval/aliases.json`,
  `eval/matrix.md`. The eval script gains `--runs`, `--budget-usd`, `--full`, and matrix
  flags as additive options — existing flag behavior and cost are unchanged.
- Grader, stability, and budget code is unit-tested offline against fixtures and the
  existing HTTP stub server; `pnpm test` stays network- and key-free. A live pilot (2
  puzzles × 2 cells × 3 repeats) confirms cost accounting, frequency reporting, and the
  SDK's actual `usage` values before any full-matrix run.
- The solver's 2-solution cap bounds what COP grading can observe: `OPTIMUM_ATTAINED`
  means the optimum appeared in enumerated output, not that the model entails it. Lifting
  the cap (solution counting) belongs to the solving-contract workstream, not this ADR.
- `UNDECLINED` keeps the PZL-0018 trap visible but ungraded; a real decline path (detect
  the failing condition, report it instead of modeling) is follow-up work with this ADR as
  its vocabulary.
- `pnpm test:live` still samples the original 14; rotating it across the newer classes,
  capping `results.md` growth, and graph/COP solver extensions stay explicitly out of scope.

## 5. Related

- RFCs: RFC-004
- Specs: _(populated automatically by the speckit ADR-link hook once `/speckit-specify`
  references this ADR)_
- Implementation: `.kilo/plans/1788691671220-eval-framework-improvements.md` — this branch
  was built against a kilocode-tracked plan rather than a speckit spec; see CLAUDE.md's
  Design process section for the recorded exception.
