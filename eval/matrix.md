# Eval Matrix Results

Per-puzzle × cell comparison tables for the comparative matrix (ADR-007 §2.3). Each run
appends one section: the cells executed, their pass rates, and the per-puzzle verdict grid.
Raw per-cell detail lives in the gitignored `eval/results/<run-id>.json` files referenced
per row; this file is the committed summary only. Runs stay sequential by default.

---

## 2026-09-06T18:58:00Z — commit `ed8f0f1`

| Model | Harness | Puzzles | Runs | Estimate |
|---|---|---|---|---|
| openai/gpt-4o-mini [cheap] | direct-solve | PZL-0002 PZL-0004 PZL-0022 PZL-0028 PZL-0033 PZL-0038 PZL-0015 PZL-0018 | 3 | ~$0.10 |
| anthropic/claude-sonnet-4.5 [frontier] | direct-solve | PZL-0002 PZL-0004 PZL-0022 PZL-0028 PZL-0033 PZL-0038 PZL-0015 PZL-0018 | 3 | ~$2.45 |

Skipped tiers:

| Model | Reason |
|---|---|
| openai/gpt-5-nano [cheap] | unverified — Cheapest named-vendor input in the catalog ($0.025/M in, $0.20/M out, 400k ctx). Subset cell ~$0.19. Needs a pilot: forced-tool-call schema reliability unproven. |
| deepseek/deepseek-v4-flash [cheap] | unverified — Leaderboard #3 by traffic (12.3T tokens). Pricing $0.08/M in, $0.16/M out, 1M ctx. Subset cell ~$0.18. Needs a pilot: forced-tool-call schema reliability unproven. |
| google/gemma-3-27b-it [cheap] | unverified — Open-weights cheap-tier comparator ($0.08/M in, $0.16/M out, 131k ctx). Subset cell ~$0.18. Needs a pilot: forced-tool-call schema reliability unproven. |
| openai/gpt-5-mini [mid] | unverified — Mid-tier lower bracket ($0.125/M in, $1.00/M out, 400k ctx). Tests whether the critic loop saturates below frontier. Subset cell ~$0.94. Needs a pilot. |
| anthropic/claude-haiku-4.5 [mid] | unverified — Mid-tier upper bracket ($1.00/M in, $5.00/M out, 200k ctx). Tests whether the critic loop saturates below frontier. Subset cell ~$4.90. Needs a pilot. |
| anthropic/claude-sonnet-4.6 [frontier] | unverified — Drop-in frontier comparison: identical pricing to sonnet-4.5 ($3.00/M in, $15.00/M out, 1M ctx, no overrides flag). Subset cell ~$14.69. Needs a pilot. |
| minimax/minimax-m3:free [free] | unverified — Leaderboard #5 by traffic (5.56T tokens), 1M ctx, tool support confirmed. Free-tier rate limits apply (~20 req/min, 200/day) — constrains but does not block a subset cell. Needs a pilot: schema-compat + pass frequency unverified. |
| nvidia/nemotron-3-ultra-550b-a55b:free [free] | unverified — Leaderboard #8 by traffic (3.65T tokens), 1M ctx, tool support confirmed. Free-tier rate limits apply. Needs a pilot: schema-compat + pass frequency unverified. |
| z-ai/glm-5.3-flash [cheap] | unverified — Default judge model for the direct-solve baseline (ADR-008). Pricing $0.075/M in, $0.25/M out (promo rate ending 2026-09-09; list $0.15/$0.50 — re-verify), 1.3M ctx, tool support confirmed. Pilot 2026-09-06: judged 2/2 correctly (PZL-0003, PZL-0004, solver gpt-4o-mini) after a judge-prompt fix for case fidelity ('paper' vs 'Paper' — grader is case-sensitive). Over-acceptance on fluent wrong answers still unmeasured. |
| local/stub-via-base-url-override [local] | unverified — Test-only route via ZEBRA_OPENROUTER_BASE_URL_OVERRIDE (stub server); $0 estimate still counts calls. For real local models use the qwen3.8 entry below. |
| google/gemma-4-26b-a4b-qat [local] | unverified — Local model via ZEBRA_LOCAL_BASE_URL. Pilot 2026-09-06: 0/2 single-shot (PZL-0003, PZL-0004), both SchemaViolation — prose instead of the forced tool call, failing fast (~50s each). Small-schema tool probe succeeds, so tool-calling works but does not hold at the full extraction schema's scale. Not viable for this pipeline without mitigations (simplified prompt/schema variant, grammar-enforced output). |
| qwen/qwen3.8-27b [local] | unverified — Local model via ZEBRA_LOCAL_BASE_URL (LM Studio OpenAI-compatible server). Pilot 2026-09-06: 2/2 MATCH single-shot (PZL-0004 in 94s, PZL-0003 in 859s) — schema-reliable on the full extraction schema, but ~1-14 min/puzzle. Requires ZEBRA_LOCAL_TIMEOUT_MS-scale timeouts (default 10 min). Run: --harness local-single-shot --model qwen/qwen3.8-27b. |
