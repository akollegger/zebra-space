---
id: RFC-005
title: Progressive Puzzle Game Mechanics
status: draft
created: 2026-08-24
adrs: [ADR-006]
---

# RFC-005: Progressive Puzzle Game Mechanics

## 1. Summary

A zebra puzzle is normally consumed as a static block of clues: the reader gets everything at
once and works alone. This RFC proposes an interactive alternative — a short-session game about
the two decisions an AI engineer makes when preparing a reasoning task: what belongs in the
context window, and how much of the reasoning to complete before handing that context to a
model. Evidence arrives as a small deck of claims in text or image. For each card the player
renders one binary judgment — keep it as useful context or ignore it as irrelevant, redundant,
or ungrounded material. The player may then spend a small ledger cost on a pre-flight audit of
the assembled context: reference search detects missing grounding, similarity search detects
duplication, and graph/constraint search detects an insufficient connection to an answer. The
session closes by submitting curated facts alone, or curated facts plus a resolved answer. A
session is designed to be played in minutes, not hours: a deck of a dozen-odd cards, seconds per
judgment, and one closing choice. Because a card is a claim in costume, the same machinery hosts
any puzzle domain — office assignments, cargo manifests, seating charts — as reskinned decks.

## 2. Problem / Motivation

The project catalogs hand-authored prose puzzles, verifies their solvability with a constraint
solver ([ADR-002](../adr/ADR-002-adopt-minizinc-solver.md)), and extracts constraint models from
their natural language ([ADR-004](../adr/ADR-004-llm-extraction-critic-loop.md)). Generation
itself is designed but unbuilt ([RFC-001](RFC-001-parameterizable-puzzle-generation.md)). What
none of it can do yet is put a puzzle in front of a person as an *experience*. A static clue list
exercises none of the pipeline's most interesting properties: that consistency is checkable
claim-by-claim, that the number of remaining solutions is computable after every filed fact, and
that clues come in genuinely different kinds — strict, ambiguous, and subjective — that demand
different reasoning from the solver and, it turns out, from the player.

Those three kinds are shorthand throughout this RFC for RFC-001 §5.1's clue-strictness tiers
(strict/explicit, vague/contextual, subjective/preference-based), reconciled with
[RFC-004](RFC-004-computational-decision-making.md) §5.3's problem classification; RFC-004 §9
maps the two onto each other.

A game is the forcing function, and this design stands on two shipped precedents. From *Papers,
Please* (Lucas Pope, 2013) — with *Reigns* (Nerial, 2016) as proof that a binary swipe can carry
deep decisions — it borrows fast, consequential judgment under limited information. From *Lil'
Guardsman* (Hilltop Studios, 2024) it retains costed escalation and forgiveness for wrong turns,
but not its per-item advisor-selection structure. Every mechanic proposed here has a beloved
proof of existence.

The framing is chosen to do structural work, not just flavor:

- **The player curates rather than discovers.** The complete solution exists behind the deck;
  the task is to select the smallest reliable context that supports the declared question. This
  makes solution-first authoring honest and maps directly to context engineering.
- **The declared question supplies Demand.** Each deck names one question before cards appear.
  Later decks may instead be ill-posed: their correct closing move is to return an unanswerable
  request with its defect named, applying RFC-004 §5.3's non-problem class at deck granularity.
- **Claims are evaluated rather than interrogated.** Each card is a candidate context item.
  Keeping it is a provisional relevance judgment; assessment of the selected set is consistency,
  sufficiency, and redundancy checking — operations the solver and retrieval tools can support.
- **Cards are constraints in costume.** The deck schema (entities, attributes, claims, one
  closure) is domain-neutral, so the puzzle catalog becomes a deck library and new domains are
  reskins, not rebuilds.

The casual register imposes the design's hardest constraint: interactions must be minimal
enough to avoid paradox of choice, while still relaying information efficiently. Serialized
binary judgments — one card at a time, swipe left or right — are the established solution to
exactly that problem. And the whole experience must fit in **minutes, not hours**: that bounds
deck size, session length, and interaction style before any mechanic is designed.

