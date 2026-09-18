---
id: ADR-011
title: String-Equivalence Matching for Grading and Ground-Truth Scoring
status: proposed
rfcs: [RFC-001, RFC-003, RFC-004]
created: 2026-09-18
specs: [specs/007-string-equivalence-matching]
---

# ADR-011: String-Equivalence Matching for Grading and Ground-Truth Scoring

## 1. Context

Every puzzle in this project has a known-correct answer or a known-correct set of domains, and
verifying an LLM's output against that ground truth means comparing strings the model chose to
write against strings someone else already recorded. Those strings can differ in ways that are
semantically identical but textually distinct: case and separator conventions
(`hardcover_book_set` vs. "hardcover book set"), a qualifier or plural ("game move" vs. "move"),
or a genuine synonym ("action" vs. "move" for the same rock-paper-scissors concept). A comparison
that requires exact equality rejects all of these; a comparison that accepts anything "close
enough" risks silently passing a wrong answer.

Five separate mechanisms in this codebase currently attempt some form of tolerant string
comparison, built independently at different times with no shared code or data:

- `src/compiler/compile.ts`'s `sanitizeIdentifier` plus `src/eval/grader.ts`'s `comparisonKey`
  fold case and separator conventions deterministically — no data file, always applied first.
- `eval/aliases.json`, a hand-curated `canonical -> [variants]` table, consumed through
  `grader.ts`'s `normalizeToken` by every determinate-answer grading function
  (`gradeDeterminate`, `gradeSubset`, `gradeFlatRecord`, `gradeRowKeyedMapping`,
  `gradeParallelArrays`). It carries one entry today.
- Two independent copies of a `loadAliases()` function (`scripts/eval-extraction.ts` and
  `design/spikes/SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts`) reading that
  same file — duplicated loading code, not a second mechanism.
- `DomainAlternative.names` (`design/spikes/SPIKE-013-vocabulary-construction-isolation/scripts/lib/ground-truth.ts`),
  a hand-curated list of acceptable domain-NAME synonyms stored per puzzle in that puzzle's own
  `catalog/puzzles/*.md` front-matter (e.g. PZL-0001 accepts both "cigarette" and "smoke" as the
  same domain; PZL-0011 accepts "outcome" and "decision"). This is a structurally distinct data
  model from the alias table above — it names acceptable spellings of a *domain*, not of an
  *answer value* — and neither the production grader nor the alias table's loader ever reads it.
- Two independent fuzzy fallbacks, each built to cover a gap the mechanisms above left open, and
  each never persisting what it found: `design/spikes/SPIKE-013-vocabulary-construction-isolation/scripts/lib/semantic-match.ts`'s
  `embeddingSemanticMatch` (real sentence-embedding cosine similarity, threshold 0.6) and
  `SPIKE-015`'s `scripts/lib/score-domain-match.ts` `nameResembles` function (substring
  containment in either direction), built in this project's current session specifically because
  strict equality rejected "game move"/"game moves" against ground truth's "move." That file
  lives on the `spike/015-domain-substitution` branch, not yet merged to `main` as of this ADR —
  the path is not resolvable from this branch's own tree; cited here as design-time context, not
  a claim this branch can verify. That same spike's own findings recorded that substring
  containment does not close a further gap it found immediately afterward — "action"/"game"
  against "move" share no substring relationship at all — and proposed a hand-curated alias list
  as the fix, independently arriving at the same pattern the alias table above already uses.

Two spikes, built in different sessions with no shared code, independently hit the same wall and
independently reached for the same kind of fix. That convergence is the signal that this is one
recurring problem wearing five different implementations, not five unrelated ones — worth a
shared decision rather than a sixth local patch.

