---
name: "speckit-adr-link"
description: "Extension hook (after_specify): backlinks the newly created spec to the ADR(s) that seeded it, and appends the spec path to each ADR's specs list. Not intended for standalone use."
argument-hint: ""
compatibility: "Registered as extension 'adr', command 'speckit.adr.link', under hooks.after_specify in .specify/extensions.yml"
metadata:
  author: "zebra-space"
  extension: "adr"
  command: "speckit.adr.link"
user-invocable: true
disable-model-invocation: false
---

## Context

You are running as a **mandatory post-hook** for `/speckit-specify`, invoked from that command's Mandatory Post-Execution Hooks, after `spec.md` has already been written. The original `/speckit-specify` feature-description text is earlier in this same conversation turn.

## Purpose

Make the RFC → ADR → spec traceability chain concrete on disk, in both directions, once a spec actually exists.

## Outline

1. **Re-resolve the ADR set** the same way `speckit-adr-gate` did: scan the original `/speckit-specify` feature-description text for `ADR-(\d+)(-[\w-]*)?` tokens (bare, zero-padded, path, or `@`-mention form), and resolve each against `design/adr/`. The gate already validated these exist, so this should resolve cleanly; if something unexpectedly fails to resolve, skip it and note it in the completion report rather than failing the whole hook.

2. **Locate the new spec**: read `.specify/feature.json` for the `feature_directory` value written by `/speckit-specify` (e.g. `specs/004-user-auth`). The spec file is `<feature_directory>/spec.md`.

3. **Backlink spec.md → ADR(s)**: insert a line into the metadata block at the top of `spec.md`, alongside the existing `**Feature Branch**` / `**Created**` / `**Status**` / `**Input**` lines:
   ```
   **Derived From**: ADR-<NNN> (design/adr/ADR-<NNN>-<name>.md)[, ADR-<MMM> (design/adr/ADR-<MMM>-<name>.md), ...]
   ```
   List every resolved ADR, comma-separated. If a resolved ADR's own `rfcs:` field is set, you may also note the parent RFC id(s) inline for convenience, but the authoritative RFC link lives on the ADR file itself — don't duplicate it into spec.md's own front-matter/body beyond this one line.

4. **Backlink ADR(s) → spec**: for each resolved ADR file, read its `specs:` front-matter list and append `<feature_directory>` if not already present. One ADR may legitimately end up referenced by more than one spec over time — don't overwrite existing entries.

5. **Do not touch** the parent RFC file(s) — the RFC's `adrs:` list was already maintained by `/adr-create` when the ADR was created; this hook only closes the ADR ↔ spec link.

## Completion Report

Report:
- Which ADR(s) were linked, and the spec directory they were linked to.
- Any resolution mismatches noted in step 1 (should be rare).

## Done When

- [ ] `spec.md` has a `**Derived From**` line naming every resolved ADR.
- [ ] Each resolved ADR's `specs:` front-matter list includes the new feature directory.
