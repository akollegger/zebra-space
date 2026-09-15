---
id: SPIKE-011
title: Per-Clue Pipeline Retrospective — Reframing the Metric, Two Free Fixes, a First-Principles Redesign
status: done
rfcs: [RFC-003]
created: 2026-09-15
---

# SPIKE-011: Per-Clue Pipeline Retrospective — Reframing the Metric, Two Free Fixes, a First-Principles Redesign

## 1. Question

[SPIKE-008](../SPIKE-008-per-clue-tool-call-decomposition/SPIKE.md),
[SPIKE-009](../SPIKE-009-graph-style-reconciled-extraction/SPIKE.md), and
[SPIKE-010](../SPIKE-010-full-prose-per-clue-context/SPIKE.md) each measured a per-clue
extraction variant against `full-critic` using "reached a gradable state" (compiles and solves
to *some* outcome) as the headline metric, and all three report that metric improving (or
holding roughly flat) across successive fixes. Two questions this spike asks that none of the
three did directly:

1. **Does "gradable" track the thing RFC-003 actually cares about** — a faithful translation of
   a determinate puzzle's prose into a uniquely-solvable model — or does it reward reaching
   `SOLVE_UNSATISFIABLE`/`SOLVE_MULTIPLY_SATISFIABLE` (both of which mean "the model is wrong")
   as if they were progress? Re-tally all three spikes' own raw JSON records by `SOLVE_UNIQUE`/
   `MATCH` instead, and see whether the story changes.
2. **Given the three spikes' own diagnosed root causes** (SPIKE-008 §5.2: entity-scoping;
   SPIKE-009 §5.3: local-vocabulary identifier collisions; SPIKE-010 §6: a frozen vocabulary no
   downstream call can revise), what pipeline shape — structured as a sequence of choices a
   **weaker model (Haiku-class) could reliably execute**, never as free-text construction —
   would actually close the remaining gap, rather than trading one failure class for another the
   way SPIKE-009's reconciliation did? This is the empirical-review half of RFC-003 §7.1's open
   question (what concrete form the intermediate representation should take) and a direct
   response to RFC-004 §5.7's framing (attributing a failure to the wrong condition is itself a
   failure) applied to the spikes' own metric choice.

Also identifies two concrete, already-fixable bugs surfaced during this review, independent of
either question above, and fixes them in this same pass since they cost little relative to the
spike's own time-box and un-confound any future re-measurement:

- **Stage-1/compile.ts contradiction**: `extract.ts`'s vocabulary-stage prompt instructs
  "invent no values beyond what the prose states," but `compile.ts`'s `compileAdjacency`
  *requires* a numeric positional domain for an ordering clue — one the prose only implies
  ("numbered 1 to 3 from left to right"), never states as an explicit value list. This is
  PZL-0001's identical, un-closed `COMPILE_FAILED` across SPIKE-008/009/010's baseline and every
  variant.
- **No collision defense in `compile.ts`**: `"identifier ... already defined"` MiniZinc errors
  independently broke SPIKE-009's reconciled vocabulary (§5.3, deliberately left unpatched there
  as a "future LLM-assisted pass") and SPIKE-010's single global vocabulary (Notes, "a latent
  `compile.ts`-adjacent risk in the underlying mechanism itself"). SPIKE-010's own Conclusion §3
  names this as the right fix layer.

## 2. Method

**For question 1**: re-parse the three spikes' committed raw JSON
(`SPIKE-008/results/comparison-2026-09-14T14-05-07-883Z.json`,
`SPIKE-009/results/comparison-2026-09-14T15-37-27-397Z.json`,
`SPIKE-010/results/comparison-2026-09-14T16-52-28-634Z.json` — all already paid for, no new
spend) with a small script tallying `variants.*.outcome === "SOLVE_UNIQUE"` and
`variants.*.grade.verdict === "MATCH"` per variant, alongside each spike's own reported
gradable-rate figures, to see whether the two metrics tell the same story.

**For question 2**: read RFC-003, ADR-004, ADR-005, ADR-009, `src/extraction/types.ts` (the
`ExtractedCsp` schema), `src/extraction/extract.ts` (the staged prompts), and `src/compiler/
compile.ts` (what the compiler actually requires vs. what the vocabulary stage is told to
produce), cross-referenced against all three spikes' Notes/Findings sections for every concrete
failure mode they diagnosed directly from stored `.mzn`/JSON output (not just their summary
prose). Synthesize a pipeline design from those diagnosed causes rather than from new
speculation — every design choice below cites the specific finding it responds to.

