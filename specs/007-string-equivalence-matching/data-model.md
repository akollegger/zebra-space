# Phase 1 Data Model: Shared String-Equivalence Matching

## AliasTable

Already exists (`src/eval/grader.ts`); unchanged shape.

```ts
type AliasTable = Record<string, readonly string[]>  // canonical -> acceptable variants
```

- **Scope**: global for answer-value data (`eval/aliases.json`) — one shared table, loaded once
  via `loadAnswerValueAliases()` (new, `src/eval/aliases.ts`).
- **Scope**: per-puzzle for domain-name data (`DomainAlternative.names`, unchanged, stays in each
  puzzle's `catalog/puzzles/*.md` front-matter). `DomainAlternative.names` is a flat
  `readonly string[]` (SPIKE-013's own shape), NOT already an `AliasTable` — a consumer builds a
  minimal single-entry `AliasTable` from it before calling `stringsMatch`/`normalizeToken`, e.g.
  `{ [names[0]]: names.slice(1) }` (first name as canonical, the rest as variants — any name in
  the list is an acceptable match for any other, so the specific choice of which name is
  "canonical" doesn't change the comparison result). This adapter step is a consumer's own
  responsibility; it is never merged into the global answer-value table (FR-005).
- **Invariant**: a canonical key's variants apply only within the table they're looked up
  against — an `AliasTable` built from one puzzle's `DomainAlternative.names` is never merged
  with `eval/aliases.json`'s global table.

## NormalizedToken (existing return shape, unchanged)

```ts
interface NormalizedToken {
  readonly normalized: string
  readonly aliasApplied: boolean
}
```

Returned by `normalizeToken(token, aliases)`. `aliasApplied` is the audit-trail signal FR-007
requires — a caller can always tell whether a match came from the deterministic fold alone or
from a specific alias-table entry.

## New: `stringsMatch` result (implicit — boolean, no new type)

```ts
function stringsMatch(a: string, b: string, aliases: AliasTable = {}): boolean
```

Convenience wrapper: `normalizeToken(a, aliases).normalized === normalizeToken(b, aliases).normalized`.
No new data shape — a thin equality check over two `NormalizedToken.normalized` values. Exists
so a caller that only needs "do these match" doesn't need to know `normalizeToken`'s richer
shape.

## Conceptual (not implemented by this feature): Suggested Variant

Named in `spec.md`'s Key Entities as the shape a future curation-assist tool would produce — a
candidate/canonical pair a similarity signal proposes, with no effect on any comparison until a
maintainer reviews and adds it to an `AliasTable` by hand. No code models this yet; recorded here
only so a future feature extending this one has a fixed vocabulary to build against, per FR-006's
constraint (whatever eventually produces a suggestion, it must never itself become an
`AliasTable` entry without that manual step).

## Validation rules carried over from requirements

- FR-002/FR-008: `comparisonKey` folds case, whitespace/separator, and trailing `s`/`es` before
  any alias lookup runs — order matters, and this order is not configurable per call site.
- FR-003: alias lookup is exact once folded — no partial/fuzzy matching inside `normalizeToken`
  or `stringsMatch`.
- FR-009: every existing `grader.ts` caller's behavior is a regression-tested invariant, not a
  new rule — covered by re-running `tests/eval/grader.test.ts` unchanged plus new pluralization
  cases.
