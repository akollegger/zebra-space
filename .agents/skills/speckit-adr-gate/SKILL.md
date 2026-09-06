---
name: "speckit-adr-gate"
description: "Extension hook (before_specify): blocks /speckit-specify unless the request references at least one existing ADR. Not intended for standalone use."
argument-hint: ""
compatibility: "Registered as extension 'adr', command 'speckit.adr.gate', under hooks.before_specify in .specify/extensions.yml"
metadata:
  author: "zebra-space"
  extension: "adr"
  command: "speckit.adr.gate"
user-invocable: true
disable-model-invocation: false
---

## Context

You are running as a **mandatory pre-hook** for `/speckit-specify`, invoked from that command's Pre-Execution Checks. The original `/speckit-specify` invocation is earlier in this same conversation turn — its feature-description text (the `$ARGUMENTS` it received) is what you must inspect. Do not ask the user to repeat it.

## Purpose

No speckit feature may be specified without referencing the ADR(s) that motivate it. This hook enforces that mechanically, as a hard block — it either passes cleanly or stops the `/speckit-specify` flow before it creates anything.

## Outline

1. **Extract ADR candidates** from the original `/speckit-specify` feature-description text. Scan for **all** occurrences (not just the first) of the pattern `ADR-(\d+)(-[\w-]*)?`, including tokens embedded in a path or an `@`-mention (e.g. `ADR-5`, `ADR-005`, `ADR-005-title`, `design/adr/ADR-005-title.md`, `@design/adr/ADR-005-title.md`).

2. **Zero candidates found** → **BLOCK**:
   - Output:
     ```
     ADR Gate: BLOCKED

     No ADR reference found in this /speckit-specify request. Every speckit feature must be seeded from at least one Architecture Decision Record.

     - No ADR yet? Run /rfc-create first (if no parent RFC exists), then /adr-create.
     - Have one? Retry /speckit-specify referencing it, e.g.:
         /speckit-specify ADR-005: <feature description>
         /speckit-specify @design/adr/ADR-005-title.md: <feature description>
     ```
   - Instruct the calling `/speckit-specify` flow to **STOP** — it must not create a spec directory, spec.md, or proceed to its Outline step. Relay the message above to the user as the final result of this turn.

3. **One or more candidates found** — resolve each against `design/adr/`:
   - Normalize the numeric part (ignore leading-zero differences) and glob `design/adr/ADR-<N>-*.md`.
   - If a candidate does not resolve to an existing file → **BLOCK**: report which reference(s) failed to resolve, list the ADRs actually present in `design/adr/` (id + title), and instruct `/speckit-specify` to STOP, same as step 2.
   - If a candidate resolves, read its front-matter:
     - Missing or empty `rfcs:` field (or an empty list) → **BLOCK**: this ADR is malformed (should never happen if created via `/adr-create`); report it and stop.
     - `status: superseded` → do not block, but include a warning line in the pass output (step 4) naming the superseding ADR if known.

4. **All candidates resolved** → **PASS**:
   - Output:
     ```
     ADR Gate: PASSED
     Resolved ADR(s): ADR-<NNN> (design/adr/ADR-<NNN>-<name>.md) — parent RFC(s): RFC-<NNN>[, RFC-<MMM>, ...]
     [... one line per resolved ADR ...]
     ```
   - Instruct the calling `/speckit-specify` flow to proceed to its Outline step.

## Constraints

- This hook is **read-only** — it must not create, edit, or delete any file. Linking spec.md back to its ADR(s) happens later in the `after_specify` hook (`speckit-adr-link`), once the spec directory actually exists.

## Done When

- [ ] A clear PASS or BLOCK verdict has been reported.
- [ ] On BLOCK, the calling `/speckit-specify` invocation has been explicitly told to stop before creating any files.
