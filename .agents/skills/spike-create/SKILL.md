---
name: "spike-create"
description: "Create or update a time-boxed spike: a small, disposable-scope investigation that answers a specific open question from a parent RFC (usually its Appendix or Open Questions), so a later ADR can commit to a decision informed by real findings instead of a guess."
argument-hint: "Reference a parent RFC (RFC-NNN) plus the question being spiked, or 'update SPIKE-002 ...' to revise"
compatibility: "Requires design/spikes/ directory (created automatically on first use) and at least one existing parent RFC in design/rfc/"
metadata:
  author: "zebra-space"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty). If empty, ask the user which parent RFC's open question this spike investigates.

## Purpose

A spike answers a specific empirical question an RFC left open — typically a "some may benefit from a time-boxed spike" note in its Appendix, or an Open Question — by actually building or testing something small enough to stay disposable in scope. Its job is to turn an "unmeasured" or "unknown" cell in an RFC's comparison into a real finding, so the eventual ADR commits to a decision informed by evidence rather than a guess.

A spike is deliberately lighter-weight than an RFC or ADR: no alternatives-considered section, no formal decision to record, no requirement to route through speckit. It's expected to happen in its own git worktree/branch off the motivating RFC's branch, so multiple spikes (e.g. one per candidate approach) can run independently and in parallel without touching each other's dependencies or the RFC's own edits.

**Scope guard**: this skill only creates/updates the spike's `SPIKE.md` (and leaves room for whatever code/fixtures the spike itself produces, committed alongside it). It never invokes `/speckit-specify`, `/rfc-create`, or `/adr-create`, and it never edits the parent RFC — citing a spike's findings back into the RFC is a deliberately manual step the user takes later (unlike ADR's automated speckit backlink, spike-to-RFC linking is not automated, since a spike's findings are usually paraphrased/summarized into the RFC rather than copied verbatim).

## Outline

1. **Require a non-main branch before making any changes**:
   - Run `git branch --show-current` (skip this whole check silently if not inside a git
     repository).
   - Determine the repository's main branch: prefer the short name from
     `git symbolic-ref refs/remotes/origin/HEAD`; fall back to `main` if that's unavailable.
   - If the current branch **is** the main branch, **STOP** — do not create or edit any file.
     Tell the user: spikes should be authored on a feature branch (ideally its own worktree
     branched off the motivating RFC's branch — see Purpose), not directly on the main branch.
     Ask them to create/switch to a branch and re-invoke `/spike-create`.
   - Otherwise, proceed — this applies to both create and update.

2. **Resolve the parent RFC(s) — at least one required**:
   - Scan `$ARGUMENTS` for **all** `RFC-<N>` references (not just the first) — bare, zero-padded,
     filename, or `@design/rfc/RFC-003-*.md` path form.
   - Resolve each against `design/rfc/` (normalize numeric padding when matching).
   - **If no RFC reference is found, or none resolve to an existing file: STOP.** Do not create
     the spike. Tell the user: a spike must reference at least one existing parent RFC — if none
     exists yet, run `/rfc-create` first; otherwise list the RFCs found in `design/rfc/` and ask
     which one's open question this spike investigates.
   - Unlike an ADR, the parent RFC does not need to be past `draft` status — spikes exist
     precisely to inform a still-undecided RFC.

3. **Determine create vs. update** for the spike itself, using the same `SPIKE-<N>` resolution
   logic (bare/zero-padded/directory-name/`@`-path) against `design/spikes/` as `rfc-create`/
   `adr-create` use for their own docs.

4. **For create**: determine the next sequential number.
   - `mkdir -p design/spikes` if it doesn't exist.
   - Scan `design/spikes/` for directories matching `SPIKE-(\d+)-*`, take the max, add 1,
     zero-pad to 3 digits.
   - Generate a concise short name (2-4 words, kebab-case) for the question being spiked.
   - Target: **always** `design/spikes/SPIKE-<NNN>-<short-name>/SPIKE.md` — a directory, even
     when the spike won't produce any code worth keeping (e.g. a manual audit rather than a
     coded experiment). Any code/fixtures the spike produces belong in this same directory
     (e.g. a `scripts/` subfolder), committed normally — spikes are kept for future reference,
     not deleted once concluded.

