# Eval Framework Improvements — Plan (saved 2026-09-06)

Source of truth for implementation. Status: steps 1–3 in progress, 4–6 queued.

## Completed (branch `eval-framework-improvements`, commits up to `ed8f0f1`)

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
4. **Local subset on Qwen** (~1h, $0): 8-puzzle subset via local-single-shot with baseline caps.
5. **Schema-tax attack**: staged extraction or reduced-prompt harness variant; Gemma 0/2 is the
   lower bound; baseline-vs-extraction gap says where to aim.
6. **Full matrix** (~$47): only after 1–3 + one harness improvement.

Decision rule after 1–3: gap small → local coverage; gap large → schema work dominates.
