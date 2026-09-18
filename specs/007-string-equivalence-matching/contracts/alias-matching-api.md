# Contract: Shared Alias-Matching API

This project is a library/CLI codebase, not a network service — the "contract" here is the
exported function surface future consumers (any grading or scoring script) call against.

## `src/eval/grader.ts` (existing, extended)

```ts
export type AliasTable = Record<string, readonly string[]>

export function comparisonKey(sanitized: string): string
// Folds case, underscore-separator, and (new) trailing s/es pluralization.
// Guarantee: comparisonKey(x) === comparisonKey(y) implies x and y are the same value under
// case/whitespace/separator/pluralization variance alone — never under synonym variance.

export function normalizeToken(
  token: string,
  aliases: AliasTable,
): { readonly normalized: string; readonly aliasApplied: boolean }
// Unchanged signature and behavior for every existing caller (FR-009) — gains the pluralization
// fold as part of comparisonKey, and nothing else changes for a caller passing {} as aliases.
```

## `src/eval/aliases.ts` (new)

```ts
export async function loadAnswerValueAliases(): Promise<AliasTable>
// The ONE loader for eval/aliases.json. Replaces scripts/eval-extraction.ts's and
// SPIKE-008's puzzles.ts's own local loadAliases() bodies — both import this instead.

export function stringsMatch(a: string, b: string, aliases: AliasTable = {}): boolean
// Convenience: true iff normalizeToken(a, aliases).normalized === normalizeToken(b, aliases).normalized.
// The mechanism any new tolerant-comparison consumer (SC-001) should call — never a new
// case/whitespace/fuzzy heuristic written locally.
```

## Guarantees every consumer can rely on

1. **Deterministic and total**: for any two strings and any `AliasTable`, `stringsMatch` returns
   the same boolean every time — no network call, no model call, no randomness.
2. **No silent fuzzy promotion**: `stringsMatch`/`normalizeToken` never consult an embedding
   similarity score, edit distance, or model judgment. A caller wanting that kind of signal must
   build it separately and can never wire it into a live `stringsMatch` call (FR-006).
3. **Alias scope is caller-controlled**: passing a puzzle-specific `AliasTable` (e.g. built from
   that puzzle's `DomainAlternative.names`) never affects a different call with a different
   table — there is no global mutable alias state.
4. **Existing behavior preserved**: every case `tests/eval/grader.test.ts` already covers before
   this feature continues to pass unchanged (FR-009).
