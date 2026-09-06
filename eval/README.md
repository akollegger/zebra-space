# Extraction Eval

Runs every catalog puzzle (`catalog/puzzles/`) through the full extract → compile → solve
pipeline ([ADR-004](../design/adr/ADR-004-llm-extraction-critic-loop.md)/
[ADR-005](../design/adr/ADR-005-extractedcsp-mzn-compiler.md)) and compares the result against
`answer-keys.json`'s known-correct solutions — a broader, ground-truth-checked measurement than
`tests/extraction/live.test.ts`, which only samples 5 of the catalog's 39 puzzles (all from the
original 14 — the sample has not yet been rotated to include the newer non-problem, optimization,
ambiguous, and subjective categories) and checks a weaker signal (the critic accepted it, not that
it solves to the right answer).

## Running it

```bash
pnpm eval                                   # every catalog puzzle
node scripts/eval-extraction.ts PZL-0004    # just one, for debugging
node scripts/eval-extraction.ts --model openai/gpt-4o-mini --frontier-model anthropic/claude-sonnet-4.5
node scripts/eval-extraction.ts --runs 3 --budget-usd 5   # repeat 3x with a $5 hard budget gate
node scripts/eval-extraction.ts --no-critic               # ablation: single-shot, no critic
node scripts/eval-extraction.ts --compile-repair-only     # ablation: compile-repair loop, no critic
node scripts/eval-extraction.ts --harness <id>            # any registered harness by id (wins over the flags above)
node scripts/eval-extraction.ts --harness direct-solve    # baseline: solve in prose, judge to verdict
node scripts/eval-extraction.ts --baseline <run-id>.json --timeout-factor 3  # cap each puzzle at 3x its baseline time
node scripts/eval-matrix.ts --dry-run       # plan the model x harness matrix without spending
node scripts/eval-matrix.ts                 # subset cells + full baseline, 3 repeats each
node scripts/eval-matrix.ts --harness single-shot  # only cells using this harness
```

Requires `OPENROUTER_API_KEY` (auto-loaded from a repo-root `.env`, see root README) and a
working `minizinc` install. **Not a CI gate** — it makes real, billed LLM calls, and extraction is
non-deterministic ([SPIKE-004](../design/spikes/SPIKE-004-llm-based-extraction/SPIKE.md)), so a
single run's pass rate is a noisy sample, not a stable regression signal. Puzzles run
sequentially, not in parallel, to stay easy on rate limits/cost.

Cost control: `--budget-usd` is a hard gate — a pre-run estimate (registry cost × harness
worst-case calls × puzzles × runs) refuses to start when over budget, and a live accumulator
stops the run mid-way. Per-call spend is the SDK's reported `usage.cost` when present, else
the `eval/models.json` estimate. The comparative matrix (`scripts/eval-matrix.ts`) crosses
verified registry models (at least one per tier) with registered harnesses; each cell
defaults to a stratified 8-puzzle subset spanning all five outcome classes, the baseline cell
always runs all 39, and `--full` opts every cell in. Only `verified` registry entries run.

## Baseline (`direct-solve`, ADR-008)

Every extraction number needs a baseline answering "can the model solve this at all, schema
aside?" `direct-solve` asks the model to solve in free prose, then a judge model (default
`z-ai/glm-5.3-flash`, override `--judge-model` / `ZEBRA_JUDGE_MODEL`) converts the prose to
a structured verdict our grader scores — judge proposes, grader disposes, same strict
semantics as the pipeline. The gap between baseline solve rate and extraction pass rate is
the measured schema tax. `--baseline` + `--timeout-factor` (default 3) caps each puzzle at
a multiple of its baseline wall-clock; overruns record `TIMEOUT`. Judge over-acceptance on
fluent wrong answers is not yet calibrated — treat baseline numbers as a ballpark.

## Harnesses (`src/eval/harness.ts`)

A harness owns everything from prose to a reached `SolveResult` through three
stage-separated Effects — `extract`, `compile`, `solve` — each recorded (and failed)
independently. The runner, grader, frequency reporting, budget, and matrix table all sit
downstream of that seam and work unchanged for any harness. Built-ins: `full-critic` (the
ADR-004 loop; the old `--model` default path), `single-shot` (`--no-critic`), and
`compile-repair` (`--compile-repair-only`). Every run records `harnessId` and
`promptVersion` in its raw JSON and per-puzzle records.

Adding an alternative harness (different prompts, tools, local NER, graph CSP, different
compiler/solver) is a new file plus a registry entry in `harness.ts` — never runner
surgery. The first local harness already exists: `local-single-shot` routes through
`ZEBRA_LOCAL_BASE_URL` (LM Studio et al) with a 10-minute default timeout
(`ZEBRA_LOCAL_TIMEOUT_MS`) — pilot 2026-09-06 went 2/2 MATCH on Qwen3 (PZL-0004 in 94s,
PZL-0003 in 859s), so budget ~15 min/puzzle for local runs. Rules: new behavior gets a
new harness id (never reuse); prompt text changes bump
the prompt version (`EXTRACTION_PROMPT_VERSION` in `src/extraction/extract.ts`,
exposed with the text via `extractionPrompts()`); `extractedCsp` crosses the seam as
`unknown`, but harnesses producing this pipeline's `ExtractedCsp` should pass it through so
entity-vocabulary recovery keeps working; each harness declares `maxCallsPerPuzzle`
(0 for fully local) so budgets scale to it. See ADR-007 §2.4.

