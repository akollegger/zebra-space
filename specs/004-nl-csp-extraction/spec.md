# Feature Specification: Natural-Language Puzzle to Solvable CSP Extraction

**Feature Branch**: `003-nl-csp-extraction`

**Created**: 2026-08-19

**Status**: Draft

**Derived From**: ADR-003 (design/adr/ADR-003-cli-interface.md), ADR-004 (design/adr/ADR-004-llm-extraction-critic-loop.md), ADR-005 (design/adr/ADR-005-extractedcsp-mzn-compiler.md)

**Input**: User description: "The capability to extract a solvable CSP in Minizinc format from a natural language puzzle, like the ones in catalog/puzzles/, using an LLM and available as a CLI subcommand, per ADR-004 (LLM extraction with a fidelity critic loop), ADR-005 (ExtractedCsp to MiniZinc compiler), and the extract subcommand added to ADR-003 (CLI interface shape)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Turn a prose puzzle into a solvable model (Priority: P1)

A user has a puzzle written as natural-language prose (in the same style as the existing puzzle
catalog) and wants a ready-to-solve constraint model, without hand-translating the puzzle
themselves.

**Why this priority**: This is the core value of the feature — everything else supports or
protects this outcome. Without it, there is no capability at all.

**Independent Test**: Given a puzzle file from the existing catalog, run the capability against
it and confirm the result is a constraint model that the existing solving capability can execute
successfully.

**Acceptance Scenarios**:

1. **Given** a natural-language puzzle file in the catalog's established format, **When** the
   user runs the extraction capability against it, **Then** they receive a constraint model that
   can be executed by the existing solving capability.
2. **Given** the same puzzle file, **When** the produced model is executed by the existing
   solving capability, **Then** the reported outcome (solvable, not solvable, or multiple
   answers) reflects a plausible reading of the puzzle's actual clues, not an arbitrary or
   unrelated result.

---

### User Story 2 - Know when a translation can't be trusted (Priority: P1)

A user runs the capability against a puzzle and needs to know, clearly and immediately, whether
the result faithfully represents the puzzle's clues — not just whether it produced *something*.

**Why this priority**: A plausible-looking but wrong translation is worse than no translation at
all, because it can silently mislead. This is what makes the capability trustworthy enough to
rely on, and is equally foundational to User Story 1.

**Independent Test**: Verify that every result is either an explicitly validated, faithful
translation, or an explicit rejection with a stated reason — never an unvalidated result
presented as trustworthy.

**Acceptance Scenarios**:

1. **Given** a puzzle whose translation cannot be validated as faithful to the source text after
   the system's best attempts, **When** the user runs the capability, **Then** they receive a
   clear rejection, not a plausible-looking but unverified model.
2. **Given** a puzzle whose translation, as written, has no valid solution or has more than one
   valid solution, **When** the translation still faithfully represents the puzzle's stated
   clues, **Then** the system still accepts it as a valid, trustworthy result — that fact about
   the puzzle is reported separately, not treated as a translation failure.
3. **Given** a temporary failure of the underlying extraction service (e.g. a network or service
   error), **When** the user runs the capability, **Then** they receive a message that clearly
   distinguishes "the service could not be reached" from "the translation could not be trusted."

---

### User Story 3 - Access the extraction's underlying structure (Priority: P3)

A user or downstream tool wants the validated, structured breakdown of a puzzle's entities,
value domains, and constraints — not just the final solvable model — for uses beyond immediate
solving (e.g. archiving, further tooling, or future representations of the same puzzle).

**Why this priority**: Valuable for integration and future extensibility, but the feature already
delivers its core value (User Stories 1-2) without it — a solvable model alone is independently
useful.

**Independent Test**: Request the structured form instead of the default output and confirm it
is well-formed, corresponds to the same validated translation, and is distinguishable from the
compiled model output.

**Acceptance Scenarios**:

1. **Given** a successfully validated puzzle translation, **When** the user requests the
   structured form instead of the default output, **Then** they receive the entities, value
   domains, and constraints the translation identified, without the system also having to
   produce a compiled model to do so.

---

### User Story 4 - Configure which AI model does the work (Priority: P4)

A user wants to control which underlying AI model(s) are used — for cost, availability, or
preference reasons — without needing to understand how the extraction capability is built.

**Why this priority**: An operational nicety that matters once the capability is in regular use,
but the feature works correctly with sensible built-in defaults even if no one ever overrides
them.

**Independent Test**: Override the model configuration (via a command option or an environment
setting) and confirm the override takes effect instead of the built-in default.

**Acceptance Scenarios**:

1. **Given** a user who wants to use a different underlying AI model than the built-in default,
   **When** they supply their preference via a command option or an environment setting,
   **Then** the capability uses that preference instead of its default, without requiring any
   other change to how they invoke it.

---

### Edge Cases

- What happens when the puzzle's prose is genuinely ambiguous or omits information? The system
  still validates faithfulness against what is actually stated — an under-constrained or
  contradictory model is a valid, faithful outcome if that's what the source text actually
  supports (see User Story 2, Acceptance Scenario 2), not automatically treated as a failure.
