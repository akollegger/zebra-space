# Feature Specification: Deck YAML Format Library Support

**Feature Branch**: `005-deck-yaml-format`

**Created**: 2026-09-03

**Status**: Draft

**Derived From**: ADR-006 (design/adr/ADR-006-deck-yaml-format.md)

**Input**: User description: "Add library support for a \"deck yaml format\" as described in
design/adr/ADR-006-deck-yaml-format.md"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Author a deck and know it's structurally sound (Priority: P1)

A deck author writes a new deck as a YAML document (task brief, the underlying constraint
problem, cards, and a closing question) and needs to know, before the deck is ever played or
solved, whether it's internally consistent — every reference resolves, no dependency cycle traps
a card behind an unsatisfiable prerequisite.

**Why this priority**: Without this, every authoring mistake surfaces downstream (during solving,
or worse, during play) instead of at the point where it's cheap to fix. This is the load-bearing
guarantee the rest of the feature depends on.

**Independent Test**: Given a deck document with a deliberately broken reference (e.g. a card's
dependency naming a card id that doesn't exist) or a dependency cycle, loading it is rejected with
an explanation identifying the offending card, before any attempt to solve it.

**Acceptance Scenarios**:

1. **Given** a deck document where every card's dependency, domain, and constraint reference
   resolves to something that actually exists in the deck, **When** it is loaded, **Then** it is
   accepted as structurally valid.
2. **Given** a deck document where a card's dependency names a card id that isn't in the deck,
   **When** it is loaded, **Then** it is rejected with an explanation naming the missing
   reference and the card that made it.
3. **Given** a deck document where two or more cards' dependencies form a cycle, **When** it is
   loaded, **Then** it is rejected with an explanation identifying a card in the cycle.
4. **Given** a deck document where a card declares a tier other than the one currently supported,
   **When** it is loaded, **Then** it is rejected with an explanation naming the unsupported tier.

---

### User Story 2 - Solve a deck's underlying puzzle without writing a solver (Priority: P1)

Someone building on a validated deck (a game session, a preview tool, an automated check) needs
to know whether the deck's underlying puzzle has no solution, exactly one solution, or more than
one — without writing solving logic specific to that one deck.

**Why this priority**: This is the entire reason the format exists instead of continuing to write
a bespoke solver per deck (ADR-006 §3). It's independently valuable the moment a deck validates.

**Independent Test**: Given a validated deck whose underlying puzzle is known (by construction)
to have exactly one solution, solving it reports that outcome — using only the shared solving
capability, with no deck-specific code written to reach that answer.

**Acceptance Scenarios**:

1. **Given** a validated deck whose constraints, taken together, determine the grid uniquely,
   **When** it is solved, **Then** the outcome reports a single, specific solution.
2. **Given** a validated deck whose constraints admit more than one grid, **When** it is solved,
   **Then** the outcome reports that more than one solution exists, without claiming a specific
   answer.
3. **Given** a validated deck whose constraints are mutually contradictory, **When** it is
   solved, **Then** the outcome reports that no solution exists.

---

### User Story 3 - Get the closing answer and each card's standing, without hand-labeling either (Priority: P2)

Someone consuming a solved deck needs two more things a game loop (or any consumer) would
otherwise have to compute by hand: the specific answer the deck's closing question is asking for,
and, for every card, whether it establishes grounding, asserts a constraint, echoes another
card's constraint or grounding, or constrains nothing at all — all without the deck author having
hand-labeled any card with that classification.

**Why this priority**: This is what makes a deck author's job pure content authoring (ADR-006
§2.3) rather than also requiring them to maintain classification metadata that can drift out of
sync with what a card actually says. It depends on User Story 2's solved outcome.

**Independent Test**: Given a uniquely solved deck, the closing question's answer is produced by
reading the solution, and every card's classification is produced by inspecting only what each
card references and its position among cards referencing the same thing — never by reading a
hand-authored label.

**Acceptance Scenarios**:

1. **Given** a uniquely solved deck and its closing question's definition, **When** the answer is
   requested, **Then** the specific entity (or value) the question asks for is returned.
2. **Given** a deck where a card establishes no grounding and asserts no constraint, **When**
   cards are classified, **Then** that card is classified as constraining nothing.
3. **Given** a deck where two cards both assert the same underlying constraint, **When** cards
   are classified, **Then** the card that appears first is classified as that constraint's primary
   presentation and the other as an echo of it — regardless of which one reads as more "important"
   in isolation.
4. **Given** a deck where two cards both establish the same underlying domain fact, **When** cards
   are classified, **Then** the same first-appearance-wins rule applies as it does for constraints.

### Edge Cases

