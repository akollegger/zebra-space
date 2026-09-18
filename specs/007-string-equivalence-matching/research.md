# Phase 0 Research: Shared String-Equivalence Matching

## Decision 1: Reuse and relocate `normalizeToken`, not invent a parallel function

**Decision**: The shared comparison primitive ADR-011 §2.2 calls for already exists —
`src/eval/grader.ts`'s `normalizeToken(token: string, aliases: AliasTable)` already composes
`sanitizeIdentifier` + `comparisonKey` + an exact alias-table lookup, and already takes `aliases`
as a parameter rather than hardcoding `eval/aliases.json`. It is generic today; it is simply
unused outside the grader. This plan keeps it and its supporting `comparisonKey`/`AliasTable`
in `grader.ts` (their existing, tested home) rather than duplicating them into a new module, and
adds one small convenience wrapper, `stringsMatch(a, b, aliases)`, for callers who only need a
boolean rather than `normalizeToken`'s `{normalized, aliasApplied}` shape.

**Rationale**: `tests/eval/grader.test.ts` already covers `normalizeToken` thoroughly (integer
passthrough, identifier fold, alias resolution, cross-convention convergence). Relocating it
would mean moving tested code for no behavioral gain; adding a second, differently-shaped
function (e.g. ADR-011's illustrative `resolvesToAlias(candidate, canonical, aliases): boolean`)
would reintroduce exactly the "two things that do the same job" problem this feature exists to
close.

**Alternatives considered**: A brand-new `src/eval/alias-match.ts` module wrapping fresh logic —
rejected once `normalizeToken`'s existing shape was checked directly; it already satisfies
FR-001-FR-003 without new code, only new call sites.

## Decision 2: One consolidated loader lives in a new, single-purpose file

**Decision**: `src/eval/aliases.ts` (new) exports `loadAnswerValueAliases(): Promise<AliasTable>`
— the one implementation of reading and parsing `eval/aliases.json`, replacing the two duplicated
`loadAliases()` bodies (`scripts/eval-extraction.ts`, SPIKE-008's `puzzles.ts`). It also exports
`stringsMatch` (Decision 1) so a consumer only needing the boolean check doesn't need to import
from `grader.ts` directly.

**Rationale**: `grader.ts` today has zero file I/O — it is a pure-function module, and its own
tests exercise it without touching disk. Adding a loader there would mix a new concern into an
already-tested, dependency-free module. A separate file keeps `grader.ts` exactly as it is
(other than the pluralization change, Decision 4) while still giving every consumer one place to
import both the loader and the convenience matcher from.

**Alternatives considered**: Add the loader directly to `grader.ts` — rejected for the reason
above. Leave both duplicated loaders in place and only add the new matching capability —
rejected: FR-004 and ADR-011 §4 both name the duplication itself as something this feature
closes, not something it works around.

## Decision 3: Migration scope is grader + loaders only (per resolved clarification)

**Decision**: This feature's implementation touches `src/eval/grader.ts`, the new
`src/eval/aliases.ts`, `scripts/eval-extraction.ts`, and
`design/spikes/SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts`. It does NOT
touch `design/spikes/SPIKE-013-vocabulary-construction-isolation/scripts/lib/semantic-match.ts`
or `design/spikes/SPIKE-015-domain-substitution/scripts/lib/score-domain-match.ts` — both keep
their own current heuristics unchanged, per spec.md's resolved clarification (option A).

**Rationale**: Already settled during `/speckit-specify`; recorded here so planning doesn't
silently expand scope back to the original ADR sketch's fuller "every consumer migrates" framing.

## Decision 4: Pluralization fold as one deterministic rule inside `comparisonKey`

**Decision**: `comparisonKey` gains a trailing `s`/`es` strip, applied unconditionally after the
existing lowercase/underscore-strip step, before the alias-table lookup runs. Example:
`comparisonKey("moves")` and `comparisonKey("move")` both yield `"move"`.

**Rationale**: FR-008 requires this to need no curated entry per singular/plural pair — a fixed
suffix rule is the deterministic, zero-data way to satisfy that, consistent with how case and
separator folding already work in the same function.

**Alternatives considered**: A general stemming library — rejected as disproportionate; the only
observed case (SPIKE-015 §5.2's "moves"/"move") is a plain plural, and a general stemmer risks
folding together words that are not actually the same concept (a risk this feature's whole point
is to avoid introducing). A curated per-value plural entry in the alias table — rejected: FR-008
explicitly asks for this NOT to need curation, since it's a general rule, not a per-value fact.

## Decision 5: No `effect` wrapping for this code

**Decision**: `stringsMatch`/`normalizeToken`/`comparisonKey` stay plain synchronous functions;
`loadAnswerValueAliases` stays a plain `async function` (matching the existing, unchanged
`loadAliases` it replaces), not an `Effect`.

**Rationale**: Constitution Principle II binds "puzzle generation and solving logic." Grading and
scoring infrastructure is neither — and the existing precedent this feature extends
(`grader.ts`'s own pure functions, `scripts/eval-extraction.ts`'s plain-async `loadAliases`) is
already written this way. Matching established precedent for this class of code is not a
deviation requiring justification.

## Remaining Technical Context

No NEEDS CLARIFICATION markers — the feature reuses this project's existing language, test
runner, and file layout unchanged; see `plan.md`'s Technical Context section.
