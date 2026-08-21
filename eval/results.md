# Extraction Eval Results

Append-only log — newest run at the bottom. Raw per-puzzle detail (extracted CSP, compiled
MiniZinc, solver output, and comparison detail) for every run lives in the gitignored
`eval/results/<run-id>.json`; this file is the committed, human-readable summary only.
Produced by `scripts/eval-extraction.ts` (`pnpm eval` or `node scripts/eval-extraction.ts`).

**Legend:** `MATCH`/`MISMATCH` require `solve()` to report `UniquelySolvable`, then compare its
assignment against `eval/answer-keys.json` via `flatten`/`compareAnswer` (see the script's header
comment for the exact algorithm and its known limitation). For puzzles whose answer is a set of
parallel arrays — PZL-0001, PZL-0002, PZL-0006, PZL-0008, PZL-0010 — this verifies vocabulary only, not
pairing or ordering; treat a `MATCH` there as "uniquely solved, used the right values," not a full
correctness proof.

---

## 2026-08-19T16:57:31Z — commit `563629b`

Model: `openai/gpt-4o-mini (default)` (frontier: `anthropic/claude-sonnet-4.5 (default)`) · 1 puzzles · pass rate **0/1 (0%)**

| Puzzle | Outcome |
|---|---|
| PZL-0003 | EXTRACT_FAILED (CriticRejected, 6 attempts) |

Full detail: `eval/results/2026-08-19T16-57-31-451Z.json`

---

## 2026-08-19T16:58:59Z — commit `563629b`

Model: `openai/gpt-4o-mini (default)` (frontier: `anthropic/claude-sonnet-4.5 (default)`) · 14 puzzles · pass rate **1/14 (7%)**