**For the two fixes**: implement directly against `main`'s `src/extraction/extract.ts` and
`src/compiler/compile.ts` (not spike-local scripts, since these are genuine fixes to the shipped
pipeline, not spike prototypes) — no new billed run required for either, since both are provable
by existing offline tests plus reasoning about the specific failure text every spike already
recorded (PZL-0001's "Could not find a single numeric positional domain..." message, and the
"identifier ... already defined" text seen in SPIKE-009 §5.3 and SPIKE-010 §5).

## 3. Time-box

Half a day (~4 hours): ~1.5h re-tally + write-up of question 1, ~1.5h design synthesis for
question 2 (no new code — the point is a design a future spike would build, not this spike's
own prototype), ~1h implementing and testing the two fixes.

## 4. Notes

**2026-09-15 — re-tally script and raw numbers.** Wrote a short inline script over the three
spikes' committed JSON (not persisted as a file — the tallies are reproduced directly in
Findings below and are trivially re-derivable from the cited JSON paths):

```
S8  full-critic:              SOLVE_UNIQUE 9/14, MATCH 2/14, cost $2.096
S8  per-clue (post-fix):      SOLVE_UNIQUE 0/14, MATCH 0/14, cost $0.031
S9  per-clue+reconcile:       SOLVE_UNIQUE 1/14, MATCH 0/14, cost $0.071
S10 per-clue+full-prose:      SOLVE_UNIQUE 0/14, MATCH 0/14, cost $0.049
```

None of the three per-clue variants' "2/14 passing" figures are a `SOLVE_UNIQUE`/`MATCH` —
every one is `READING_MATCHED` (PZL-0028, the ambiguous puzzle) or `PREMISE_FREE_MATCH`
(PZL-0033, the subjective puzzle), both soft-pass verdicts ADR-007 §2.1 defines specifically for
non-determinate puzzle classes. On the 11 determinate puzzles in the 14-puzzle sample, every
per-clue variant across all three spikes scored zero. `full-critic` scored 2 (PZL-0004,
PZL-0011).