RFC-004's own ADR-007 §2.2 already decided this question once, for the production grader
specifically: normalize deterministically, then look up an exact, versioned, logged alias table,
and explicitly rejected fuzzy matching as the live mechanism ("fuzzy matching trades false
MISMATCHes for silent false MATCHes with no audit trail"). That decision never extended to
ground-truth domain-name matching (RFC-001's catalog-modification scoring, RFC-003's vocabulary-
construction scoring) because neither existed yet when ADR-007 was written — SPIKE-013 and
SPIKE-015 rediscovered the same problem later, in a part of the codebase ADR-007 never reached.

## 2. Decision

### 2.1 Keep the deterministic fold as the first, free layer — and close its one predictable gap

`sanitizeIdentifier` and `comparisonKey` stay exactly as they are for case, whitespace, and
separator conventions — global, computed, no data file, applied before any table lookup.
Together they already fold `"Hardcover Book Set"`, `"hardcover-book-set"`, and
`"HardcoverBookSet"` to one identical key before anything else runs.

Plain pluralization ("moves" vs. "move") is a distinct gap this fold does not close, and unlike
genuine synonym variance (§2.3), it is mechanically predictable rather than open-ended — folding a
plural to its singular is a general rule, not a per-value fact that needs curating. It belongs in
the deterministic fold itself, applied unconditionally the same way case-folding already is, not
in the alias table or the curation-assist path below.

Built as a real, dictionary/rule-based lemmatizer (`wink-lemmatizer`'s `lemmatize.noun`), not a
hand-rolled suffix-strip regex. A first implementation attempt used a bare trailing-`s` regex
(strip one `s` when the stem was ≥3 characters and not `ss`) and was caught by code review before
merge: it collapsed unrelated real words together whenever one was "the other plus a trailing s"
(`"news"`/`"new"`, `"lens"`/`"len"`), and it missed the common `-es` sibilant plural entirely
(`"buses"`/`"bus"` stayed distinct) — both exactly the failure modes a dictionary-aware lemmatizer
avoids, verified directly against the real library before adopting it (see
`specs/007-string-equivalence-matching/research.md` Decision 4). The known residual risk: a
lemmatizer can still fold a proper noun that merely *looks* pluralizable but isn't (e.g.
`"Chesterfields"` → `"chesterfield"`, a real catalog brand name). Accepted because it only matters
if a puzzle's own vocabulary has a competing singular value to collide with, which none observed
so far does — not a proof of safety, an evidenced absence of harm.

### 2.2 One shared matching module, two separately-scoped alias tables

`src/eval/grader.ts`'s existing `normalizeToken`/`comparisonKey`/`AliasTable` already are the
generic shared primitive this decision calls for — they take any `AliasTable` as a parameter
rather than hardcoding `eval/aliases.json`, and are already tested. They stay exactly where they
are; the implementation does not relocate or duplicate them (see
`specs/007-string-equivalence-matching/research.md` Decision 1 for why introducing a second,
parallel comparison function was rejected once this was confirmed).

A new module, `src/eval/aliases.ts`, exports the ONE loader for `eval/aliases.json` — replacing
the two duplicated `loadAliases()` bodies — plus a convenience wrapper for callers who only need
a boolean rather than `normalizeToken`'s richer `{normalized, aliasApplied}` shape:

```ts
export async function loadAnswerValueAliases(): Promise<AliasTable>
export function stringsMatch(a: string, b: string, aliases: AliasTable = {}): boolean
```

`stringsMatch` composes the existing fold (§2.1) with an exact lookup against whichever table
it's given, by calling `normalizeToken` on both sides and comparing the results — no new
comparison logic, only a convenience call shape. A caller needing the audit-trail metadata
(FR-007) calls `normalizeToken` directly (re-exported from `src/eval/aliases.ts` for
convenience) rather than `stringsMatch`, which intentionally discards it.

The underlying DATA stays split by scope, because the two kinds of alias mean different things:

- **Answer-value aliases** (`eval/aliases.json`) are global — "hardcover book set" means the same
  thing regardless of which puzzle states it, so one shared, versioned file is correct.
- **Domain-name aliases** (`DomainAlternative.names`) are puzzle-specific — "move" being an
  acceptable name for PZL-0003's rock-paper-scissors choice says nothing about what any other
  puzzle's domain is called, so flattening these into one global table would let an alias
  legitimate in one puzzle's context leak into an unrelated puzzle's. They stay in each puzzle's
  own catalog front-matter, already the established location per `catalog/README.md`'s
  `groundTruth` field — this decision changes how that data is CONSUMED (through the same
  `resolvesToAlias` function every other alias check uses), not where it lives.

Every consumer this decision actually migrates — the production grader, plus any later spike
facing the same problem — calls into this one module instead of re-deriving comparison logic
locally. `SPIKE-013`'s vocabulary scoring and `SPIKE-015`'s domain-name scoring are NOT migrated
by this decision (see §4 Consequences and the resolved specification clarification in
`specs/007-string-equivalence-matching/spec.md`) — they keep their own independent heuristics
until a separate, deferred piece of follow-up work migrates them.

### 2.3 Fuzzy matching is a curation aid, never a live decision

`embeddingSemanticMatch` and `nameResembles` — or an LLM-judge variant either could be replaced
with — stop being called inline as part of a live grading or scoring decision. Retained only as
an offline tool that proposes candidate alias-table entries for a human to review and commit,
they extend ADR-007 §3's already-accepted reasoning (no silent promotion, every alias application
logged and auditable) to every consumer of `resolvesToAlias`, not only the production grader.