This extends the project's stated purpose, which names four capabilities — generating puzzles,
modeling them as CSPs, representing constraints as graphs, solving them — and no application
built on top of them. The game is deliberately positioned as a **consumer** rather than a fifth
capability: it sits on the caller side of the constitution's Principle VI ("A Callable Tool, Not
a Decision System"), invoking solving and extraction as callable tools and making every judgment
call itself, which is why §5.7 states its needs as consumer requirements rather than designs.
Whether it ships in this repository or a dependent one is left to a child ADR; if it ships here,
`CLAUDE.md`'s Purpose section needs a corresponding amendment.

## 3. Goals

- Define a **card-processing turn loop** in which evidence arrives as a small deck, each card
  receives one binary player judgment (keep as context / ignore), the selected record can be
  reconsidered, and the session ends in one closing choice.
- Define a **ledger economy** in which judgment is free, an optional pre-flight audit costs a
  small amount, sound curation earns credit, and confidently wrong answers lose more.
- Define a **pre-flight retrieval audit** over the assembled context: reference, similarity, and
  graph/constraint checks report missing grounding, duplication, or insufficient connection
  without naming the corrective card.
- Make **context selection a first-class challenge**: decks mix required facts, redundant or
  substitute carriers, and consistent-but-non-constraining noise. A card's final value may depend
  on what other evidence the player retained.
- Establish the **session-shape constraints** ("minutes, not hours"; casual, swipe-speed
  interaction) as hard design bounds that cap deck size, per-card decision weight, and UI
  complexity.
- Make the clue-tier spectrum (strict → ambiguous → subjective) the game's difficulty
  progression, extended by the framing to a fourth stage: **ill-posed cases** whose correct
  closure is a classified refusal.
- Specify a **domain-neutral deck schema** so the same mechanics host multiple puzzle domains
  as content, not code — including **card modality** (text, image, or both), since a bureaucratic
  file naturally holds photographs and ledger scraps alongside testimony, and an image is
  ambiguity's most natural carrier.
- Specify what the game needs from the existing pipeline — generation, solving, extraction —
  as consumers' requirements, without redesigning any of those subsystems.
- Leave room for **sample scenarios** as appendices, to be developed as worked examples before
  any ADR commits to mechanics details.

## 4. Non-Goals

- Selecting a game engine, UI framework, or rendering approach. This RFC defines mechanics; a
  child ADR owns the technology choice.
- Writing narrative content — the bureaucracy's setting, characters, dialogue, humor, or any
  specific domain skin. The mechanics must *host* narrative and skins; the content itself is
  production work.
- Difficulty calibration methodology. The tier progression is named here as the difficulty
  axis; how decks are tuned within it is a later concern that consumes the solver-in-the-loop
  capability.
- Cross-session progression, leaderboards, or persistence. A session is self-contained by
  design; progression, if any, is a later product concern rather than the meaning of this
  session's ledger.
- Free-text player input of any kind. Binary swipes plus occasional bounded follow-ups are a
  deliberate scope decision (§5.2), not a placeholder for future natural-language interaction.
- Designing the retrieval infrastructure behind the pre-flight audit (search indexes, graph
  store, models, or prompts). This RFC specifies observable findings; child ADRs own it.
- Monetization, platform targets, accessibility standards. Real concerns, out of scope for a
  mechanics RFC.

## 5. Proposed Approach (high-level)

### 5.1 Solution-first deck construction

A deck begins as a completed grid — every entity assigned every attribute — plus a constraint
set that uniquely determines it, drawn from or generated alongside the existing catalog. From
that solved state, construction works backward into a deck:

1. **Write the task brief.** It states the declared question, entities, and attribute domains.
   It supplies enough grounding to make the task legible, never enough to solve.
2. **Deal the constraints into cards.** Each earnable constraint becomes a card, voiced by a
   carrier — an interviewee's claim, a ledger entry, a memo. The same underlying constraint may
   appear on more than one card in different voices.