5. **Write `SPIKE.md`** with this structure:

   ```markdown
   ---
   id: SPIKE-<NNN>
   title: <Title>
   status: planned
   rfcs: [RFC-<NNN>]
   created: <DATE>
   ---

   # SPIKE-<NNN>: <Title>

   ## 1. Question

   The specific empirical question this spike answers — cite the parent RFC's Open Question
   number or Appendix criterion/section it resolves (e.g. "RFC-003 §9.3: does GLiNER2 achieve
   usable accuracy on this catalog's clue text?"). One question per spike; if there are several
   genuinely independent questions, prefer separate spikes so each stays time-boxed and each can
   run in its own worktree.

   ## 2. Method

   What will be (or was) built or tested to answer the question — concrete enough that the
   result is reproducible, but no more formal than that. No requirement for a design/plan
   section beyond this.

   ## 3. Time-box

   The explicit duration or deadline for this spike (e.g. "4 hours", "1 day"). A spike that
   can't be time-boxed is probably not a spike — it's feature work, and belongs behind an ADR
   and `/speckit-specify` instead.

   ## 4. Notes

   _(optional — include only for a spike expected to accumulate many small decisions across a
   working session, e.g. an iteratively playtested prototype; omit for a single build-and-measure
   spike where Findings alone will suffice)_

   A running, dated log kept **during** the work, not reconstructed from memory afterward — one
   entry per decision or observation worth keeping: a tuning choice and why, a piece of feedback
   and the change it drove, a dead end and why it was abandoned. This exists because the
   conversation that produces a spike is not durable (it may be summarized away as the session
   grows, and a future session touching this spike has no access to it at all) — the moment a
   decision is made is the moment to write it here, not something to defer to a Findings pass at
   the end. Findings then distills this log's signal; it doesn't replace keeping the log.

   ## 5. Findings

   _(filled in once the spike concludes)_ — the actual results: numbers, examples, failure
   cases. This is the part worth citing back into the parent RFC.

   ## 6. Conclusion

   _(filled in once the spike concludes)_ — what the findings mean for the parent RFC's
   decision: which candidate approach(es) look more or less viable, and any concrete text the
   user can paste into the RFC's Appendix/Open Questions when they manually update it (see
   Purpose — that citation is a manual step, not automated by this skill).
   ```

   Number sections sequentially like the RFC/ADR templates, for the same cross-referencing
   reason, even though a spike is much shorter than either. Omitting section 4 entirely (rather
   than leaving it as an empty placeholder) is correct when it doesn't apply — renumber the
   remaining sections down if so.

6. **For update**: apply requested edits directly — most commonly, appending a dated entry to
   Notes as a decision is made (the common case while a spike is actively `in-progress`), or
   filling in Findings/Conclusion and transitioning `status` (`planned` → `in-progress` → `done`,
   or `abandoned` if the spike is dropped before concluding) once it wraps up. If the spike
   predates section 4 and has no Notes section, add it (renumbering Findings/Conclusion down)
   rather than skipping the log. Do not add an alternatives-considered or consequences section —
   that formality belongs to the ADR the spike's findings eventually feed into, not the spike
   itself.

7. **Maintain the index**: `design/spikes/README.md` holds a living index table
   (`Spike | Title | Status | RFCs`).
   - If `design/spikes/README.md` doesn't exist yet, create it (a short format doc mirroring
     `design/rfc/README.md`/`design/adr/README.md`'s style, plus an empty index table) before
     continuing.
   - Create: append a new row for this spike, its `RFCs` column listing every parent RFC.
   - Update: refresh this spike's existing row in place — don't duplicate or reorder other rows.
   - Do **not** add or edit anything in the parent RFC's own file — per this skill's scope guard,
     citing a spike's findings back into the RFC is a manual step the user takes separately.

## Completion Report

Report:
- The spike's directory/file path (created or updated), and its parent RFC(s).
- Its `status`.
- If newly created: remind the user it's meant to be time-boxed and disposable-scoped, suggest
  running the actual investigation in its own git worktree if not already there (e.g.
  `git worktree add ../<repo>-spike-<NNN> -b spike/<NNN>-<short-name>`), and that findings should
  be manually cited back into the parent RFC's Appendix/Open Questions once concluded — this
  skill won't do that automatically.