- What happens when a deck document is not well-formed data at all (e.g. malformed syntax), before
  any of this feature's own validation rules can even run?
- What happens when a deck's closing question names a condition that no entity in the solved grid
  actually satisfies?
- What happens when a deck's closing question's condition is satisfied by more than one entity in
  the solved grid?
- What happens when a deck is requested to be solved before it has passed structural validation?
- What happens when a deck declares a constraint using a shape outside the supported vocabulary?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST accept a deck document containing a task brief, the underlying
  constraint problem (entities, domains, and constraints), a set of cards, and a closing
  question, and represent it as a single structured deck ready for validation.
- **FR-002**: System MUST validate, for every card, that each reference it makes — to another
  card (its dependency), to a domain or entity it establishes, or to a constraint it asserts —
  resolves to something that actually exists elsewhere in the same deck, and MUST reject the deck
  with an explanation identifying the offending card and reference when one doesn't.
- **FR-003**: System MUST validate that cards' dependencies form no cycle, and MUST reject the
  deck with an explanation identifying a card in the cycle when one exists.
- **FR-004**: System MUST reject a deck that declares a card tier other than the one currently
  supported, or a constraint using a shape outside the supported vocabulary, with an explanation
  naming what was unsupported.
- **FR-005**: System MUST classify every card in a validated deck — as establishing grounding,
  asserting a constraint, echoing an already-claimed grounding fact or constraint, or
  constraining nothing — using only what the card references and its position relative to other
  cards referencing the same thing, without requiring or reading any hand-authored classification
  on the card itself.
- **FR-006**: System MUST make a validated deck's underlying constraint problem solvable by the
  project's existing solving capability, without requiring any deck-specific solving code to be
  written.
- **FR-007**: System MUST report, for a validated deck, whether its underlying constraint problem
  has no solution, exactly one solution, or more than one solution.
- **FR-008**: System MUST, for a deck whose underlying constraint problem has exactly one
  solution, produce the specific answer to its closing question by locating the entity that
  satisfies the closing question's stated condition in that solution.
- **FR-009**: System MUST report a clear, specific failure — not a silent or generic one — when a
  deck's closing question's condition is satisfied by zero or by more than one entity in the
  solution.

### Key Entities

- **Deck**: A single authored unit — a task brief, an underlying constraint problem, an ordered
  set of cards, and a closing question. The unit this feature loads, validates, and solves.
- **Card**: One presentation, within a deck, of zero or more references into the deck's
  underlying constraint problem — what it establishes and what it asserts — plus the material
  shown to a player before and after it's opened.
- **Underlying constraint problem**: The entities, their attribute domains, and the constraints
  among them that a deck's cards collectively reveal — the thing that is actually solved.
- **Closing question**: The deck's declared question and the condition that identifies its answer
  once the underlying constraint problem is solved.
- **Card classification**: The derived standing of a card — grounding-establishing,
  constraint-asserting, an echo of another card's claim, or noise — computed from what it
  references, never authored directly.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every deck with a dangling reference, a dependency cycle, an unsupported tier, or an
  unrecognized constraint shape is rejected before any attempt is made to solve it.
- **SC-002**: A new deck can be added using only a content document — no new code is written to
  make that deck's underlying puzzle solvable or its closing question answerable.
- **SC-003**: For any validated, uniquely-solvable deck, the closing question's answer and every
  card's classification are produced with no manual, deck-specific classification step.
- **SC-004**: Two decks that assert the same fact through different cards (in different voices)
  are classified consistently — the same first-appearance rule applies whether the shared fact is
  a constraint or a piece of domain grounding.

## Assumptions

- A deck document's raw syntax is well-formed; this feature's validation rules (FR-002 through
  FR-004) are semantic checks that run on already-parseable data, not a syntax checker.
- Only the currently supported card tier is in scope; decks declaring any other tier are rejected
  outright rather than partially supported (ADR-006 §4 — no defined behavior exists for them
  yet).
- Cards with a modality other than plain text, and decks whose closing question is "the request
  itself is unanswerable" rather than a grid answer, are out of scope — ADR-006 §4 defers both.
- This feature produces the data a game loop would need (validity, solved outcome, the closing
  answer, card classifications) but does not itself implement session scoring, a per-swipe
  incremental solve, or any presentation/UI concern — those are separate, already-tracked pieces
  of work (RFC-005 §5.3, §5.7).
- The existing solving capability (already able to report no-solution / unique-solution /
  multiple-solution outcomes) is reused as-is; this feature does not modify or extend it.
- Maintaining a catalog-wide index of decks is a separate concern from this feature, which is
  scoped to loading, validating, solving, and answering one deck at a time.
