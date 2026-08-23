# Catalog TODO

Working notes for growing the catalog (TODO.md item 1 at the repo root). This is scratch
tracking for us, not part of the public catalog — `README.md`'s Index table remains the
catalog of record; nothing here duplicates it.

## Backlog

Puzzle ideas queued up but not yet written. Move an idea to `puzzles/` (per README.md's
"Adding a puzzle" steps) and delete it from here once it exists.

- **A subjective puzzle where the hard and soft readings of the premise disagree.** In PZL-0036
  the premise read as a hard constraint ("cat not adjacent to dog") and as a soft objective
  ("maximize cat–dog distance") happen to select the same arrangement, so that puzzle isolates
  question (a) — is it a constraint at all — and never exercises (b). A variant tuned so the two
  readings pick *different* arrangements would test the hard-vs-soft modeling decision RFC-004
  §5.2 says nothing in the pipeline can currently represent.
- **Harder deterministic puzzles.** The Deterministic column is 14 puzzles of fairly modest size
  (root `TODO.md` item 1 asks for "harder zebra-style, larger domains"); every category added
  since is a *kind* of difficulty rather than a *degree* of it.

## Coverage

Rough count of existing puzzles by category (not tracked in puzzle frontmatter yet — this is
our own bookkeeping until/unless a `category` field gets formalized).

| Category | Count | Puzzles |
|---|---|---|
| Deterministic | 14 | PZL-0001–PZL-0014 |
| Non-problem | 7 | PZL-0015–PZL-0021 |
| Optimization | 6 | PZL-0022–PZL-0027 |
| Ambiguous | 5 | PZL-0028–PZL-0032 |
| Subjective | 7 | PZL-0033–PZL-0039 |