3. **Add irrelevant and substitute material.** Noise cards are consistent with the solution but
   constrain nothing: true trivia, ungrounded detail, or gossip. A duplicate carrier is not
   necessarily noise: it may be unnecessary only when an equivalent carrier was retained. These
   judgments are defined **relative to the task brief**, which supplies the demand, entities,
   and domains (step 1): a card is irrelevant when it adds no grounding or constraint to the
   selected context. In
   RFC-004 §5.1's terms that is a **Relevance** and **Constitutive constraints** judgment, not a
   **Demand** one — no card carries a demand of its own, so a constraint card and a gossip card
   are equally question-less read in isolation, and only the task brief's question tells them
   apart. The whole-file version of the same judgment is the ill-posed case (§5.5), where
   RFC-004 §5.3's **non-problem class** applies to the case rather than to any card inside it —
   the call a tool router makes when arbitrary text arrives (a poem, a grocery list) and
   something must decide whether this tool has any business processing it. From the player's
   view, these are the cards where the world lives: color, humor, and perspective ride on
   exactly the material that constrains nothing, the way *Papers, Please* tells its stories
   through the passports that are fine. The authoring register sits deliberately between flat
   statement and poetry — carrier voice with texture, never so ornamented that tone obscures
   whether anything is actually being claimed (and §5.7 gives that property a mechanical
   check). Triage is a core challenge, so noise is designed content, not filler — including
   **conditionally useful** cards, whose final value depends on the rest of the selected context.
4. **Assign each card a tier** (strict / ambiguous / subjective, per §2's shorthand for RFC-001
   §5.1 and RFC-004 §5.3). The tier determines the card's swipe grammar (§5.2): strict cards
   resolve in one swipe; ambiguous cards cost one bounded follow-up; subjective cards file as
   weights.
5. **Verify the deck.** Two invariants, and only the second ranges over every reachable
   sequence. **Sufficiency**: retaining a valid set of required domains and constraints, under
   their intended readings, determines the grid uniquely without redundant context.
   **Recoverability**: every reachable state can be escaped by reopening cards (§5.2). The
   second is deliberately weaker than "always completable," because contradiction is a designed
   teaching moment rather than an authoring defect — a wrong reading of an ambiguous card is
   *meant* to drive the count to zero and bounce the stamp. Verification confirms such states
   are escapable, not that they never occur.

Because the solved state is known, the system can compute, at any moment, the exact number of
grids consistent with the retained constraints. That number can inform the audit and answer
scoring, but final assessment must also account for required domain grounding and redundancy:
the selected context, not just its constraint IDs, is what the player submits.

**The count is a satisfaction measure, and it reaches only as far as the strict and ambiguous
tiers.** Subjective cards file as weights, and a weight ranks grids rather than eliminating them
— RFC-004 §5.2's distinction between a CSP and a COP. Filing one may not move the count at all,
and the count need never reach 1 even when a unique optimum exists, so the "count = 1 unlocks
submission" trigger has no meaning there. The subjective tier needs a different endgame signal
(an optimum, and the shape of the frontier around it) and a different contradiction signal; §7.6
leaves that contract open. Every description of the loop below that is phrased in terms of the
count should be read as scoped to the CSP tiers until it is settled — which is a real hole in
this design, not a detail deferred to tuning.

### 5.2 The card loop

A session is one pass through a deck, one card at a time:

1. **Present.** The deck presents one candidate context item. Its order may be authored or a
   dependency-respecting shuffle; a deck must not force an uninformed judgment merely to create
   variation.
2. **Judge.** For the card in hand, the player makes one binary provisional judgment:
   - **Keep**: retain the claim as context. Constraint claims enter the solver record, which may
     recompute the remaining solution count and surface a contradiction immediately.
   - **Ignore**: set the claim aside. Ignored cards remain readable and may later be retained.