**2026-09-15 — the PZL-0001 contradiction, confirmed by reading both sides.**
`vocabularySystemPrompt()` (`src/extraction/extract.ts`) says only: identify entities, identify
domains ("each with a variable name, the entity type it ranges over, and its finite set of
values"), "invent no values beyond what the prose states." Nothing there tells the model that an
*implicit* ordering ("three houses in a row, numbered 1 to 3 from left to right") needs its own
declared domain — the prose states the *fact* of an order, not a value list to copy. Meanwhile
`compileAdjacency` (`src/compiler/compile.ts:509-551`) requires, for any `adjacency` constraint
with no explicit `variable` field, that exactly one **numeric** domain be shared by both named
entities — with no fallback and no synthesis path. `constraintsSystemPrompt()` (stage 2, same
file) *does* explain adjacency's `variable` field, but by stage 2 the vocabulary is already
frozen (ADR-009's whole staging premise) — stage 2 can reference an existing domain but cannot
add a new one. This is exactly the "vocabulary must be revisable" root cause SPIKE-010 named,
narrowed to one concrete, reproducible instance: PZL-0001 fails identically in SPIKE-008's
baseline, SPIKE-009's reconciled run, and SPIKE-010's full-prose run, always with the identical
compiler message.

**2026-09-15 — the collision bug, confirmed by reading `compile.ts`'s identifier emission.**
`sanitizeIdentifier` (`compile.ts`) has no uniqueness check — nothing prevents two different
domain variables, or a domain value and a domain/entity-type name, from mapping to the same
sanitized MiniZinc identifier. `enum`/`var` declarations are emitted directly from these
sanitized names with no collision detection at any point. This matches SPIKE-009's own postscript
(reconciled vocabulary's disambiguation-suffix concatenation reintroduced the identical class of
bug it was built to prevent, twice, at different code sites) and SPIKE-010's Notes (a fresh
one-shot global vocabulary call independently produced two domains whose sanitized names
collided) — two structurally different producers hit the same undefended compiler surface.
Fixing it once in `compile.ts` hardens every future extraction architecture, per SPIKE-010's own
Conclusion §3 recommendation.

**2026-09-15 — implemented fix 1: vocabulary-stage prompt now tells the model to name orderings
explicitly.** Added one paragraph to `vocabularySystemPrompt()` instructing the model to declare
a dedicated ordered/positional domain (values `"1"`, `"2"`, ... in sequence) whenever the prose
establishes a spatial or temporal order among entities, even when no such values are stated as
literal words — reframing "don't invent values" as applying to *content* (never invent a color
or a name), not to the *existence* of an implied ordering domain the puzzle's own scenario
establishes. This targets PZL-0001's root cause directly: giving stage 1 the missing instruction
before vocabulary freezes, rather than patching around it downstream.

**2026-09-15 — implemented fix 2: `compile.ts` now detects and fails loudly on identifier
collisions before emitting any MiniZinc.** Added a collision check immediately after all
domain/entity-type sanitized names are known and before any `enum`/`var` line is emitted: builds
a map from sanitized identifier back to every distinct source name that produced it, and fails
with a `CompileError` naming the colliding source strings and the shared identifier if any
bucket has more than one distinct source. This converts today's confusing downstream MiniZinc
syntax error (`"identifier \`X' already defined"`, which names the mangled identifier, not the
two source strings that collided) into an actionable extraction-stage diagnostic, and — per
ADR-004 §2.4's critic-loop design — this is exactly the kind of structured, specific compile
error the revision prompt already knows how to consume. It does not *prevent* collisions (that
would require inventing a disambiguation scheme, which is exactly the failure class SPIKE-009
introduced by doing so ad hoc); it converts a silent/confusing failure into a loud, specific,
revisable one.

## 5. Findings

### 5.1 The metric the three spikes optimized was the wrong one

| Variant | Spike | "Gradable" (spike's own metric) | `SOLVE_UNIQUE` | `MATCH` | Cost (14 puzzles) |
|---|---|---|---|---|---|
| `full-critic` | S8 baseline | 13/14 | **9/14** | **2/14** | $2.096 |
| `per-clue` (post-fix) | S8 | 8/14 | 0/14 | 0/14 | $0.031 |
| `per-clue+reconcile` | S9 | 9/14 | 1/14 | 0/14 | $0.071 |
| `per-clue+full-prose` | S10 | 9/14 | 0/14 | 0/14 | $0.049 |

Gradable rate moved from 4/14 → 8/14 → 9/14 → 9/14 across the three spikes' successive fixes,
read by each spike as incremental progress. `SOLVE_UNIQUE` — a uniquely-solvable model, the
precondition for `MATCH` on a determinate puzzle — never exceeded 1/14 for any per-clue variant,
against `full-critic`'s 9/14. `SOLVE_UNSATISFIABLE` and `SOLVE_MULTIPLY_SATISFIABLE` both count
as "gradable" under the spikes' own metric, but both mean the extracted model is wrong (an
over-constrained or under-constrained translation) — on a puzzle the catalog has already
confirmed is determinate, neither is progress toward RFC-003's actual goal. The dollar-cost
comparisons all three spikes lead with (35-70x cheaper) are accurate and real, but they were
computed against a metric that was moving for the wrong reason: cheaper variants were reaching
a *gradable-but-wrong* state more often, not a *correct* one.

This reframing does not overturn any single spike's narrower conclusion (SPIKE-008's
entity-scoping fix really did close that specific bug; SPIKE-009's reconciliation really did
trade one failure class for another; SPIKE-010's full-prose context really didn't help) — those
per-mechanism findings hold under either metric, since none of the three ever produced a
`SOLVE_UNIQUE`/`MATCH` gain to begin with. What changes is the headline: none of the three
per-clue variants is currently a viable **replacement** for `full-critic` on determinate
puzzles, only a much cheaper way to reach a *worse* class of failure.

### 5.2 Two structural bugs, confirmed by direct code reading (not a new billed run)

