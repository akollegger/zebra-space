---

description: "Task list for feature implementation"
---

# Tasks: Natural-Language Puzzle to Solvable CSP Extraction

**Input**: Design documents from `/specs/004-nl-csp-extraction/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/cli-contract.md, quickstart.md

**Tests**: Included throughout — Constitution Principle IV requires test-first once an ADR exists,
and this feature has three (ADR-003, ADR-004, ADR-005). `tests/extraction/extract.test.ts` and
`tests/compiler/compile.test.ts` are new; `tests/cli/cli.test.ts` (from `specs/003-cli-interface`)
is extended with `extract` cases. Per research.md Finding 2, the default suite stubs the
OpenRouter provider boundary rather than making live calls — `tests/extraction/live.test.ts`
(Phase 7) is the opt-in exception.

**Organization**: Tasks are grouped by user story (spec.md P1/P1/P3/P4) to enable independent
implementation and testing of each.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)

## Path Conventions

Single project (per plan.md's Project Structure): `src/extraction/`, `src/compiler/`,
`src/cli/subcommands/`, `tests/extraction/`, `tests/compiler/`, `tests/cli/` at repository root.

---

## Phase 1: Setup

**Purpose**: Add the one new runtime dependency this feature needs before any module exists.

- [X] T001 Add `@openrouter/sdk` to `package.json` dependencies, run `pnpm install`, and confirm clean resolution with no peer-dependency warnings (research.md — SPIKE-004 confirmed zero peer/runtime dependencies)

**Checkpoint**: `@openrouter/sdk` is installed and importable.

---

## Phase 2: Foundational

**Purpose**: The shared `ExtractedCsp`/`FidelityCritique`/error-taxonomy schemas and the one
hand-wrapped provider call every user story's extraction logic is built on.

**⚠️ CRITICAL**: Must complete before any User Story phase below.

- [X] T002 [P] Define `Entity`, `Domain`, `ExtractedCsp`, `ExtractedConstraint` (six-kind `Schema.Union`), `DerivedCondition`, and `ArithmeticExpression` as `Schema.Struct`/`Schema.Union` values in `src/extraction/types.ts` — use `Schema.suspend` for `derivedRule.then` and `binaryOp.left`/`right`'s self-reference, and `Schema.NullOr` (not `Schema.optional`) for `right`, per data-model.md and research.md Findings 1 & 3
- [X] T003 [P] Define `FidelityCritique` (`{ accepted, issues }`) as a `Schema.Struct` in `src/extraction/types.ts` (data-model.md)
- [X] T004 In `src/extraction/types.ts`, annotate the T002/T003 schemas with `.annotate({ description })` documenting the constraint taxonomy for the model (what `derivedRule`/`adjacency`/etc. mean), and export each schema's `Schema.toJsonSchemaDocument` output for use as OpenRouter's `responseFormat.jsonSchema.schema` (research.md Finding 4) — depends on T002, T003
- [X] T005 [P] Define the error taxonomy — `ProviderError`, `SchemaViolation` (carrying the underlying `ParseError`), `ExtractionAttempt`, `CriticRejected` (carrying `readonly ExtractionAttempt[]`), `ExtractionError` — as `Data.TaggedError` classes in `src/extraction/types.ts`, mirroring `src/solver/types.ts`'s convention (data-model.md)
- [X] T006 [P] Define `CompileError` as a `Data.TaggedError` in `src/compiler/types.ts` (data-model.md, ADR-005 §2.3/§2.4)
- [X] T007 Implement `src/extraction/provider.ts`: an `Effect.tryPromise`-wrapped function calling `@openrouter/sdk`'s `chat.send({ chatRequest: { model, messages, responseFormat } })` (note the `chatRequest` nesting the SDK's own README examples omit), `Effect.timeout`-wrapped per call, decoding the raw response through `Schema.decodeUnknownEffect` against a given schema and mapping a request failure to `ProviderError` / a decode failure to `SchemaViolation` (ADR-004 §2.3/§2.6) — depends on T004, T005
- [X] T008 In `src/extraction/provider.ts`, support an internal base-URL override (e.g. a `ZEBRA_OPENROUTER_BASE_URL_OVERRIDE` env var — not part of ADR-003's public flag surface) so tests can redirect requests to a local stub server instead of the real OpenRouter API — depends on T007
- [X] T009 [P] Create `tests/extraction/support/stub-server.ts`: a minimal `node:http` server standing in for OpenRouter's chat-completions endpoint, configurable per test to accept, reject-with-issues, error, or record which `model` string a request used — the stubbed provider boundary research.md Finding 2 named, shared by `tests/extraction/extract.test.ts` and (via T008's override) `tests/cli/cli.test.ts`

**Checkpoint**: Shared schemas, error taxonomy, and a stubbable provider call exist — no user story implemented yet.

---

## Phase 3: User Story 1 - Turn a prose puzzle into a solvable model (Priority: P1) 🎯 MVP

**Goal**: `zebra extract <puzzle.md>` runs one extraction attempt, one critique, and — once
accepted — compiles and prints a `.mzn` model, for the common case where the first attempt is
faithful.

**Independent Test**: Run against a catalog puzzle whose stub-provided translation is known
correct; confirm the printed `.mzn` is valid and, piped to `zebra solve`, reproduces the puzzle's
known answer.

### Tests for User Story 1

- [X] T010 [P] [US1] Test in `tests/extraction/extract.test.ts`: with T009's stub configured to accept on the first attempt, `extract()` resolves to the stub's `ExtractedCsp` and model tier (SC-001, Acceptance Scenario 1)
- [X] T011 [P] [US1] Tests in `tests/compiler/compile.test.ts`: `compile()` renders each `ExtractedConstraint` kind to the expected `.mzn` fragment — `assignment`/`allDifferent` declarations, the `adjacency` relation registry, `relation`+`derivedRule` fact-driven expansion, `derivedRule` variable-conditioned reified implication, and `arithmetic` expressions (ADR-005 §2.2-2.5)
- [X] T012 [P] [US1] Test in `tests/cli/cli.test.ts`: with T009's stub configured to return `PZL-0004-whodunit`'s known-correct `ExtractedCsp`, `zebra extract catalog/puzzles/PZL-0004-whodunit.md` prints a `%`-comment header plus valid `.mzn`, exits `0`, and piping that output to `zebra solve` reproduces the known answer from `eval/answer-keys.json` (Acceptance Scenario 1 & 2, SC-001)

### Implementation for User Story 1

- [X] T013 [US1] Implement `src/extraction/extract.ts`'s single-attempt path: call T007's provider once against the extraction schema, once more against the `FidelityCritique` schema (passing the source prose plus candidate `ExtractedCsp`), and return the `ExtractedCsp` and model tier when `accepted` — depends on T007
- [X] T014 [US1] Implement `src/compiler/compile.ts`: variable declarations from `domains`, and `assignment`/`allDifferent` constraint translation (ADR-005 §2.2/§2.3) — depends on T002, T006
- [X] T015 [US1] Extend `src/compiler/compile.ts` with the `adjacency` relation registry and `relation`+`derivedRule` fact-driven expansion (ADR-005 §2.3/§2.4 mode 1), raising `CompileError` on an unrecognized relation name — depends on T014
- [X] T016 [US1] Extend `src/compiler/compile.ts` with `derivedRule`'s variable-conditioned reified implication (§2.4 mode 2) and `arithmetic` expression rendering (§2.5), raising `CompileError` on an unrecognized/ambiguous condition shape — depends on T015
- [X] T017 [US1] Create `src/cli/subcommands/extract.ts`: `buildCommand` with the `puzzle.md` positional, calling T013's `extract()` then T014-016's `compile()`, printing the `%`-comment provenance header (source file + model tier) plus `.mzn` text on success (ADR-003 §2.6) — depends on T013, T016
- [X] T018 [US1] Register `extract` in `src/cli/main.ts`'s route map alongside `solve` — depends on T017

**Checkpoint**: `zebra extract <puzzle.md>` works end-to-end for the happy path.

---

## Phase 4: User Story 2 - Know when a translation can't be trusted (Priority: P1)

**Goal**: Rejected attempts trigger informed revision, then tier escalation, then a diagnosable
`CriticRejected` failure — distinguishable from a `ProviderError`/`SchemaViolation` — and
solvability never gates acceptance.

**Independent Test**: Drive the stub through reject-then-revise, reject-through-escalation,
reject-everywhere, and provider-error scenarios; confirm each produces the right outcome and the
right, distinguishable error report.

### Tests for User Story 2

- [X] T019 [P] [US2] Test in `tests/extraction/extract.test.ts`: stub rejects the first attempt with specific `issues`, then accepts on revision — `extract()` succeeds, and the stub's second request includes those `issues` (FR-006, Edge Cases)
- [X] T020 [P] [US2] Test in `tests/extraction/extract.test.ts`: stub rejects every cheap-tier attempt, accepts on the first frontier-tier attempt — the result's model tier is the frontier one (FR-007, ADR-004 §2.5)
- [X] T021 [P] [US2] Test in `tests/extraction/extract.test.ts`: stub rejects every attempt across both tiers — `extract()` fails with `CriticRejected` carrying every attempt's `ExtractedCsp`/`FidelityCritique` (FR-005/FR-008)
- [X] T022 [P] [US2] Test in `tests/extraction/extract.test.ts`: T009's stub simulates a connection failure — `extract()` fails with `ProviderError`, not `CriticRejected` (FR-012, Acceptance Scenario 3)
- [X] T023 [P] [US2] Test in `tests/cli/cli.test.ts`: with T009's stub configured to return a faithful `ExtractedCsp` for a deliberately unsatisfiable (or multiply-satisfiable) toy puzzle fixture, `zebra extract` still prints a compiled `.mzn` and exits `0` — piping it to `zebra solve` reports that outcome, which `extract` never treats as a failure (FR-004, Acceptance Scenario 2)
- [X] T024 [P] [US2] Test in `tests/cli/cli.test.ts`: `zebra extract` against a stub that rejects every attempt prints the full attempt history to stderr and exits `1` (contracts/cli-contract.md)
- [X] T025 [P] [US2] Test in `tests/cli/cli.test.ts`: `zebra extract` against a stub simulating a provider error prints a message distinguishable from T024's rejection case and exits `1` (FR-012)

### Implementation for User Story 2

- [X] T026 [US2] In `src/extraction/extract.ts`, implement informed revision: on rejection, re-request the extraction schema with the prior `ExtractedCsp` and the critique's `issues` folded into the prompt, bounded to 2 revisions per tier (ADR-004 §2.4) — depends on T013
- [X] T027 [US2] In `src/extraction/extract.ts`, implement tier escalation: once a tier's revisions are exhausted, repeat the same extract-critique-revise cycle on the frontier tier (ADR-004 §2.5) — depends on T026
- [X] T028 [US2] In `src/extraction/extract.ts`, implement final rejection: once the frontier tier's revisions are also exhausted, fail with `CriticRejected` carrying every attempt from both tiers (ADR-004 §2.4/§2.6) — depends on T027
- [X] T029 [US2] In `src/cli/subcommands/extract.ts`, render `CriticRejected`'s attempt history and `ProviderError`/`SchemaViolation` messages distinctly on stderr, exiting `1` for each (contracts/cli-contract.md, FR-012) — depends on T017, T028

**Checkpoint**: The full critic loop (revise/escalate/reject) works, and its failure modes are distinguishable.

---

## Phase 5: User Story 3 - Access the extraction's underlying structure (Priority: P3)

**Goal**: `--json` returns the raw, critic-accepted `ExtractedCsp` and never invokes the compiler.

**Independent Test**: Request `--json` output and confirm it's well-formed, matches the same
validated translation, and is produced without a compile step.

### Tests for User Story 3

- [X] T030 [P] [US3] Test in `tests/cli/cli.test.ts`: `zebra extract <puzzle.md> --json` prints the accepted `ExtractedCsp` plus model tier as JSON and exits `0` even when that `ExtractedCsp` would fail to compile (e.g. an unrecognized relation) — confirming the compiler is never invoked on this path (SC-004, contracts/cli-contract.md)

### Implementation for User Story 3

- [X] T031 [US3] Add a `--json` boolean flag to `src/cli/subcommands/extract.ts`; when set, print `JSON.stringify({ extractedCsp, model })` instead of calling `compile()` (ADR-003 §2.6, FR-009) — depends on T017

**Checkpoint**: User Stories 1-3 all independently functional.

---

## Phase 6: User Story 4 - Configure which AI model does the work (Priority: P4)

**Goal**: `--model`/`--frontier-model` flags and `ZEBRA_MODEL`/`ZEBRA_FRONTIER_MODEL` env vars
override the built-in tier defaults, with flag > env var > default precedence.

**Independent Test**: Override via flag, override via env var, and confirm flag wins when both
are set.

### Tests for User Story 4

- [X] T032 [P] [US4] Test in `tests/extraction/extract.test.ts`: `extract()` accepts model-identifier overrides for both tiers and uses them instead of the built-in defaults (FR-010)
- [X] T033 [P] [US4] Test in `tests/cli/cli.test.ts`: `--model`/`--frontier-model` flags reach T009's stub server with the overridden identifiers instead of the built-in defaults
- [X] T034 [P] [US4] Test in `tests/cli/cli.test.ts`: `ZEBRA_MODEL`/`ZEBRA_FRONTIER_MODEL` environment variables take effect when the flags are absent, and the flags take precedence when both are set (contracts/cli-contract.md)

### Implementation for User Story 4

- [X] T035 [US4] Parameterize `src/extraction/extract.ts`'s tier model identifiers (currently the built-in defaults `google/gemini-2.5-flash-lite`/`anthropic/claude-sonnet-4.5`, ADR-004 §2.5) as function arguments instead of hard-coded constants — depends on T028
- [X] T036 [US4] Add `--model`/`--frontier-model` flags to `src/cli/subcommands/extract.ts`, resolving flag > `ZEBRA_MODEL`/`ZEBRA_FRONTIER_MODEL` env var > built-in default before calling `extract()` (ADR-003 §2.6) — depends on T035, T029

**Checkpoint**: All four user stories independently functional — the full spec.md acceptance-scenario set passes.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation against this feature's own success criteria and the project's
lint/type-safety and offline-testability constraints.

- [X] T037 [P] Run `pnpm test` and confirm the full suite — existing `tests/solver/`/`tests/catalog/`/`tests/cli/` plus new `tests/extraction/`/`tests/compiler/` — passes with no network access (research.md Finding 2)
- [X] T038 [P] Create `tests/extraction/live.test.ts` (opt-in): real extraction attempts against the SPIKE-004 stratified sample (PZL-0001, PZL-0005, PZL-0008, PZL-0011, PZL-0013), checking SC-002's 80% faithful-translation bar, auto-skipped when `OPENROUTER_API_KEY` is absent from the environment (research.md Finding 2)
- [X] T039 Run `pnpm lint` and `tsc --noEmit` clean, with no relaxed `tsconfig.json` strictness settings or newly suppressed Biome rules (Constitution Principle V)
- [ ] T040 Run `quickstart.md`'s manual checks end-to-end against `catalog/puzzles/PZL-0004-whodunit.md` (requires `OPENROUTER_API_KEY`) — **not run**: this implementation pass had no live OpenRouter credential available; the equivalent end-to-end path (extract → compile → solve, PZL-0004's known answer) was verified via the stub server instead (T012's CLI test), and the CLI's help/flag surface was verified directly. Run this manually once a real `OPENROUTER_API_KEY` is available.

---

## Phase 8: Realignment after SPIKE-005 (ADR-004 revision)

**Purpose**: T004/T007 above were completed against ADR-004's *original* mechanism
(`response_format` structured output). SPIKE-005 then measured that mechanism as unreliable
across providers and ADR-004 §2.1/§2.7 were revised. Those tasks are left as-completed rather
than rewritten — they record what was actually built at the time — and this phase records the
follow-through.

- [X] T041 Switch `src/extraction/provider.ts` from `responseFormat` to a forced tool call (`tools` + `toolChoice`, reading `choices[0].message.toolCalls[0].function.arguments`) per revised ADR-004 §2.1
- [X] T042 Rebuild `ExtractedConstraint`/`ArithmeticExpression` in `src/extraction/types.ts` with depth-bounded constructors instead of `Schema.suspend`, so the emitted schema is cycle-free (ADR-004 §2.7); `MAX_NESTING_DEPTH = 2`
- [X] T043 Replace `ArithmeticExpression`'s `left`/nullable-`right` with an `operands` array (ADR-004 §4) and enforce operator arity in `src/compiler/compile.ts`
- [X] T044 Add `toProviderSchema`/`assertProviderSafeSchema` to `src/extraction/types.ts` — inline any residual `$ref`/`$defs` and **refuse to send** a schema containing `$ref`, `$defs`, or a nullable nested object (ADR-004 §2.7), so this failure mode cannot ship silently
- [X] T045 Add `SchemaRejected` to the error taxonomy, distinct from `ProviderError`, with provider-message signature matching in `src/extraction/provider.ts` — the remedy differs (different model vs. retry), so the error must too
- [X] T046 Give every extraction failure an actionable CLI message naming cause + next action (`src/cli/subcommands/extract.ts`), and add `src/cli/user-facing-error.ts` so no JS stack trace is appended (spec.md SC-003); applied to `solve` too, which had the same wart
- [X] T047 Teach `tests/extraction/support/stub-server.ts` to speak tool calls (`respondWithJson` → tool call, new `respondWithProse` for the ignored-tool case) and record the schema actually sent
- [X] T048 Add regression tests: emitted schema carries no `$ref`/`$defs`; request is a forced tool call; `SchemaRejected` vs `ProviderError`; prose-instead-of-tool → `SchemaViolation`; and two CLI tests asserting actionable text with no `node_modules` stack frames
- [X] T049 Realign `research.md` (Findings 3/4 + SPIKE-004 confirmations), `data-model.md`, and `contracts/cli-contract.md` with the revised mechanism — including recording where the original research was *wrong*, not just replacing it
- [X] T050 Revisit ADR-004 §2.5's default cheap tier — **decided: switched to `openai/gpt-4o-mini`.** Identical request, 4 consecutive attempts each, 30s timeout:

  | Model | Results |
  |---|---|
  | `google/gemini-2.5-flash-lite` (previous default) | timeout(30s), ok(1.1s), ok(18.9s), timeout(30s) — **2/4 failed** |
  | `openai/gpt-4o-mini` (new default) | ok(1.9s), ok(1.6s), ok(1.5s), ok(1.5s) — **4/4, consistently ~1.5s** |

  Consistent with SPIKE-005's finding that provider identity dominates model size. `src/extraction/extract.ts`'s `DEFAULT_MODEL`, ADR-004 §2.5, and `.env.example` all updated. Stays a cross-vendor pair (OpenAI cheap → Anthropic frontier), preserving §2.4's less-correlated-critic property — same-vendor tiering remains a live, undecided option per ADR-004 §2.5's own text, not ruled out here.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup (`@openrouter/sdk` must be installed) — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational. No dependency on US2/US3/US4.
- **User Story 2 (Phase 4)**: Depends on Foundational and on US1's `extract()`/`extract.ts` route registration (T013, T017) existing to extend — not independently implementable before US1, but independently *testable* once both exist.
- **User Story 3 (Phase 5)**: Depends on Foundational and on US1's `src/cli/subcommands/extract.ts` (T017) existing to add a flag to.
- **User Story 4 (Phase 6)**: Depends on Foundational, US1's `extract.ts` (T013), and US2's final-rejection logic (T028) and CLI error rendering (T029), since it parameterizes what those already built.
- **Polish (Phase 7)**: Depends on all desired user stories being complete.

### Within Each User Story

- Tests before implementation (write first, confirm they fail against the pre-implementation code — Constitution Principle IV).
- `src/extraction/extract.ts`'s happy path (T013) before revision (T026), before escalation (T027), before final rejection (T028).
- `src/compiler/compile.ts`'s declarations (T014) before the adjacency/relation-driven mode (T015), before the variable-conditioned mode and arithmetic (T016).
- `src/cli/subcommands/extract.ts`'s creation (T017) before its route registration (T018), before flags are added to it (T029, T031, T036).

### Parallel Opportunities

- All Phase 2 tasks marked [P] (T002, T003, T005, T006, T009) touch independent files/concerns and can proceed in parallel once T001 lands; T004/T007/T008 have real sequencing dependencies on them.
- Within each user story, test tasks marked [P] target different files (or independent cases in the same file) and can be written in parallel once their phase's Foundational/prior-story prerequisites exist.
- T014-T016 (compiler implementation) are sequential (each extends the last) but can proceed in parallel with T013 (extraction implementation) — different files, no shared dependency until T017 needs both.

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together, once Phase 2 is done:
Task: "extract() resolves to the stub's ExtractedCsp on first-attempt acceptance, in tests/extraction/extract.test.ts"
Task: "compile() renders each ExtractedConstraint kind correctly, in tests/compiler/compile.test.ts"
Task: "zebra extract reproduces PZL-0004's known answer via zebra solve, in tests/cli/cli.test.ts"

# T013 (extraction) and T014 (compiler declarations) can then proceed in parallel:
Task: "Implement src/extraction/extract.ts's single-attempt path"
Task: "Implement src/compiler/compile.ts's declarations and assignment/allDifferent translation"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: run `zebra extract catalog/puzzles/PZL-0004-whodunit.md | zebra solve` end-to-end (with a real `OPENROUTER_API_KEY`, or T009's stub for a scripted check)
5. Deploy/demo if ready — note this MVP has no fidelity-rejection reporting (US2) yet, so a genuinely unfaithful extraction on the first attempt would still surface as a printed `.mzn` model with no critic ever having run against it. **US2 is P1 for a reason** (spec.md: "equally foundational to User Story 1") — treat US1-only as a throwaway spike checkpoint, not a shippable state.

### Incremental Delivery

1. Complete Setup + Foundational → shared schemas and a stubbable provider call ready.
2. Add User Story 1 → validate the happy path → checkpoint only, not a release (see above).
3. Add User Story 2 → the critic loop is now real (revise/escalate/reject) → first genuinely trustworthy, shippable state.
4. Add User Story 3 → `--json` output available → incremental value for tooling/integration use cases.
5. Add User Story 4 → model configuration exposed → incremental operational value.
6. Each story after US2 adds value without breaking previous stories.

### Parallel Team Strategy

With multiple developers, after Setup + Foundational:

- Developer A: User Story 1 (`extract.ts` happy path + `compile.ts` + CLI wiring)
- Developer B: starts User Story 2's tests against T009's stub as soon as T013/T017 land, since US2 only extends existing modules rather than creating new ones
- User Story 3 and 4 are small enough to pick up sequentially after US1/US2 by whoever is free

---

## Notes

- [P] tasks = different files (or independent cases in a shared file), no blocking dependency on an incomplete task.
- [Story] label maps task to specific user story for traceability.
- Every extraction/critique call in every test goes through T009's stub server (or a directly-injected fake at the `src/extraction/provider.ts` boundary for `tests/extraction/extract.test.ts`) — no test in Phases 3-7 except T038/T040 touches the real OpenRouter API or costs money.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a story independently.
- Avoid: vague tasks, same-file conflicts, cross-story dependencies that break independence beyond what's explicitly noted above (US2→US1, US3→US1, US4→US1/US2).
