# Contract: Shared Alias-Matching API

This project is a library/CLI codebase, not a network service — the "contract" here is the
exported function surface future consumers (any grading or scoring script) call against.

## `src/eval/grader.ts` (existing, extended)

```ts
export type AliasTable = Record<string, readonly string[]>

export function normalizeToken(
  token: string,
  aliases: AliasTable,
): { readonly normalized: string; readonly aliasApplied: boolean }
// Unchanged signature for every existing caller (FR-009). `normalized` now folds case,
// underscore-separator, and (new) per-word pluralization via a dictionary-aware lemmatizer —
// never under synonym variance. `aliasApplied` is true only when a listed alias-table VARIANT's
// own fold matched the token, never when the token's fold merely equals the canonical's own fold.
//
// The per-word fold itself (comparisonKey) is a private, non-exported implementation detail of
// grader.ts — every consumer goes through normalizeToken (or stringsMatch below), never through
// comparisonKey directly.
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
