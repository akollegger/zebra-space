---
name: "rfc-create"
description: "Create or update an RFC: the problem, its motivation, and high-level candidate approaches — the Discover/Define phase that precedes any ADR or speckit work."
argument-hint: "Describe the problem/opportunity, or 'update RFC-003 ...' to revise an existing one"
compatibility: "Requires design/rfc/ directory (created automatically on first use)"
metadata:
  author: "zebra-space"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty). If empty, ask the user what problem or opportunity the RFC should describe.

## Purpose

An RFC captures **WHAT** a problem is and **WHY** it matters, plus high-level candidate directions. It does **not** contain implementation detail, technology choices, file/module names, or code structure — that belongs in one or more child ADRs (see `adr-create`). Think of the RFC as the Discover→Define half of a double-diamond: it converges on a well-scoped problem statement and a general direction, not a solution.

## Voice and audience

Write for a competent engineer who has just found the project: fluent in the general problem domain, but with no knowledge of its history, its files, or any sibling document. They should be able to learn the topic from this document alone. If the project's `design/rfc/README.md` states an audience, prefer that — it's more specific.

Design documents drift toward being written for their own authors, which reads to everyone else like overhearing a private argument. Four rules, in priority order:

1. **The topic is the grammatical subject — not the project, not the document.** Write about problems, constraints, inputs, answers, trade-offs. Not about "this project," "this RFC," "this subsection," or "the omission." Meta-talk ("this section states…", "as discussed above") is navigation, not content: one pointer where a reader genuinely needs it, never as a substitute for saying the thing.

2. **The Summary teaches before it locates.** Define the subject, state the organizing claim, then say what the RFC delivers — in that order. Self-check: strip every `§`-reference and sibling RFC/ADR number out of section 1. If what remains no longer explains the topic to a newcomer, it was addressed to insiders — rewrite it. A sibling document's number should never appear before the topic has been named.

3. **Never defend a choice against an objection nobody raised.** Two constructions look identical and are not:
   - *Contrastive* — draws a boundary, carries information: "a callable tool, not the system itself." Keep these.
   - *Defensive* — answers an imagined accusation: "deliberate rather than stylistic," "economical rather than careless," "no decision in that sequence was wrong," "not just a hypothetical." Cut these. State the thing and let it stand.

   The tell: the negated half names a *fault* ("careless," "stylistic," "arbitrary," "a strawman") instead of a real alternative. In Alternatives Considered, "Rejected: <specific reason>" is complete — pre-empting the reader's disagreement is not part of the job.

4. **Motivation is evidence, not confession.** Argue the problem from artifacts: a file, a quoted line, an observed failure, a cost someone is paying now. Do not narrate how the project came to be at fault ("has never been mapped," "nothing on record says," "was never named or reused"). What is true today and what it costs is the whole argument; the moral accounting of how it got that way belongs in neither the RFC nor the reader's head.

Cross-references are navigation, never load-bearing: every sentence must still parse and mean the same thing with its `(§5.2)` parenthetical removed.

## Outline

1. **Require a non-main branch before making any changes**:
   - Run `git branch --show-current` (skip this whole check silently if not inside a git
     repository).
   - Determine the repository's main branch: prefer the short name from
     `git symbolic-ref refs/remotes/origin/HEAD`; fall back to `main` if that's unavailable.
   - If the current branch **is** the main branch, **STOP** — do not create or edit any file.
     Tell the user: RFCs should be authored on a feature branch, not directly on the main
     branch, so this design work goes through the same PR-based review as everything else. Ask
     them to create/switch to a branch (e.g. `git checkout -b <short-descriptive-name>`) and
     re-invoke `/rfc-create`.
   - Otherwise, proceed — this applies to both create and update.

2. **Determine create vs. update**:
   - Scan `$ARGUMENTS` for an `RFC-<N>` reference (bare like `RFC-3`, zero-padded like `RFC-003`, a bare filename, or an `@design/rfc/RFC-003-*.md` path).
   - If found, resolve it against files in `design/rfc/` (normalize the numeric part; ignore leading zeros when matching). If it resolves, this is an **update** — read the existing file and apply the requested changes, preserving the `id`, `created`, and `adrs` front-matter fields unless the user explicitly asks to change them.
   - If an `RFC-<N>` token is present but does not resolve to any file, tell the user and stop — do not silently create a new RFC under a guessed number.
   - If no `RFC-<N>` token is present at all, this is a **create**.

