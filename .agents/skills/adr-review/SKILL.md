---
name: "adr-review"
description: "Review a draft ADR for decision clarity, consistency with its parent RFC(s), and readiness to seed a speckit feature. Produces concrete suggested revisions, not just a report."
argument-hint: "Reference the ADR to review (ADR-NNN, filename, or @design/adr/ADR-NNN-*.md path)"
compatibility: "Requires design/adr/ (see design/adr/README.md for format)"
metadata:
  author: "zebra-space"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding. If it's empty, or doesn't resolve to an existing ADR, list the ADRs in `design/adr/` (see its index in `design/adr/README.md`) and ask which one to review.

## Purpose

Evaluate a draft ADR against a consistent set of quality criteria before it moves from `proposed` to `accepted` — and before it's handed to `/speckit-specify`, since `speckit-adr-gate` will accept any resolvable ADR regardless of whether the decision inside it is actually sound. This is the "converge" check on the Develop half of the double-diamond.

## Workflow

1. Resolve the ADR reference against `design/adr/` (same resolution logic as `adr-create`/`speckit-adr-gate`).
2. Read the ADR, its parent RFC(s) (via the `rfcs:` front-matter field), and `design/adr/README.md` to confirm structural compliance.
3. Evaluate the ADR against each criterion below.
4. For each criterion that fails or is weak, draft a specific suggested revision — quote the problematic text and propose replacement text or a concrete addition.
5. Summarize findings: what's strong, what needs revision, and what's blocking vs. advisory.

Do not edit the ADR yourself — report findings and suggested revisions; let the user (or a follow-up `/adr-create` call) apply them.

## Review Criteria

### 1. Consistency with the parent RFC(s)

Does the decision actually serve each parent RFC's stated goals, and stay within its non-goals?
If there's more than one parent RFC, check the decision doesn't quietly favor one at the
expense of another's stated goals.

**Flag:** ADR's Decision contradicts or silently ignores a Goal/Non-Goal in a parent RFC.
**Flag:** ADR resolves (or should resolve) an Open Question from a parent RFC but doesn't say so explicitly.
**Flag:** Multiple parent RFCs are listed but the Decision/Context only actually engages with one of them — the others should either be genuinely served by this decision or not be listed as parents.

### 2. Decision is concrete enough to seed implementation

Per the ADR's own Purpose ("concrete enough to hand to `/speckit-specify`"): could a feature spec be written from this without another round of design?

**Flag:** Decision names a direction but not specifics (components, data shapes, interfaces, or approach) — reads like an RFC's Proposed Approach, not an ADR's Decision.
**Flag:** A detail a `/speckit-specify` call would need is left implicit rather than stated.

### 3. Context justifies the decision

**Flag:** Context describes the problem in the abstract without naming the concrete constraints/forces that make *this* decision the right one (e.g. existing dependencies, prior art in the codebase, performance/compatibility constraints).

### 4. Alternatives are real, not strawmen

**Flag:** Alternatives are strawmen no one would seriously propose.
**Flag:** A significant alternative is conspicuously missing — one a reviewer would ask "why not X?" about.
**Flag:** A rejected alternative's reason is generic ("more complex") rather than specific to this decision.

### 5. Consequences are honest, not one-sided

**Flag:** Consequences only list benefits — no trade-offs, risks, or follow-up work acknowledged.
**Flag:** A consequence implies follow-up work that isn't flagged as such (compare: ADR-001's explicit "Follow-up work" note in Consequences).

### 6. Over-specification

Is the ADR constraining detail that should be left to implementation rather than decided here?

**Flag:** Decision specifies exact method signatures, variable names, or line-level code — that belongs in the implementation, not the ADR.

### 7. Scope guard compliance

**Flag:** The ADR (or its history) shows evidence of having created or modified anything under `specs/` directly — `adr-create`'s scope guard says it never should; only `/speckit-specify` does that, and only when explicitly invoked.

### 8. Voice and audience

Would a competent engineer new to the project understand this decision from the document alone — or does it read like a transcript of the authors arguing with themselves? Design documents drift this way gradually; the drift is invisible to whoever wrote them. See `adr-create`'s "Voice and audience" section for the rules being checked, and prefer the project's own `design/adr/README.md` audience statement if it has one.

**Flag:** Context opens on paperwork rather than forces — parent RFC citations and document numbers before the reader knows what is being decided or why. Test it: delete every `§`-reference and document number from section 1; if what's left no longer explains why a decision is needed, quote it and propose a replacement opening.
**Flag:** Defensive framing — a construction whose negated half names a *fault* rather than a real alternative ("deliberate rather than stylistic," "economical rather than careless"). Contrastive framing that carries information ("a tool, not the system itself") is correct and should be left alone; don't flag it.
**Flag:** A rejected alternative that argues with imagined pushback instead of stating its reason and stopping.
**Flag:** Consequences that apologize for a trade-off or pre-justify it, rather than stating it plainly and naming the follow-up work.
**Flag:** A project-specific term or artifact used without introduction where a newcomer would stall — an ADR carries more such detail than an RFC by design, so each one needs a clause saying what it is on first use.
**Flag:** A sentence that stops meaning what it meant once its `(§2.3)` parenthetical is removed — cross-references are navigation, not argument.

Cheap mechanical pre-pass — this drifts gradually and is far easier to see relatively than absolutely, so compare against the siblings in the same directory:

```bash
printf "%-56s %6s %6s %6s %6s %6s\n" FILE lines rthr notX self proj
for f in design/adr/ADR-*.md; do
  printf "%-56s %6s %6s %6s %6s %6s\n" "$f" \
    "$(grep -c . "$f")" \
    "$(grep -o "rather than" "$f" | wc -l | tr -d ' ')" \
    "$(grep -oE ", not [a-z]" "$f" | wc -l | tr -d ' ')" \
    "$(grep -oiE "this (RFC|ADR|subsection|section|document)" "$f" | wc -l | tr -d ' ')" \
    "$(grep -oiE "th(is|e) project('s)?" "$f" | wc -l | tr -d ' ')"
done
```

A document that's an outlier on several columns at once, normalized for length, is drifting. Judge the prose, not the counts — the numbers only tell you where to read closely.

## Output Format

```
## ADR Review: [ADR-NNN title]

### Summary
[2-3 sentences: overall assessment and whether it's ready for accepted status / to seed a spec]

### Blocking Issues
[Must be resolved first. For each: criterion, problem (quote), suggested revision.]

### Advisory Issues
[Worth addressing but not blocking. Same format.]

### Strengths
[What's working well and should be preserved.]
```