| Puzzle | Outcome |
|---|---|
| PZL-0001 | COMPILE_FAILED (Could not find a single numeric positional domain shared by "color=green" and "c) |
| PZL-0002 | MATCH |
| PZL-0003 | EXTRACT_FAILED (CriticRejected, 6 attempts) |
| PZL-0004 | MISMATCH |
| PZL-0005 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0006 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0007 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0008 | COMPILE_FAILED (Unknown variable "top-left.value" — no matching domain declared.) |
| PZL-0009 | EXTRACT_FAILED (CriticRejected, 6 attempts) |
| PZL-0010 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0011 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0012 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0013 | SOLVE_ERROR (ModelSyntaxError) |
| PZL-0014 | EXTRACT_FAILED (SchemaViolation) |

Full detail: `eval/results/2026-08-19T16-58-59-701Z.json`

---

## 2026-08-19T17:49:59Z — commit `563629b`

Model: `openai/gpt-4o-mini (default)` (frontier: `anthropic/claude-sonnet-4.5 (default)`) · 14 puzzles · pass rate **0/14 (0%)**

| Puzzle | Outcome |
|---|---|
| PZL-0001 | COMPILE_FAILED (Variable "color" is entity-indexed but no entity was given.) |
| PZL-0002 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0003 | EXTRACT_FAILED (CriticRejected, 6 attempts) |
| PZL-0004 | MISMATCH |
| PZL-0005 | SOLVE_ERROR (ModelSyntaxError) |
| PZL-0006 | MISMATCH |
| PZL-0007 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0008 | MISMATCH |
| PZL-0009 | COMPILE_FAILED (Unrecognized adjacency relation "immediately_before".) |
| PZL-0010 | EXTRACT_FAILED (CriticRejected, 6 attempts) |
| PZL-0011 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0012 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0013 | MISMATCH |
| PZL-0014 | EXTRACT_FAILED (ProviderError) |

Full detail: `eval/results/2026-08-19T17-49-59-491Z.json`

---

## 2026-08-19T18:19:49Z — commit `563629b`

Model: `openai/gpt-4o-mini (default)` (frontier: `anthropic/claude-sonnet-4.5 (default)`) · 4 puzzles · pass rate **2/4 (50%)**

| Puzzle | Outcome |
|---|---|
| PZL-0004 | MATCH |
| PZL-0006 | MISMATCH |
| PZL-0008 | MATCH |
| PZL-0013 | EXTRACT_FAILED (SchemaViolation) |

Full detail: `eval/results/2026-08-19T18-19-49-208Z.json`

---

## 2026-08-19T18:22:37Z — commit `563629b`

Model: `openai/gpt-4o-mini (default)` (frontier: `anthropic/claude-sonnet-4.5 (default)`) · 14 puzzles · pass rate **3/14 (21%)**

| Puzzle | Outcome |
|---|---|
| PZL-0001 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0002 | MATCH |
| PZL-0003 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0004 | MATCH |
| PZL-0005 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0006 | MISMATCH |
| PZL-0007 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0008 | MATCH |
| PZL-0009 | COMPILE_FAILED (Unrecognized adjacency relation "immediately_before".) |
| PZL-0010 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0011 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0012 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0013 | SOLVE_ERROR (ModelSyntaxError) |
| PZL-0014 | MISMATCH |

Full detail: `eval/results/2026-08-19T18-22-37-395Z.json`

---

## 2026-08-19T18:33:07Z — commit `563629b`

Model: `openai/gpt-4o-mini (default)` (frontier: `anthropic/claude-sonnet-4.5 (default)`) · 14 puzzles · pass rate **2/14 (14%)**

| Puzzle | Outcome |
|---|---|
| PZL-0001 | COMPILE_FAILED (Variable "color" is entity-indexed but no entity was given.) |
| PZL-0002 | MATCH |
| PZL-0003 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0004 | EXTRACT_FAILED (ProviderError) |
| PZL-0005 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0006 | MISMATCH |
| PZL-0007 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0008 | MATCH |
| PZL-0009 | COMPILE_FAILED (Could not find a single numeric positional domain shared by "Chen" and "Deepak" ) |
| PZL-0010 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0011 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0012 | EXTRACT_FAILED (SchemaViolation) |
| PZL-0013 | COMPILE_FAILED (Unknown variable "vegan_friendly" — no matching domain declared.) |
| PZL-0014 | MISMATCH |

Full detail: `eval/results/2026-08-19T18-33-07-176Z.json`

---

## 2026-08-20T13:31:39Z — commit `d835ca5`

Model: `openai/gpt-4o-mini (default)` (frontier: `anthropic/claude-sonnet-4.5 (default)`) · 1 puzzles · pass rate **0/1 (0%)**

| Puzzle | Outcome |
|---|---|
| PZL-0001 | SOLVE_MULTIPLY_SATISFIABLE |

Full detail: `eval/results/2026-08-20T13-31-39-912Z.json`

---

## 2026-08-20T13:33:11Z — commit `d835ca5`

Model: `openai/gpt-4o-mini (default)` (frontier: `anthropic/claude-sonnet-4.5 (default)`) · 1 puzzles · pass rate **1/1 (100%)**

| Puzzle | Outcome |
|---|---|
| PZL-0002 | MATCH |

Full detail: `eval/results/2026-08-20T13-33-11-333Z.json`

---

## 2026-08-20T21:16:29Z — commit `e9d1206`

Model: `openai/gpt-4o-mini (default)` (frontier: `anthropic/claude-sonnet-4.5 (default)`) · 14 puzzles · pass rate **5/14 (36%)**

| Puzzle | Outcome |
|---|---|
| PZL-0001 | EXTRACT_FAILED (CriticRejected, 6 attempts) |
| PZL-0002 | MATCH |
| PZL-0003 | EXTRACT_FAILED (CriticRejected, 5 attempts) |
| PZL-0004 | MATCH |
| PZL-0005 | MATCH |
| PZL-0006 | MISMATCH |
| PZL-0007 | MATCH |
| PZL-0008 | EXTRACT_FAILED (ProviderError) |
| PZL-0009 | SOLVE_MULTIPLY_SATISFIABLE |
| PZL-0010 | EXTRACT_FAILED (CriticRejected, 6 attempts) |
| PZL-0011 | COMPILE_FAILED (Unknown variable "priya_credit_score" — no matching domain declared.) |
| PZL-0012 | MATCH |
| PZL-0013 | COMPILE_FAILED (linkedAttributes requires entity-indexed variables; entityType "decision" has on) |
| PZL-0014 | MISMATCH |

Full detail: `eval/results/2026-08-20T21-16-29-386Z.json`
