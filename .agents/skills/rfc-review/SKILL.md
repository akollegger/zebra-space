---
name: "rfc-review"
description: "Review a draft RFC for scope, clarity, and readiness to move to review/accepted. Produces concrete suggested revisions, not just a report."
argument-hint: "Reference the RFC to review (RFC-NNN, filename, or @design/rfc/RFC-NNN-*.md path)"
compatibility: "Requires design/rfc/ (see design/rfc/README.md for format)"
metadata:
  author: "zebra-space"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding. If it's empty, or doesn't resolve to an existing RFC, list the RFCs in `design/rfc/` (see its index in `design/rfc/README.md`) and ask which one to review.

## Purpose

Evaluate a draft RFC against a consistent set of quality criteria before it moves from `draft` to `review`/`accepted`. Produces specific, actionable suggested revisions — not a checklist of observations. This is the "converge" check on the Discover/Define half of the double-diamond: it doesn't replace `/rfc-create`, it decides whether what it produced is actually ready.

## Workflow

1. Resolve the RFC reference against `design/rfc/` (same bare/zero-padded/filename/`@`-path resolution as `rfc-create`/`adr-create`/`speckit-adr-gate`).
2. Read the RFC and `design/rfc/README.md` to confirm structural compliance (numbered sections present in order, front-matter fields populated).
3. Evaluate the RFC against each criterion below.
4. For each criterion that fails or is weak, draft a specific suggested revision — quote the problematic text and propose replacement text or a concrete addition.
5. Summarize findings: what's strong, what needs revision, and what's blocking vs. advisory.

Do not edit the RFC yourself — report findings and suggested revisions; let the user (or a follow-up `/rfc-create` call) apply them.

## Review Criteria

### 1. Scope fit — problem, not solution

Does the RFC stay at the WHAT/WHY level appropriate to an RFC, per its own `Purpose` guardrail?

**Flag:** RFC specifies tech stack, APIs, data models, file/module layout, or other implementation detail — that belongs in a child ADR, not here.
**Flag:** RFC is so vague that a later `/adr-create` would face constant ambiguity about what problem it's even solving.

### 2. Problem is real and motivated

Is it clear *why* this matters now, not just *what* is being proposed?

**Flag:** Problem/Motivation section describes a solution in search of a problem, rather than a problem that exists independent of the proposed direction.
**Flag:** No concrete evidence, example, or scenario grounding the problem (compare: RFC-001's use of the referenced article's example clues).

### 3. Goals/Non-Goals are testable boundaries, not aspirations

Can a reader tell what's in scope and out of scope without inferring it?

**Flag:** Goals are vague aspirations ("make it good") rather than checkable boundaries.
**Flag:** Non-Goals section is missing or empty when the Problem/Proposed Approach clearly implies adjacent work that could be mistaken for in-scope.

### 4. Proposed Approach stays high-level and structured

Per the RFC template, section 5 should be split into numbered `###` subsections whenever more than one genuinely distinct axis or strategy is in play.

**Flag:** Multiple independent axes or strategies are described as one flat paragraph/list instead of numbered subsections — harder to reference from Alternatives/Open Questions or a later ADR.
**Flag:** A subsection contains a decision rather than a candidate direction (i.e. it reads like an ADR's Decision section, not an RFC's Proposed Approach).

### 5. Alternatives are real, not strawmen

**Flag:** Alternatives are strawmen no one would seriously propose.
**Flag:** A significant alternative is conspicuously missing — one a reviewer would ask "why not X?" about.

### 6. Open Questions are actually listed, not buried

**Flag:** Unresolved ambiguity is present in prose but not surfaced as an explicit Open Question.
**Flag:** An Open Question is really a Non-Goal or a deferred implementation detail in disguise.
**Flag:** Open Questions are a plain bullet list instead of individually numbered (`7.1.`, `7.2.`, ...) — per `design/rfc/README.md`'s format, every item must be individually numbered so other sections/ADRs can cite exactly which one they address, not just "see Open Questions."

### 7. Consistency with the project and sibling RFCs

Does the RFC align with the project's guidance doc (`CLAUDE.md`/`AGENTS.md`) and not silently conflict with another RFC in `design/rfc/README.md`'s index?

**Flag:** RFC contradicts a stated project principle/purpose without acknowledging it.
**Flag:** RFC overlaps significantly with another RFC's stated scope without cross-referencing it.

### 8. Voice and audience

Would a competent engineer new to the project learn the topic from this document — or does it read like a transcript of the authors arguing with themselves? Design documents drift this way gradually; the drift is invisible to whoever wrote them. See `rfc-create`'s "Voice and audience" section for the rules being checked, and prefer the project's own `design/rfc/README.md` audience statement if it has one.

**Flag:** The Summary's grammatical subject is the project or the document ("this project has never mapped…", "this RFC defines…") rather than the topic. Test it: delete every `§`-reference and sibling RFC/ADR number from section 1 — if what's left no longer explains the subject to a newcomer, it was written for insiders. Quote the result and propose a replacement Summary.
**Flag:** Defensive framing — a construction whose negated half names a *fault* rather than a real alternative ("deliberate rather than stylistic," "economical rather than careless," "no decision was wrong on its own terms"). Contrastive framing that carries information ("a tool, not the system itself") is correct and should be left alone; don't flag it.
**Flag:** Motivation argued by confession ("nothing on record says," "was never named or reused," "has never been mapped") instead of by evidence — a file, a quoted line, an observed failure, a cost being paid now.
**Flag:** A sentence that stops meaning what it meant once its `(§5.2)` parenthetical is removed — cross-references are navigation, not argument.
**Flag:** A term or artifact named without introduction where a newcomer would stall (`SolveResult`, a subsystem, a file the reader has never opened).

Cheap mechanical pre-pass — this drifts gradually and is far easier to see relatively than absolutely, so compare against the siblings in the same directory:

```bash
printf "%-56s %6s %6s %6s %6s %6s\n" FILE lines rthr notX self proj
for f in design/rfc/RFC-*.md; do
  printf "%-56s %6s %6s %6s %6s %6s\n" "$f" \
    "$(grep -c . "$f")" \
    "$(grep -o "rather than" "$f" | wc -l | tr -d ' ')" \
    "$(grep -oE ", not [a-z]" "$f" | wc -l | tr -d ' ')" \
    "$(grep -oiE "this (RFC|ADR|subsection|section|document)" "$f" | wc -l | tr -d ' ')" \
    "$(grep -oiE "th(is|e) project('s)?" "$f" | wc -l | tr -d ' ')"
done
```

A document that's an outlier on several columns at once, normalized for length, is drifting. Judge the prose, not the counts — the numbers only tell you where to read closely, and a high `rather than` count can be entirely legitimate contrastive usage.

## Output Format

```
## RFC Review: [RFC-NNN title]

### Summary
[2-3 sentences: overall assessment and whether it's ready for review/accepted status]

### Blocking Issues
[Must be resolved first. For each: criterion, problem (quote), suggested revision.]

### Advisory Issues
[Worth addressing but not blocking. Same format.]

### Strengths
[What's working well and should be preserved.]
```