Levenshtein (edit) distance belongs in this same curation-assist bucket, as a second, cheaper
signal alongside embeddings and LLM-judge checks — cheap because it needs no external API call,
and more legible to a human reviewer than a cosine-similarity score (an edit-distance count is a
concrete, checkable fact, not an opaque number). It is not promoted to a live match despite being
deterministic: these are LLM-generated values, not human-typed ones, so the character-level typos
edit distance is built to catch are a narrow slice of the actual variance seen (synonym choice,
not fat-fingering); and puzzle domain values are frequently short words (3-8 characters) where a
small edit distance often separates two genuinely different values (`Red`/`Bed`, `Rock`/`Sock`)
rather than one value from its own misspelling — the same short-string risk that already argues
against trusting embedding similarity live.

## 3. Alternatives Considered

- **Leave each spike to solve this locally as it comes up.** Rejected: it already happened twice
  independently (SPIKE-013's embedding fallback, SPIKE-015's substring fallback) with zero shared
  benefit between them, and both converged on wanting the same fix. The cost of the duplication
  compounds with every new spike that touches ground-truth or answer matching.
- **Merge answer-value and domain-name aliases into one flat global table.** Rejected: a
  domain-name synonym is only valid within the puzzle that defines it; a flat table would let an
  alias accepted for one puzzle's domain silently apply to an unrelated value in a different
  puzzle.
- **Live embedding or LLM-judge matching as the primary, authoritative mechanism.** Rejected:
  already decided against for the production grader in ADR-007 §3 for the same reason (silent
  false matches, no audit trail, added cost and non-determinism) — this generalizes that
  precedent rather than reopening it, and both fuzzy fallbacks built independently since ADR-007
  landed reached the same conclusion once tested against real cases.
- **Live Levenshtein-distance matching (e.g. accept any pair within edit distance 1-2) as an
  authoritative layer, even though it is cheaper and more deterministic than embeddings.**
  Rejected for the same reason as the embedding case, not a weaker one: puzzle domain values are
  frequently short words where a small edit distance separates two genuinely different values
  (`Red`/`Bed`) as often as it separates a value from a real near-miss of itself, and these
  strings come from an LLM rather than a fallible human typist, so the character-level typo this
  distance is built to catch is a narrow slice of the variance actually observed.
- **A fully automatic self-growing table, with a fuzzy match writing directly into it without
  review.** Rejected: removes the audit trail ADR-007 explicitly values ("applying an alias is
  recorded... so no normalization is ever silent") and risks one bad automatic addition silently
  corrupting grading for every future puzzle sharing that token.
- **A hand-rolled trailing-`s`/`es` suffix-strip regex for the pluralization fold (§2.1).**
  Tried first, shipped, and rejected by code review before merge: verified live to collapse
  unrelated real words together (`"news"`/`"new"`, `"lens"`/`"len"`) and to miss the common
  `-es` sibilant plural entirely (`"buses"`/`"bus"`). A dictionary-aware lemmatizer avoids both
  failure modes by construction (it only accepts a fold that is itself a real word) rather than
  by tuning more regex exceptions.
- **A full general-purpose NLP library (e.g. `wink-nlp` with its POS-tagging model) for the
  pluralization fold.** Rejected as heavier than the problem needs: POS tagging is built for
  running text in sentence context, not the bare, isolated, often-invented-proper-noun tokens
  this project's grading actually normalizes, and it would add a multi-megabyte model dependency
  to a currently dependency-light module for a benefit `wink-lemmatizer`'s standalone,
  no-model, single-word lemmatizer already provides.

## 4. Consequences

- `SPIKE-015`'s `nameResembles` and `SPIKE-013`'s `embeddingSemanticMatch` are superseded as the
  live matching path once `stringsMatch`/`normalizeToken` exist — replacing their call sites is
  follow-up implementation work, not something this decision performs by itself.
- The two duplicated `loadAliases()` bodies (`scripts/eval-extraction.ts`,
  `design/spikes/SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/puzzles.ts`) collapse to
  one shared loader; both call sites need updating.
- No data migrates: `eval/aliases.json` keeps its current shape and content, and
  `DomainAlternative.names` keeps living in catalog front-matter — this decision changes the
  code path each is read through, not the data itself.
- A curation-assist tool that turns an embedding, LLM-judge, or Levenshtein-distance suggestion
  into a reviewable proposed alias-table entry is a natural next step this decision motivates but
  does not build. The pluralization fold itself (§2.1) IS built, via `wink-lemmatizer` — a new
  runtime dependency this decision's implementation adds, with the known residual risk §2.1
  documents.
- `eval/aliases.json` staying at one real entry, and `DomainAlternative.names` covering only a
  handful of puzzles, means the practical benefit of this consolidation grows as more entries get
  curated over time — this decision fixes the fragmentation, not the current sparseness of either
  table.

## 5. Related

- RFCs: RFC-001, RFC-003, RFC-004
- Specs: [specs/007-string-equivalence-matching](../../specs/007-string-equivalence-matching/spec.md)