## Output

- `results.md` (committed) — one append-only section per run: date, git commit, models used, and
  a per-puzzle outcome table. The durable history to compare across runs/changes.
- `results/<run-id>.json` (gitignored) — full raw detail for one run: harness id +
  description + prompt version, extracted CSP, compiled `.mzn`, solve result, grader detail,
  spend, and per-repeat records. Use this to actually debug a failure; `results.md` only has
  the summary.
- `matrix.md` (committed) — one section per matrix run: the cells executed, their estimates, and
  skipped tiers. Per-cell raw detail lives in that cell's `results/<run-id>.json`.
- `models.json` (committed, versioned) — the model registry: id, tier, cost-per-call estimate,
  verification status, provider notes. Only `verified` entries run.
- `aliases.json` (committed, versioned) — the grader's alias table for name paraphrases.

## Answer keys (`answer-keys.json`)

Ground truth, one entry per puzzle id (`title`, `answer`, `notes`). Moved here from
`specs/001-catalog-seeding/` (originally authored per that spec's FR-009 verification
requirement) and reformatted from Markdown to JSON so it's machine-comparable. `notes` keeps the
original hand-derivation reasoning for human review. `answer`'s shape is deliberately
heterogeneous — arrays, flat maps, digit maps, grids, orderings, subsets — matching the seed
catalog's own mix of constraint shapes (not every puzzle is a zebra-grid puzzle), not a single
uniform schema.

## Grading (ADR-007)

Comparison semantics are decided in [ADR-007](../design/adr/ADR-007-eval-outcome-grader-semantics.md)
and implemented in `src/eval/grader.ts`:

- **Determinate puzzles** expect `UniquelySolvable` plus a pairing-aware comparison: parallel
  arrays compare rows as multisets (order-invariant, transposition-sensitive), PZL-0006 uses
  its explicit row→column rule, PZL-0014 uses subset semantics, and flat records use token
  subsets. No generic fallback is claimed for shapes outside these rules.
- **Name normalization** reuses the compiler's own `sanitizeIdentifier` (imported, not
  duplicated) plus integer passthrough, then the versioned `eval/aliases.json` table
  (`canonical → [variants]`, exact lookup only — no fuzzy matching). Every alias application
  is recorded in the run's raw JSON.
- **Other classes** grade under their own verdicts: `OPTIMUM_ATTAINED`/`FEASIBLE_ONLY` (cop),
  `READING_MATCHED`/`NO_MATCHING_READING` (ambiguous), `PREMISE_FREE_MATCH`/
  `PREMISE_SILENTLY_PROMOTED` (subjective), `UNDECLINED` (non-problem — no decline path
  exists yet, so no run can pass). `FEASIBLE_ONLY` and `UNDECLINED` are reported but excluded
  from the pass-rate denominator, which is passes over graded runs.

With `--runs N`, the report adds a per-puzzle frequency table ("7 reliable / 4 flaky /
3 never") — the stability signal a single snapshot cannot give.

## Known limitations

- **Top-level object keys are excluded from comparison on both sides** — only their values are
  compared. Top-level keys are just field-name choices (the answer key's own authored JSON
  structure, or the LLM's independently-invented domain-variable names), not reliable
  cross-comparable puzzle vocabulary.
- **`recoverEntityKeyedArrays()`** (`scripts/eval-extraction.ts`) restores entity-name
  vocabulary MiniZinc's positional JSON output drops (found live on PZL-0010), zipping solved
  arrays against the same entities `compile.ts` indexed them by. Pairing verification itself
  lives in the grader; this only restores missing vocabulary.
- **PZL-0006's positional-array reading assumes rows are numbered 1..n in index order** — named
  in the rule, not claimed as a generic mechanism.

**Known, currently-unaddressed pipeline gaps** — real representational limits in ADR-004's
`ExtractedCsp`/ADR-005's compiler, not eval-script issues, found by running this harness against
the full catalog (also noted in each ADR's Consequences section):

- **Residual model non-determinism** — even after several rounds of schema/compiler fixes (entity-
  scoped `variableRef`, expression-valued `target`, more/n-ary arithmetic operators, adjacency
  relation-name normalization, enum-collision fix, nested `derivedRule` for relational chaining
  between two anonymous entities, the `ruleTable`/`ruleTableConstraint` kind — see ADR-004/ADR-005
  Consequences), occasional extractions still confuse an arithmetic `op` with the constraint's
  `comparator`, or reference an undeclared variable. Consistent with SPIKE-004's already-documented
  non-determinism finding; a residual rate is expected, not chased to zero.

Relational chaining between two anonymous entities and a universal rule-table constraint kind were
both real gaps as of this section's earlier drafts — both are now addressed (nested `derivedRule`
`$this`/`$outer` binding, and the `ruleTable`/`ruleTableConstraint` kind, respectively); see
ADR-004's Consequences section for the fix history rather than relying on this file, which doesn't
track resolved gaps.