PZL-0015–PZL-0021 are non-problems by construction, each targeting one named condition from
[RFC-004](../design/rfc/RFC-004-computational-decision-making.md) §5.1's well-posedness ladder
(condition names, not numbers, per that RFC's own convention):

| Puzzle | Condition failed |
|---|---|
| PZL-0015 | Demand (wrong level — an imperative about the modeling act) |
| PZL-0016 | Demand (no demand at all) |
| PZL-0017 | Determinate answer-space (open, unenumerable candidate set) |
| PZL-0018 | Relevance (a solvable model that answers a different question) |
| PZL-0019 | Constitutive constraints (defeasible, not categorical) |
| PZL-0020 | Determinate atoms (predicates need a valuer) |
| PZL-0021 | Sufficiency (too few constraints for the declared demand type) |

PZL-0022–PZL-0027 are constraint optimization problems (COPs, RFC-004 §5.2) adapted from named
classic operations-research problems, each with a hand-verified unique optimum recorded in
`eval/answer-keys.json`:

| Puzzle | Classic problem |
|---|---|
| PZL-0022 | Knapsack problem (extends PZL-0014's packing theme) |
| PZL-0023 | Assignment problem |
| PZL-0024 | Diet problem (Stigler's diet, discretized) |
| PZL-0025 | Bin packing problem (packing theme, other direction) |
| PZL-0026 | Weighted interval scheduling (extends PZL-0009's interview theme) |
| PZL-0027 | Traveling salesman problem |

None of these six are solvable end-to-end by the current pipeline: `ExtractedCsp` has no
objective field and `SolveResult` has no optimization outcome (RFC-004 §5.2; root `TODO.md`
item 3 owns closing this gap). They're in the catalog now so the gap is visible and the
puzzles are ready once extraction/solving catch up.

## Ambiguous vs. subjective: what separates them

These started as one `Subjective/ambiguous` row and are now two categories, because they call
for different correct outputs and so need to be scored differently. Both map onto existing
vocabulary — RFC-001 §2's *vague/contextual* and *subjective/preference* clue tiers, and
RFC-004 §5.3's classes 3 and 4 — but the line worth drawing between them is where the
indeterminacy lives relative to the text:

- **Ambiguous** — indeterminacy *inside* the text. A constraint is stated, but its extension
  isn't pinned down: "the green house is to the right of the blue house" could mean immediately
  right or anywhere right. The competing readings are enumerable *from the sentence itself*, and
  fixing one yields a determinate CSP. A **closed-world** problem — everything needed to
  enumerate the readings was handed to the tool.
- **Subjective** — indeterminacy *outside* the text. No constraint is stated at all; a *fact*
  is. "The cat is terrified of the dog" describes the scenario, and becomes a requirement only
  once you import a premise the prose never states (here: that the arrangement ought to reduce
  the cat's fear). The candidate premises come from the reader's world model, not the sentence.
  An **open-world** problem — which is exactly what constitution Principle VI says the tool must
  report rather than resolve on the caller's behalf.

Three nested questions fall out of that, and only the second and third are already covered by
existing docs:

| | Question | Owned by |
|---|---|---|
| a | Is this sentence a constraint at all, or scenery? | nothing yet — the subjective category is about this |
| b | If it is, is it hard (`not adjacent`) or soft (`maximize distance`)? | RFC-004 §5.2's hard-vs-soft modeling decision |
| c | If soft, how does it weigh against other soft terms? | RFC-004 §5.3 class 4's "no privileged weighting" |

They compose, in that order: accept the premise at (a) and you immediately face (b). So a
subjective clue usually has an ambiguity downstream of it — a concrete instance of the
mutual-exclusivity question RFC-004 §7.14 leaves open, and a reason to treat these as two
labels that can co-occur rather than one blended bucket.

Worth noting for the eval: RFC-004 §5.7 lists four flavors of *silent promotion* — inventing a
domain, hardening a defeasible clue, choosing a reading of an ambiguous phrase, supplying a
valuation. The subjective category exercises a fifth that isn't on that list: **inventing a
constraint outright from world knowledge**. Candidate addition to §5.7 next time RFC-004 is
edited.

### Ambiguous puzzles (PZL-0028–PZL-0032)

Each states a constraint whose competing readings give *different* answers — verified by brute
force under both readings, since an ambiguity that lands on the same answer either way tests
nothing.

| Puzzle | Kind of underspecification | Reading A | Reading B |
|---|---|---|---|
| PZL-0028 | Spatial adjacency ("to the right of") | immediately right → unique | anywhere right → 3 solutions |
| PZL-0029 | Boundary inclusivity ("between 10am and 12pm") | exclusive → unique | inclusive → 4 solutions |
| PZL-0030 | Inclusive vs. exclusive "or" | inclusive → unique | exclusive → unsatisfiable |
| PZL-0031 | Comparative baseline ("cheaper than the others") | cheaper than each → unique | cheaper than combined → 3 solutions |
| PZL-0032 | Pronoun reference ("He keeps the dog") | "he" = chemist → painter in house 1 | "he" = painter → chemist in house 1 |

PZL-0032 is the purest case: both readings are fully determinate and they contradict each other,
which is RFC-004 §5.3's "each of which may be perfectly determinate once fixed" exactly.
PZL-0030 is the sharpest warning: picking the wrong reading doesn't yield a wrong answer, it
yields "this puzzle is broken."

### Subjective puzzles (PZL-0033–PZL-0039)

In every case the stated fact constrains nothing on its own, and the puzzle is underdetermined
(or, for PZL-0033, entirely unconstrained) until the premise is supplied. `eval/answer-keys.json`
records both counts, so "correctly refused to invent the premise" is distinguishable from
"failed to solve."

**Two independent axes, not one gradient.** An earlier version of these notes ranked these on a
single "contestability" scale, which conflated two things that come apart: how many readers
would import the same premise (**agreement**), and how bad it is to have ignored a premise that
did apply (**stakes**).

| | Low stakes | High stakes |
|---|---|---|
| **High agreement** | PZL-0033 (ice cream melts) | PZL-0037, PZL-0038, PZL-0039 |
| **Low agreement** | PZL-0035 (seating convention) | — |

| Puzzle | Premise that must be imported | Kind | Agreement |
|---|---|---|---|
| PZL-0033 | Perishable goods ought not be allowed to spoil | Physical common sense | near-universal |
| PZL-0034 | Calcium co-administration impairs absorption, so avoid it | Domain expertise | universal *given* the domain |
| PZL-0035 | The guest of honor sits at the head of the table | Cultural convention | varies by culture |
| PZL-0036 | The arrangement ought to reduce the cat's fear | Normative / ethical | genuinely contested |
| PZL-0037 | Predators ought not be housed within reach of their prey | Welfare / life-and-death | near-universal |
| PZL-0038 | *(same premise — but defeated by the prose; see below)* | Welfare / life-and-death | near-universal |
| PZL-0039 | Staff ought not be exposed to a toxic gas | Safety / life-and-death | near-universal |

**High agreement makes silent promotion harder to detect, not more acceptable.** A universally
held premise is still one the tool was never handed — universality buys *reliable guessability*,
not presence in the text. And it inverts the usual review dynamic: where a contested premise
makes an over-reaching system visibly wrong, a near-universal one makes it look obviously
*right*, because the human reviewer imports the same premise and never notices the text didn't
state it. That makes the high-agreement/high-stakes cell the sharpest test in the catalog rather
than the one to exempt as "basically determinate."

Note also that these premises decompose. "The wolf preys on the rabbit" carries a lexical claim
(wolves eat rabbits — arguably recoverable from the words themselves) and a normative one (we
ought to prevent it). Only the second is imported, which is what makes the next pattern possible.

### The defeated-premise pattern (PZL-0038)

PZL-0038 is PZL-0037's near-twin: same animals, same five pens, same "the wolf preys on the
rabbit." The one difference is that the pens are separated by solid concrete rather than wire
mesh — which defeats the premise's *rationale* without touching the stated fact. Adjacency is
harmless, and the stated clues alone give a unique answer.

| | Text as written | Premise imported anyway |
|---|---|---|
| PZL-0037 (wire mesh) | 2 solutions | 1 solution — premise legitimately applies |
| PZL-0038 (concrete wall) | **1 solution** | **unsatisfiable** |

So a system that pattern-matches "wolf + rabbit → separate" reports a spurious *unsatisfiable*
for a puzzle that has a perfectly good unique answer. This is the only puzzle in the catalog
where importing a premise is affirmatively wrong rather than merely unwarranted, and it's worth
scoring separately: it distinguishes reasoning about the premise from reflexively applying it.
Human reviewers fail this one too, which is the point.

## Dev / held-out split

Per the discussion behind this workstream: the current 14 are the **dev set** — fair game to
inspect while debugging extraction/critic/compiler issues. Puzzles added from here on are
**held-out** — scored by the eval but not used to guide prompt or compiler tuning, so a gap
between dev and held-out pass rates is our overfitting signal.

| Set | Puzzles |
|---|---|
| Dev | PZL-0001–PZL-0014 |
| Held-out | PZL-0015–PZL-0039 |
