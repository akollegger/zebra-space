# Feature Specification: Shared String-Equivalence Matching

**Feature Branch**: `016-string-equivalence-matching`

**Created**: 2026-09-18

**Status**: Draft

**Input**: User description: "Shared string equivalence matching as described in @design/adr/ADR-011-shared-string-equivalence-matching.md"

**Derived From**: ADR-011 (design/adr/ADR-011-shared-string-equivalence-matching.md)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Trust a MATCH/MISMATCH verdict without a false rejection (Priority: P1)

A maintainer runs the eval harness against a puzzle and needs to know whether the model's
answer is actually right — not right in spirit but rejected because it spelled a value
differently than the recorded answer key (case, spacing, or separator convention). Today this
tolerance exists only inside the production grader; a maintainer scoring anything else (a
puzzle's domain vocabulary, say) gets no such tolerance unless someone happens to have built it
for that specific script.

**Why this priority**: A false MISMATCH from spelling variance alone, not a real error, has
already cost real debugging time in this project (SPIKE-014 §5.7's grader-fix investigation) —
and it recurred in a second, unrelated context (SPIKE-015's domain-name scoring) with no shared
fix available to reach for.

**Independent Test**: Feed a known correct answer, spelled two different ways (e.g.
`"hardcover book set"` vs. `"book_set"`), through both the production grader and a
domain-name-matching scoring path; both report a match, and both report it through the same
underlying comparison logic rather than two separately-maintained implementations.

**Acceptance Scenarios**:

1. **Given** a model's answer that differs from the recorded answer only in case, whitespace,
   or separator convention, **When** the grader compares them, **Then** it reports a match.
2. **Given** the same kind of spelling variance in a domain-name comparison (not an answer-value
   comparison), **When** that comparison runs, **Then** it also reports a match, using the same
   underlying comparison logic the grader uses — not a separately-written heuristic.
3. **Given** a genuinely different value (not a spelling variant of the correct one), **When**
   either comparison runs, **Then** it reports no match.

---

### User Story 2 - Reuse the same matching logic when building a new scoring script (Priority: P2)

A maintainer building a new puzzle-scoring or vocabulary-scoring script needs to compare a
model's chosen name or value against a known-correct one, tolerant of spelling variance. Today
that means either accepting exact-match-only (rejecting valid answers) or writing a new,
one-off comparison heuristic — which is exactly how two independent, incompatible heuristics
(a substring check, an embedding-similarity check) already got built for the same underlying
problem.

**Why this priority**: Directly prevents the recurring cost this project has already paid twice
— rebuilding the same tolerant-comparison logic from scratch in a new context, each time in a
way the next context can't reuse.

**Independent Test**: Write a new comparison call using only the shared matching logic (no new
heuristic code), and confirm it correctly matches a known spelling-variant pair and correctly
rejects a known genuinely-different pair, without needing any puzzle-specific or script-specific
adjustment.

**Acceptance Scenarios**:

1. **Given** a maintainer needs tolerant string comparison in a new context, **When** they look
   for how to do it, **Then** exactly one shared mechanism exists to call, not several
   candidates with different behavior.
2. **Given** that shared mechanism is called with a candidate/canonical pair and a table of
   known acceptable variants, **When** the candidate is a known variant, **Then** it reports a
   match; **when** it is not, **Then** it reports no match — with no fuzzy/approximate step in
   between that could silently pass a wrong answer.

---

### User Story 3 - Grow the list of acceptable variants without losing the audit trail (Priority: P3)

A maintainer reviewing eval or scoring results notices a model's answer was rejected for what
looks like a reasonable spelling or naming variant, and wants to add it to the known-acceptable
list going forward — without that addition ever having been silently applied to a past or
future comparison before a person actually approved it.

**Why this priority**: This is what keeps the growing list of acceptable variants trustworthy
as it grows — the alternative (an automatic similarity check silently deciding matches) has
already been rejected once for the production grader (ADR-007 §3) for exactly this reason, and
re-introducing it anywhere would quietly undermine every verdict downstream of it.

**Independent Test**: Confirm that a similarity-based signal (however it is produced) never by
itself changes a comparison's match/no-match outcome — it can only ever appear as a suggestion
a maintainer reviews and explicitly accepts before it affects any future comparison.

**Acceptance Scenarios**:

1. **Given** two strings that a similarity signal considers close, **When** no maintainer has
   reviewed and approved that pair, **Then** a live comparison between them still reports no
   match.
2. **Given** a maintainer approves a suggested variant, **When** the same comparison runs again
   afterward, **Then** it reports a match — and the change is visible as an explicit addition to
   the known-acceptable list, not a silent behavior change.

---

### Edge Cases

- What happens when a candidate string's value matches a real domain's known values exactly, but
  the name given for that domain doesn't match any known acceptable name at all? The comparison
  must report this as a distinct, informative outcome (values matched, name did not) rather than
  the same undifferentiated "no match" as a candidate that matches nothing at all.
- What happens when the same word is a legitimate value for one puzzle's domain but happens to
  also resemble an unrelated value or domain name in a different puzzle? A match found for one
  puzzle's own known-acceptable variants must never apply to a different puzzle's comparison.
- What happens when a similarity signal suggests a variant that is actually wrong (two genuinely
  different concepts that happen to look alike)? It must be rejected during review and never
  reach the live comparison path at all — the review step exists precisely to catch this.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide one shared comparison mechanism, usable from any grading
  or scoring context, that determines whether a candidate string represents the same value or
  domain name as a canonical string.
- **FR-002**: The shared comparison mechanism MUST tolerate case, whitespace, and separator
  (e.g. hyphen vs. underscore vs. space) differences without requiring a curated entry for each
  variant.
- **FR-003**: The shared comparison mechanism MUST support checking a candidate against a
  canonical string plus a table of known acceptable variants (an alias table), and MUST treat
  that check as exact once case/whitespace/separator differences are folded away — never
  approximate.
- **FR-004**: The system MUST maintain answer-value acceptable-variant data (e.g. "hardcover
  book set" / "book_set") as a single, shared resource usable by every consumer, never
  duplicated across more than one loading implementation.
- **FR-005**: The system MUST keep domain-name acceptable-variant data scoped to the individual
  puzzle it describes — an acceptable name for one puzzle's domain MUST NOT be treated as
  acceptable for an unrelated value or domain in a different puzzle.
- **FR-006**: The system MUST NOT allow a similarity-based signal (embedding similarity, edit
  distance, or model judgment) to determine a live grading or scoring match/no-match outcome by
  itself. Such a signal MAY only produce a suggested addition to the acceptable-variant data,
  which has no effect on any comparison until a maintainer explicitly reviews and accepts it.
- **FR-007**: The system MUST record, for every comparison where an acceptable-variant match
  applied, that it applied — so a passing comparison can always be traced to either an exact
  match or an explicit, named acceptable-variant entry, never to an unexplained pass.
- **FR-008**: The system MUST fold plain pluralization (e.g. a trailing "s"/"es") as part of its
  deterministic comparison step, without requiring a curated acceptable-variant entry for each
  singular/plural pair.
- **FR-009**: Existing production grading MUST continue to behave identically for every
  comparison it already handles correctly today — this consolidation MUST NOT change any
  currently-correct verdict.

### Key Entities

- **Acceptable-Variant Table (answer-value)**: A canonical answer value paired with every known
  acceptable alternate spelling of it. Global — applies the same way regardless of which puzzle
  states the value.
- **Acceptable-Variant List (domain-name)**: A set of acceptable names for one puzzle's own
  domain. Scoped to that one puzzle only.
- **Suggested Variant**: A candidate/canonical pair a similarity signal has proposed as an
  acceptable variant, awaiting a maintainer's review. Has no effect on any comparison until
  explicitly accepted.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A maintainer adding tolerant string comparison to a new scoring context writes
  zero new comparison logic — one call into the shared mechanism covers case, whitespace,
  separator, pluralization, and known-variant tolerance.
- **SC-002**: The number of independently-maintained implementations of "does this string mean
  the same thing as that string" across the codebase drops from five to one.
- **SC-003**: Every comparison that reports a match can be traced to either an exact fold-match
  or a specific, named entry in an acceptable-variant table — never to an unexplained or
  unauditable pass.
- **SC-004**: A previously-fixed false-rejection case (a correct answer rejected only for its
  spelling convention) continues to be accepted after this change, with no regression.
- **SC-005**: A naming variant that previously required its own one-off heuristic to accept
  (e.g. a qualifier word or plain plural on a domain name) is accepted through the shared
  mechanism instead, with no case- or script-specific code written to handle it.

## Assumptions

- "Users" of this feature are the project's maintainers and spike authors — this is internal
  grading/scoring infrastructure, not an end-user-facing feature.
- Retrofitting already-concluded spikes (SPIKE-013, SPIKE-015) to call the new shared mechanism
  is valuable but NOT required for this feature's delivery (resolved via clarification, option
  A): delivery is scoped to building the shared mechanism and migrating the production grader
  and the two duplicated `loadAliases()` loaders. Migrating SPIKE-013's `embeddingSemanticMatch`
  and SPIKE-015's `nameResembles` call sites is explicitly deferred as separate, optional
  follow-up work, tracked outside this feature.
- A curation-assist tool that turns a similarity signal into a reviewable suggestion, and a
  pluralization-stemming rule inside the deterministic fold, are both required by FR-006/FR-008
  above but their exact implementation approach is left to planning, not fixed here.
- No existing acceptable-variant data needs to move to a new location — this feature changes how
  that data is read and compared against, not where each kind of data lives.