3. **For create**: determine the next sequential number.
   - `mkdir -p design/rfc` if it doesn't exist.
   - Scan `design/rfc/` for files matching `RFC-(\d+)-*.md`, take the max numeric value, add 1, zero-pad to 3 digits (e.g. `001`, `042`, and beyond 999 just grow naturally).
   - Generate a concise short name (2-4 words, kebab-case) from the problem description, same conventions as speckit's short-name generation (action-noun format where sensible, preserve technical terms/acronyms).
   - Target file: `design/rfc/RFC-<NNN>-<short-name>.md`.

4. **Write the RFC** with this structure (omit a section entirely rather than leaving it as a placeholder if it doesn't apply):

   ```markdown
   ---
   id: RFC-<NNN>
   title: <Title>
   status: draft
   created: <DATE>
   adrs: []
   ---

   # RFC-<NNN>: <Title>

   ## 1. Summary

   A short paragraph or three, readable by someone who has read nothing else in the repository: what the subject is, the organizing claim about it, then what this RFC settles. Per "Voice and audience" rule 2 — no sibling document number before the topic is named.

   ## 2. Problem / Motivation

   What's wrong or missing today, and why it matters now — shown with artifacts (a file, a quoted line, an observed failure, a cost being paid now), not narrated as an account of past oversight.

   ## 3. Goals

   ## 4. Non-Goals

   ## 5. Proposed Approach (high-level)

   Candidate direction(s) at a conceptual level. No tech stack, APIs, schemas, or file/module layout. If more than one genuinely distinct axis or strategy is being explored, break this section into numbered subsections (`### 5.1 ...`, `### 5.2 ...`) rather than one flat list — e.g. one subsection per independent axis of the problem, one for the candidate strategies themselves, and one for cross-cutting concerns that apply across strategies rather than being an alternative to them.

   ## 6. Alternatives Considered

   Other strategic directions considered and why they were set aside (this is still at the "what kind of approach" level, not implementation options — that detail lives in an ADR's own Alternatives Considered section).

   ## 7. Open Questions

   7.1. <first open question>

   7.2. <second open question>

   ## 8. ADRs

   _(populated automatically as `/adr-create` links ADRs to this RFC)_
   ```

   Number every top-level `##` section sequentially (renumber if a section is later removed for not applying). Numbered `###` subsections within a section (e.g. `5.1`, `5.2`) are encouraged wherever a section covers more than one genuinely distinct idea — it keeps cross-references (elsewhere in the RFC, or later in a child ADR) unambiguous.

   **Open Questions must always be individually numbered** (`7.1.`, `7.2.`, ...), not a plain bullet list — unlike section 5's subsections, this numbering applies even when each item is short, because other sections, ADRs, and future RFCs need to cite *which* open question they're resolving or leaving open, not just "see Open Questions" generically. Renumber remaining items if one is resolved and removed.

5. **For update**: apply the requested edits directly to the existing sections. Common updates:
   - Status transitions: `draft` → `review` → `accepted`, or `accepted` → `superseded` (if superseded, add a note pointing to the superseding RFC).
   - Refining goals/non-goals/open questions as understanding evolves.
   - Do **not** manually edit the `adrs:` front-matter list — that's maintained by `/adr-create`.

6. **Maintain the index**: `design/rfc/README.md` holds a living index table (`RFC | Title | Status | ADRs`).
   - If `design/rfc/README.md` doesn't exist yet, create it (format doc + an empty index table) before continuing — don't leave a newly created `design/rfc/` directory without one.
   - Create: append a new row for this RFC.
   - Update: refresh this RFC's existing row (title/status/ADRs may have changed) in place — don't duplicate or reorder other rows.

7. **Guardrail — reject implementation detail**: if the user's input describes specific technologies, APIs, data models, or file structures, extract the underlying problem/goal for the RFC and tell the user that detail belongs in an ADR (suggest running `/adr-create` referencing this RFC once it exists).

## Completion Report

Report:
- The RFC file path (created or updated).
- Its `status`.
- If newly created: suggest next step — `/adr-create` referencing this RFC to start elaborating a technical decision.