**PZL-0001's contradiction**: `vocabularySystemPrompt()` never mentions that an implied ordering
needs its own declared domain; `compileAdjacency` requires exactly one numeric shared domain and
has no synthesis fallback. This single gap explains why PZL-0001 fails identically —
`COMPILE_FAILED`, identical message — across every per-clue variant in all three spikes, and why
SPIKE-009's dedicated reconciliation mechanism (built specifically to synthesize a positional
domain for exactly this case, per its own §2 step 5) still only got PZL-0001 to a `SOLVE_
UNSATISFIABLE`/mismatch, not a match — reconciliation can only synthesize a domain *stage 1
never told it needed to exist in the first place is a separate question from* whether the
synthesized domain's *values* are the right ones, and a `SOLVE_UNSATISFIABLE` on this specific
puzzle is more likely explained by a different, unrelated constraint-extraction defect than by
this fix — not verified further within this spike's time-box.

**The collision bug**: no code path in `compile.ts` ever checks whether two distinct source
names map to the same sanitized MiniZinc identifier before emitting `enum`/`var` declarations
built from them. SPIKE-009 (§5.3, an entity-type/value collision and a cross-entity-type
variable-name collision, both patched ad hoc in that spike's own reconciliation code — never in
`compile.ts` itself) and SPIKE-010 (Notes: a single one-shot global vocabulary call hitting the
identical class of MiniZinc error, from code that never went near SPIKE-009's reconciliation
logic at all) hit this same undefended surface independently, confirming it's a property of
`compile.ts`'s identifier emission, not of either spike's own extraction architecture.

### 5.3 A first-principles pipeline design for a weaker model, synthesized from the three spikes' own diagnosed root causes

Every one of the three spikes' remaining failures reduces to the same shape: a call was asked to
**construct** something (a vocabulary, an identifier, a nested constraint tree) instead of
**choose** from a small enumerated/closed set, or the call that could have fixed a problem ran
*before* the information needed to fix it was available (frozen vocabulary, per SPIKE-010's own
Conclusion). A pipeline built for a materially weaker model than any spike so far tested
(`gpt-4o-mini`) needs to remove construction from every LLM-facing step, and needs vocabulary
decisions to be revisable using evidence only a later step can see:

1. **Segment** (no LLM where `splitClues`'s numbered-list heuristic already works — SPIKE-008
   Notes found this covers 11/14 puzzles cleanly; only the remaining 3 need a model call, and
   that call's only job is copying atomic assertions verbatim, checked as a literal-substring
   match against the source).
2. **Inventory**: list every named thing mentioned, as literal spans copied from the prose —
   no types, no ids, no grouping yet. Validated by literal-substring containment. This is the
   most reliably-executable operation available to any model, strong or weak.
3. **Group**: given the numbered inventory, ask which entries denote the same category —
   answered as **indices into the inventory**, never as re-typed strings. This directly
   forecloses SPIKE-009's entire new failure surface (casing/punctuation/hyphen-vs-underscore
   equivalence bugs, all downstream of letting the model re-type a name instead of pointing at
   one) at the representation level, not via a sanitization pass applied after the fact.
4. **Shape**: a small, fixed set of multiple-choice questions whose answers *are* the modeling
   decisions today's stage 1 currently makes unobserved and unrevisable in one shot — is this a
   grid (entity-indexed, needs `allDifferent`) or independent choices; is there a spatial/
   temporal ordering; if so, is it over an existing named group or an implicit position 1..N.
   This is the direct, general-purpose fix for the PZL-0001 class of bug (§5.2): the ordering
   question is asked and answered explicitly, and the positional domain is synthesized by code
   from a yes/no answer, not left to a single global prose-reading pass to notice unprompted.
5. **Per-clue typing**: a two-step choice, not a single tool-call filling an arbitrarily deep
   schema — first pick which of a handful of plain-English clue templates this clue instantiates
   ("X is Y" / "X is not Y" / "X is immediately left/right of Y" / "no constraint," etc.), then
   fill *that template's* slots as enums over inventory indices. Splitting template-selection
   from slot-filling is what keeps each individual call's schema small (SPIKE-008 offered all
   nine `ExtractedConstraint` kinds' tools at once per clue; a two-step choice needs only the
   chosen template's few slots).