3. **Ambiguity costs one more swipe.** Keeping a tier-2 card triggers a single bounded
   follow-up — "file as: *adjacent* / *anywhere right*" — so the swipe grammar stays binary and
   ambiguity is a bounded interpretation commitment. The commitment is what the solver retains.
4. **Reconsider the selected set.** At any point the player may reverse a processed judgment.
   The full card text remains visible, so this is a context edit rather than a rewind. The solver
   recomputes on every retained-constraint change.
5. **Run a pre-flight audit (optional).** Once the deck is processed, the player may pay a small
   ledger cost for one audit of the current selected context (§5.4). It identifies a category of
   concern, never the corrective card. Editing the set invalidates the report; the same state
   cannot be charged twice for the same audit.
6. **Close the task.** The player either submits **Just the facts**, asserting that their curated
   context is correct and sufficient, or submits **Facts + an Answer**, naming the answer as an
   additional, risk-bearing judgment. In later ill-posed decks (§5.5), a third close is
   **return the request** with the defect named.

The session ends at closure: the true grid (or the request's actual defect) is revealed, final
context quality and any answer are scored, and a short debrief replays the decisive keeps and
ignores — which is, not incidentally, a decision trace.

### 5.3 The ledger economy

The ledger is the session's visible-in-debrief tally. Its principle is that *judgment is free;
tool use and error have costs* — tuned so the lesson is "knowing when to audit is a skill,"
never "never call a tool."

- **Judgment is free.** Keeping, ignoring, reading, and reconsidering context cost nothing by
  default. The player is never taxed for thinking or editing.
- **An audit costs a small, flat amount.** The price represents real tool latency or tokens even
  when the audit is useful. It is charged once per unchanged selected set.
- **The ledger flows; it is not a fuse.** Sound curation earns credit and wrong judgments lose
  it. A wrong submitted answer costs materially more than a correct answer on an ambiguous file
  earns, so guessing is not a free roll.
- **Closure is free.** Ending the task never competes with learning more; the tension is whether
  the selected context is ready and whether to supply an answer.

### 5.4 The pre-flight retrieval audit

Per-card selection among three fictional advisors was removed after SPIKE-006 found it interrupted
the short-session triage loop. The replacement is one optional, costed audit of the assembled
selected context, available after the deck has been processed. It makes the retrieval paradigms
legible as the tools AI engineers actually call, at the point where a complete context exists to
inspect:

- **Reference search** asks whether essential domain or reference grounding is missing. It can
  report that the picture is incomplete, but must not identify the missing card or fabricate a
  case-specific fact.
- **Similarity search** asks whether selected cards duplicate or near-duplicate one another. It
  distinguishes similarity from relevance: a duplicate can be harmless only when another
  selected carrier supplies the same needed fact.
- **Graph/constraint search** asks whether the selected facts connect to a determinate answer.
  It reasons faithfully over the selected record, so a contradiction or gap identifies a
  context problem without claiming to know the intended correction.

The audit returns category-level findings, not solutions or card IDs. It is invalidated by every
context edit, because an audit of stale context is less useful than no audit. Its cost teaches
that tool calls consume latency or tokens, while its optionality preserves the principle that
ordinary reading and judgment are never taxed.

Graph/constraint search is also the first genuine consumer of the constitution's Principle III
("Graphs as the Constraint Representation"), which mandates `@relateby/pattern`'s graph
primitives and which nothing implements today. Its closed-world behavior dramatizes Principle
VI: a tool can reason flawlessly over the context it received while still being unable to repair
a missing or wrong upstream selection.

### 5.5 Minutes, not hours: session-shape constraints

The session-length and casual-register requirements are hard bounds, not aspirations, and they
propagate into every mechanic:

- **Deck size is capped.** Indicatively: 10–16 cards over a grid of 3–5 entities and 2–3
  attribute categories, of which roughly a third is noise. Large enough that inference chains
  and triage both exist; small enough that the file is holdable in working memory.
- **Per-card interaction is seconds, not minutes.** One binary swipe and, for tier-2, at most
  one bounded follow-up. No card may demand free-text, multi-step, or scrollable interaction.
  Serialized judgment is the paradox-of-choice defense; deck order may be authored or shuffled
  only within dependency constraints.
- **One closing choice per session.** No chapter structure or multi-case arcs within a sitting.
  Depth across sessions comes from the tier progression, not from length within one.
- **Difficulty grows by tier, not by size.** Early cases are all-strict (pure propagation and
  easy triage); mid cases introduce ambiguous cards (one-swipe interpretation commitments) and
  conditional relevance; late cases add subjective weighted cards, where no grid satisfies
  everything and the answer defends a trade-off; the final stage is the **ill-posed case**
  (RFC-004 §5.3's non-problem class), where the winning move is returning the file with the
  defect named. The grid barely grows; the *kind of judgment* does.
- **Target: a complete session in roughly 5–10 minutes**, including the debrief. Any proposed
  mechanic that cannot survive this bound is out, however interesting.

### 5.6 Domain portability: the deck schema

A card is a constraint in costume, and the costume is the only domain-specific part. The deck
schema is domain-neutral:

- **Task brief**: declared question, entities, attribute domains, and grounding.
- **Cards**: each carrying a claim (a constraint or noise), a carrier voice, a tier, a
  **modality** — text, image, or both; a bureaucratic file naturally holds photographs, seals,
  sketches, and ledger scraps alongside testimony — and, for ambiguous cards, a bounded set of
  fileable readings. Image cards and readings are made for each other: a photograph asserts
  nothing until the player commits to what it shows, which makes images the most natural
  tier-2 material in the deck, and keeps them inside the swipe grammar (one bounded follow-up)
  rather than adding interaction weight.
- **Closure**: selected context alone, selected context plus a grid assignment, or, for
  ill-posed decks, the named defect.

Office assignments, cargo manifests, wedding seating for the duke, patrol rosters — all are the
same CSP shapes under different art and prose. The existing puzzle catalog therefore becomes a
deck library, and adding a domain is a content task (skin + carrier voices), not an engineering
one. This is also the argument for keeping the schema in the catalog's orbit rather than inside
the game: decks are puzzles with staging metadata.

### 5.7 What the game requires from the pipeline

Stated as consumer requirements, not designs. These sit at three different maturities, and an
ADR should sequence against that rather than treating them as one shelf: **built** today,
**designed but unbuilt**, and **not yet designed**.

- From **generation** (*not built* — RFC-001 is `draft`, and no catalog puzzle was produced by a
  generator; each was written by hand or adapted from a published source): puzzles with per-clue
  tier labels and a designated solved grid — plus, new to this consumer, *noise generation*:
  claims consistent with the solution but adding no needed grounding or constraint against the
  task brief's demand (§5.1 step 3), including conditionally useful substitute carriers, in the
  between-flat-and-poetry register that step specifies. This RFC is a second demand signal for
  RFC-001's strategies, not a reason to redesign them.
- From **solving** (*built* — ADR-002's `solve()` classifies unsat / unique / multiple today):
  an incremental interface — given retained constraints, return the remaining solution count
  fast enough for a per-swipe call — plus assessment of selected context for required domains,
  sufficiency, equivalence, and redundancy (powering deck verification and graph/constraint
  audit findings). Both are extensions to a working capability, not new ground.
- From **well-posedness classification** (*designed, unbuilt, and incomplete*): the ill-posed
  stage needs RFC-004 §5.1's ladder as running code and a vocabulary for recording a diagnosis
  as an expected outcome. That vocabulary is RFC-004 §7.3, still open, and tracked as root
  `TODO.md` item 2 — where the eval's inability to score a correct refusal is the same gap seen
  from the other side. The ill-posed stage is therefore blocked on design work that has not
  started, and should be sequenced last.
- From **extraction** (*built* — ADR-004's critic loop): nothing at runtime (cards are
  pre-modeled at authoring time), but two authoring-time roles. Forward: the flow that deals
  constraints into carrier voices is a natural consumer of extraction's structured output, run
  in reverse. And as a **linter for color**: every card, noise included, is run through
  extraction to confirm it asserts exactly what it was designed to assert — a constraint card
  must extract to its intended constraint, and a noise card must extract to nothing or to pure
  redundancy. This is the mechanical check behind §5.1 step 3's register: it catches the failure
  mode where a joke smuggles in a claim ("the cat, who never leaves the red house, watched with
  contempt") and silently breaks deck verification. This is the same audit root `TODO.md` item 4
  ("premise linting") describes from the extraction side — measuring the gap between what prose
  says and what a model asserts, rather than a model's internal consistency. That item is
  recorded but unscoped for want of a forcing function; deck authoring is one.

## 6. Alternatives Considered

- **Static clue dump (the classic zebra puzzle).** Rejected as the *product*, though it remains
  the substrate: it exercises no per-claim assessment, has no economy, and teaches nothing about
  context curation or escalation.
- **Interrogation with question menus (this RFC's own earlier draft).** The player actively
  selects questions from per-character menus under an action budget — an information economy
  where *question selection* is the skill. Genuinely attractive, and closer to *Lil'
  Guardsman*'s surface. Rejected for the casual register: menu selection is a heavier
  interaction than a swipe, puts the pacing burden on the player, and courts paradox of choice
  in exactly the way serialized card judgment avoids. The trade is named honestly: cards make
  *judgment per item* the skill and hand pacing to the deck.
- **Bureaucratic-clerk framing as the product explanation.** The Maple Street prototype proves it
  is a workable skin, but SPIKE-006 found manual context engineering, tool calling, and prompt
  engineering make the actions more legible to the intended audience. The fiction may remain as
  content; it no longer defines the product's core metaphor.
- **Action budget as the currency (earlier draft).** A fixed pool of actions spent on questions
  and tools is a fuse that encourages hoarding and ends the session by exhaustion. Rejected in
  favor of a ledger that prices error and optional audits without limiting ordinary thought.
- **Per-card advisor selection.** SPIKE-006 found choosing among three advisors before each card
  interrupted the central curation loop. Rejected for short casual play in favor of one bundled
  audit over an assembled context; this retains retrieval assistance without adding a repeated
  meta-decision.
- **A shift clock instead of (or alongside) the ledger.** *Papers, Please*'s own pressure is
  time: process what you can before the day ends. It is the one mechanic borrowed from that
  precedent's frame and deliberately left behind. A clock taxes reading and deliberation, which
  directly contradicts §5.3's founding principle that the player is never charged for thinking —
  and it would price the tier-2 and subjective cards, the ones most worth dwelling on, highest
  of all. The session-length bound (§5.5) is met by capping deck size instead, which shortens
  sessions without hurrying them. Rejected; a per-card soft timer for pacing feedback, with no
  scoring consequence, is a compatible future addition if sessions run long in playtesting.
- **Free-text interaction (interrogation or advice).** Richer, but it reintroduces open-ended
  natural-language interpretation at runtime, makes the deck unverifiable, and blows both the
  session-length and casual-register bounds. Rejected; the extraction pipeline's ambiguity work
  belongs at authoring time, not in the player's critical path.
- **Hours-scale campaign structure.** Rejected outright by the minutes-not-hours bound.
- **An omniscient completion checker.** Rejected in favor of a category-level audit: naming the
  missing card or correct answer would turn tool use into an oracle and erase the curation task.

## 7. Open Questions

7.1. **Conditional-relevance authoring and scoring.** Can a deck represent substitute carriers
systematically, so a card is required only when its equivalent fact was not retained? How should
the game distinguish a locally sensible provisional judgment from final context quality? The
next SPIKE-006 pass should test this with `cat-red` and its echo. Tier-2 ambiguity-driven
conditional relevance remains a separate later question.

7.2. **Closure scoring.** How should a correct but underdetermined answer be scored relative to
a verified sufficient selected context? How should **Just the facts** assess correctness,
sufficiency, and unnecessary duplication without requiring an answer?

7.3. **Reconsideration pricing.** SPIKE-006's provisional answer is that ordinary context edits
are free and only repeated churn after no new information merits a small penalty. Confirm whether
that remains appropriate once final-context conditional relevance is scored.

7.4. **Audit pricing and findings.** What flat cost makes the pre-flight audit worth calling
without making it mandatory, and which category-level messages help without identifying the
corrective card?

7.5. **Ill-posed closure scoring.** When the correct submission is "return the file," what
exactly must the player name — just *that* it is unanswerable, or *which* condition of RFC-004
§5.1's ladder fails (Demand, Determinate answer-space, Relevance, Constitutive constraints,
Determinate atoms, Sufficiency)? The latter is truer to the ladder, and to its rule that a
failure is attributed to the *lowest* failing condition, but may exceed the casual register; a
bounded "reason for return" picker is the likely compromise, and its option set needs design.

7.6. **Subjective-tier closures, and the loop signal they need.** When no grid satisfies all
weighted cards, what does the submission assert — a grid plus a bounded justification of which
constraints were sacrificed? How is that scored, and by what (solver-computed cost, authored
rubric, or both)? This is the larger of the open questions here, because the remaining solution
count that drives every other tier does not survive the move to weights (§5.1): a soft
constraint ranks grids instead of eliminating them, so the count may not move when a card is
filed and may never reach 1. The subjective tier needs its own progress signal, endgame trigger,
and contradiction analogue — plausibly an optimum with a bound on how much better any
unexplored grid could be, so "you have seen enough to decide" stays computable. Until this is
answered the subjective tier is designed only in outline, and item 7 of the root `TODO.md`
(solution counting) is not sufficient for it.

7.7. **Solver latency budget.** The per-swipe remaining-solution-count call must feel
instantaneous at §5.5 deck sizes. Is counting (not just deciding) solutions cheap enough, or
does the design need the unsat/unique/multiple trichotomy plus an approximate count?

7.8. **Ordering policy.** Does an authored order or dependency-respecting random topological
shuffle better balance comprehension and replayability? SPIKE-006 found a 2-3 card tray was
friction at this scale; it did not establish that order never carries useful agency.

7.9. **Does deck verification need to be exhaustive** over all swipe sequences, or is
sampled/bounded verification acceptable given the reopen safety valve and underdetermination
detection at submission?

7.10. **Duplicate-carrier equivalence.** What makes two claims sufficiently equivalent to serve
as substitutes, particularly once prose varies by carrier or modality? The selected context must
retain at least one valid carrier of each required fact without treating an alternate carrier as
permanent noise.

7.11. **Image-card verification.** The extraction linter (§5.7) checks what text asserts —
what checks an image? Candidates: multimodal extraction over the image plus its bounded
readings; an authored assertion manifest per image that verification trusts; or restricting
images to material whose only assertions are the player-committed readings themselves. The
answer gates how load-bearing images are allowed to be.

7.12. **Audit modality asymmetry.** Reference search may interpret images directly, similarity
search needs multimodal embeddings to compare them, and graph/constraint search sees an image
only through its selected reading. Is that asymmetry acceptable at v1, or does image search need
to precede image cards?

## 8. ADRs

- [ADR-006](../adr/ADR-006-deck-yaml-format.md) — Deck YAML Format

## 9. Appendix: Sample Scenarios

_(reserved — worked end-to-end scenarios to be developed here: one all-strict Tier-1 case traced
card-by-card against a real solved grid, including selected-context assessment and a noise card;
one Tier-2 case with an ambiguity commitment, a conditionally useful card, and a contradiction
resolved by reconsidering; one Tier-3 case with a weighted-constraint answer; one ill-posed case
whose correct closure is returning the request. At least one scenario should include an image card with
its bounded readings, and every deck should be written in the §5.1 register so the
color-vs-assertion linter has something real to check. Each scenario should log its optional
pre-flight audit findings and cost so the economy can be sanity-checked before anything is
built.)_
