# Eval Framework Improvements — Plan (saved 2026-09-06, updated 2026-09-07)

Source of truth for implementation. Status: steps 1–4 done, 5–6 queued.

## Completed (branch `eval-framework-improvements`)

Review-fix pass (post-f8bfef6, by others — see git log): INFEASIBLE for COP-unsat,
subset-throw→MISMATCH, non-problem judge-incorrect counted, local-single-shot in matrix
registry, key gate skipped for local runs, per-puzzle budget shape, judge must be
verified, matrix.md verdict grids, ADR-010 drafted then superseded by SPIKE-007 (do not
implement; usage.cost lives on finishPart.metadata.openrouter.usage.cost). SPIKE-008
(per-clue decomposition) planned, untouched — do not start unprompted.

- ADR-007 (outcome taxonomy + grader semantics) + §2.4 harness seam addendum
- Pairing-aware grader (`src/eval/grader.ts`), versioned aliases, per-class verdicts
- Harness seam (`src/eval/harness.ts`): full-critic, single-shot, compile-repair, local-single-shot
- Repeats + frequency, model registry v2 + dollar budget, matrix runner (model × harness)
- Local LLM support (`ZEBRA_LOCAL_BASE_URL`, string-form tool_choice, `ZEBRA_LOCAL_TIMEOUT_MS`)
- Local pilots: Qwen3.8-27B 2/2 MATCH (PZL-0003/0004); Gemma-4-26B-QAT 0/2 (schema-scale failure, recorded lower bound)
- ADR-008 direct-solve baseline with GLM judge; pilot 2/2 MATCH after case-fidelity fix
- `--baseline`/`--timeout-factor` wall-clock caps with TIMEOUT outcome

## Next steps (ranked by leverage; each unlocks the next)

1. **Judge calibration** (half day, no new code): direct-solve on 4–6 puzzles with known solver
   failures (Gemma prose non-answers ideal) + 2–3 correct ones; score judge on both axes.
   Gates all future gap measurements.
2. **Baseline subset on two defaults** (~$3, ~30 min): `eval-matrix.ts --harness direct-solve`
   stratified 8 on gpt-4o-mini + sonnet-4.5. First schema-tax artifact + generates the
   `--baseline` file for capped runs.
3. **Timeout enforcement proof** (one test): stub server that never responds + short timeout;
   confirm failure in ~timeout. Unexplained 50-min PZL-0001 hang vs 10-min timeout.
   Required before any long local run.
4. **Local subset on Qwen** — DONE 2026-09-07 (raw: eval/results/2026-09-07T14-39-36-024Z.json):
   1/5 with local caps; 4 of 8 puzzles flipped vs the identical 2026-09-06 run. Non-problems
   stable; all else is latency variance. Local runs need local-anchored caps. Framework held
   throughout (caps fired, no key needed, no crashes).
5. **Schema-tax attack**: staged extraction (ADR-009, staged-single-shot harness) already
   built; local pilot 0/3 exposed cross-stage interface failures (naming, entity-indexing,
   missing glue) — needs prompt hardening or critic-loop, not more single-shot coverage.
   Gemma 0/2 remains the lower bound.
6. **Full matrix** (~$47): only after judge calibration on known-wrongs + one harness
   improvement.

Decision rule: gap large on local (latency, not reasoning) → schema/payload work dominates;
local coverage beyond the subset is not worth repeating until per-call payloads shrink.