- What happens when the same puzzle is submitted more than once? Results are not guaranteed to
  be identical between runs, since the underlying process is not perfectly deterministic — but
  every accepted result, whichever run it comes from, has independently passed the same
  faithfulness validation before being returned.
- What happens when a puzzle uses a kind of clue the system doesn't yet know how to translate
  into a solvable model? The system reports a specific, clear error identifying what it could not
  translate, rather than silently omitting it or guessing.
- What happens when the underlying AI service is unreachable, rate-limited, or returns an
  unexpected error? This is reported as a distinct failure from "could not produce a faithful
  translation" (User Story 2, Acceptance Scenario 3), so the user knows whether to retry, check
  their connection/configuration, or reconsider the puzzle itself.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST accept a natural-language puzzle as input, in the same file format
  already used by the existing puzzle catalog.
- **FR-002**: System MUST produce, for a successfully validated puzzle, a constraint model that
  the existing solving capability can execute directly.
- **FR-003**: System MUST validate that a produced translation faithfully represents the clues
  and constraints stated in the source puzzle text before treating it as a trustworthy result —
  syntactic well-formedness alone is not sufficient evidence of a correct translation.
- **FR-004**: System MUST NOT judge a translation's trustworthiness by whether the resulting
  model is solvable, has a unique answer, or has multiple answers — those are separate facts
  about the puzzle itself, independent of whether the translation is faithful (see User Story 2,
  Acceptance Scenario 2).
- **FR-005**: When a translation cannot be validated as faithful, System MUST reject it and
  report a clear, actionable reason, rather than presenting an unverified result as trustworthy.
- **FR-006**: Before giving up on a translation attempt, System MUST try to improve it using
  specific information about what didn't match the source text, not just retry the identical
  attempt unchanged.
- **FR-007**: System MUST be able to try an alternative extraction approach if repeated attempts
  using its default approach do not produce a faithful translation.
- **FR-008**: System MUST NOT silently drop or ignore a clue it cannot confidently translate —
  such cases must surface as part of the validation outcome (FR-003/FR-005), not be dropped
  without indication.
- **FR-009**: System MUST allow a user to obtain the structured, underlying form of a validated
  translation (its identified entities, value domains, and constraints), independent of and
  without requiring generation of the compiled solvable model.
- **FR-010**: System MUST allow a user to configure which underlying AI model(s) the extraction
  uses, without requiring the user to understand the extraction capability's internal
  architecture or which external service it calls.
- **FR-011**: System MUST provide a way to invoke this capability directly from the command
  line, consistent with how the existing solving capability is already invoked.
- **FR-012**: System MUST clearly distinguish, in what it reports, between "the translation could
  not be trusted" and "the underlying service could not be reached or failed unexpectedly" as
  different kinds of failure.

### Key Entities

- **Puzzle**: A natural-language description of a logic puzzle and its clues, in the same format
  as entries in the existing puzzle catalog.
- **Extraction**: A structured, validated representation of a puzzle's entities, value domains,
  and constraints, derived from its prose — usable on its own (User Story 3) or as the basis for
  generating a solvable model (User Story 1).
- **Solvable Model**: A constraint model, in the format the existing solving capability already
  accepts, generated from a validated Extraction.
- **Validation Outcome**: The result of checking an Extraction's faithfulness to its source
  Puzzle — either acceptance, or a rejection accompanied by the specific mismatch(es) found.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can go from a natural-language puzzle file to a solvable constraint model in
  a single command, without hand-writing any part of the model themselves.
- **SC-002**: For a representative sample of the existing puzzle catalog, at least 80% of
  attempts produce a validated, faithful translation without requiring any manual correction.
- **SC-003**: When a translation cannot be trusted, a user can understand *why* from the reported
  message alone, without needing to inspect internal logs or source code.
- **SC-004**: A user can obtain either a ready-to-solve model or the underlying structured
  extraction, depending on their need, without having to run the extraction twice.
- **SC-005**: A user can use the capability successfully without ever needing to know which AI
  provider or which specific AI model handled the extraction.

## Assumptions

- The initial quality bar for "faithful translation" is defined by the phrasing style already
  present in the existing seed puzzle catalog — reasonable, well-intentioned natural language,
  not arbitrary or adversarial input.
- Faithfulness is judged by an independent check against the source text, not merely by whether
  the output parses successfully or looks plausible.
- Users have their own means of authenticating with the underlying AI service already available
  in their environment (e.g. a credential set via configuration) — provisioning that credential
  is outside this feature's scope.
- This capability requires network access; fully offline operation is out of scope for this
  iteration (a known, separately-tracked limitation, not something this feature resolves).
- The existing solving capability, already reachable from the command line, is reused unmodified
  as this feature's downstream consumer — this feature does not change how solving itself works.
- Producing a trustworthy result may take more than one attempt and more time/cost than a single
  attempt would; favoring a trustworthy result over the fastest/cheapest possible one is an
  accepted tradeoff for this feature's initial scope.
- Automatically accumulating validated translations into a reusable collection (e.g. for future
  testing or training purposes) is a valuable follow-on capability but is explicitly out of scope
  for this feature.