6. **Compile/solve as a repair oracle, not a fidelity gate** (consistent with RFC-003 §7.3's
   existing resolution that solvability and translation-fidelity are orthogonal claims): a
   compile failure names the offending clue directly and re-asks only that clue's step-5 choice
   with the error attached; `SOLVE_UNSATISFIABLE`/`SOLVE_MULTIPLY_SATISFIABLE` on a puzzle the
   catalog already declares determinate is itself evidence of a lost or wrong constraint (SPIKE-
   008's own grounded-revision critic already builds the drop-one-clue/diff-solutions mechanics
   needed for this, per its §5.4 findings) and should trigger targeted re-asking of the
   implicated clues, not a whole-document critic pass.
7. **Back-translation only where the oracle points**, not on every clue (SPIKE-008's back-
   translation variant ran on all of them and paid ~2.4x for it per §5.1's cost table, without a
   correspondingly larger correctness gain per §5.4).

Two representational consequences follow directly from this design, not proposed independently
of it: identifiers are never typed by a model at any step (step 3 refers to inventory indices;
code alone assigns canonical MiniZinc-safe names), which removes SPIKE-009's failure class by
construction rather than by a sanitization/collision-detection patch layered on afterward; and
the `ExtractedCsp` schema itself (69k chars, 134 `anyOf` unions, depth 39 — `src/extraction/
types.ts`'s own comments) never needs to be the thing an LLM speaks — it becomes a compiler
target produced deterministically from the small, flat, per-step choices above, the same
direction ADR-005 already took MiniZinc emission.

This design is **not built or measured in this spike** — synthesizing it from the three spikes'
own diagnosed causes was this spike's question 2, and building/measuring it is exactly the scope
a future SPIKE-012 (or an ADR informed by one) should take up, per RFC-003 §7.1's still-open
question about the intermediate representation's concrete form.

## 6. Conclusion

**On the metric**: `full-critic` remains the only mechanism in this project's own evidence that
reliably produces a correct, uniquely-solvable model on determinate puzzles (9/14 `SOLVE_UNIQUE`,
2/14 `MATCH`) — no per-clue variant across three spikes has matched that on a single determinate
puzzle. The cost advantage those spikes found (35-70x cheaper) is real and durable across every
variant, but it currently buys a materially *worse* correctness outcome, not a comparably-good
one at lower cost. Any future ADR drawing on SPIKE-008/009/010 should report `SOLVE_UNIQUE`/
`MATCH` alongside "gradable rate," not in its place — the latter alone made three successive
negative-on-correctness results read as incremental wins.

**On the two fixes**: both are implemented in this same pass (see git history on this branch).
Neither requires or is validated by a new billed run within this spike's time-box — the
vocabulary-prompt fix is validated by matching it directly against `compileAdjacency`'s existing,
unchanged requirement (the fix makes stage 1's instructions consistent with what stage 2/compile
already need, rather than introducing a new requirement); the collision-detection fix is a pure
compile-time check exercised by new unit tests. **A live re-run of SPIKE-008/009/010's 14-puzzle
sample against a future spike or ADR's design is the way to confirm whether either fix moves the
`SOLVE_UNIQUE` numbers** — not claimed here, since it wasn't measured here.

**Recommended next steps, in order**:
1. Do not draft the RFC-003-superseding ADR SPIKE-008 §6 recommended, on the current evidence —
   that recommendation was made under the "gradable rate" framing this spike's §5.1 finding
   revises; an ADR now would be committing to a direction (some per-clue architecture) with zero
   demonstrated `SOLVE_UNIQUE` wins to justify it.
2. Spike the §5.3 design (inventory → group → shape → per-clue template-typing → oracle-guided
   repair) as its own time-boxed investigation, reporting `SOLVE_UNIQUE`/`MATCH` as the headline
   metric from the start, with n≥3 samples per puzzle (every prior spike's single-sample-per-cell
   caveat — SPIKE-005's own, repeated in SPIKE-008/009/010 — means none of the existing numbers,
   including this spike's re-tally, can distinguish a real effect from run-to-run LLM sampling
   variance; SPIKE-008 through SPIKE-010's own $0.03-0.07-per-14-puzzle cost floor affords this
   directly).
3. Re-run the same 14-puzzle sample against `full-critic` (unmodified) and against SPIKE-008's
   `per-clue` baseline once both fixes from this spike have landed, to check whether either
   closes any of the sample's remaining `COMPILE_FAILED`/`SOLVE_ERROR` puzzles before a future
   spike's more invasive redesign is needed to explain what's left.
