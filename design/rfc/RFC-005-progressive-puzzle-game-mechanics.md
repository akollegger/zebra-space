---
id: RFC-005
title: Progressive Puzzle Game Mechanics
status: draft
created: 2026-08-24
adrs: []
---

# RFC-005: Progressive Puzzle Game Mechanics

## 1. Summary

A zebra puzzle is normally consumed as a static block of clues: the reader gets everything at
once and works alone. This RFC proposes an interactive alternative — a short-session casual
deduction game in which the player is a low-ranking clerk in a bureaucracy, handed a case file
and a vague instruction to "sort this out." The case is fully solved behind the curtain — the
truth exists above the clerk's clearance — and the player is evaluated on reconstructing it
from limited access. Evidence arrives as a small deck of cards: claims presented by
interviewees, records, and memos, in text or image — a photograph asserts nothing until someone
commits to what it shows. For each card the player renders one binary judgment — swipe
to file it as a real constraint on the case, or swipe to dismiss it as irrelevant — or, before
swiping, spends reputation to consult one of three advisors. Each advisor embodies a distinct
retrieval paradigm (parametric world knowledge, similarity search over the session's memory,
multi-hop graph traversal over filed facts), each with a characteristic failure mode, so that
learning which advisor to trust for which kind of card is itself the meta-game. When the filed
constraints determine the case uniquely, the clerk submits a verdict. A session is designed to
be played in minutes, not hours: a deck of a dozen-odd cards, seconds per swipe, one verdict.
Because a card is just a constraint in costume, the same machinery hosts any puzzle domain —
office assignments, cargo manifests, seating charts — as reskinned decks.

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

A game is the forcing function, and this design stands on two shipped precedents. From *Lil'
Guardsman* (Hilltop Studios, 2024) it borrows comedic advisors with costed advice and a
forgiveness mechanic for wrong turns. From *Papers, Please* (Lucas Pope, 2013) — with *Reigns*
(Nerial, 2016) as proof that a binary swipe can carry deep decisions — it borrows the frame: a
clerk processing files under limited information, where each item gets a fast, consequential,
binary judgment. Every mechanic proposed here has a beloved proof of existence.

The framing is chosen to do structural work, not just flavor:

- **The clerk is a third-tier decision maker** (king → advisors → operatives) aspiring to rise.
  The truth of each case already exists above their clearance; the player is not discovering
  reality but being *evaluated on reconstruction*. This makes solution-first authoring
  diegetically honest, and makes "limited access" the in-fiction name for the reveal budget.
- **"Sort this out" is an underspecified demand.** Before any solving, the clerk's real job is
  determining *what is being asked* — **Demand**, the first rung of RFC-004 §5.1's
  well-posedness ladder. The bureaucratic frame therefore leaves room, in later levels, for
  **ill-posed cases**: files with no determinate answer, missing constraints, or no real question
  at all, where the correct verdict is "this file is unanswerable, and here is why" — RFC-004
  §5.3's **non-problem** class, at case granularity. No detective framing supports that ending; a
  bureaucracy absolutely does.
- **Interviews verify; they do not interrogate.** NPCs come before the clerk to have claims
  checked, not secrets extracted. Verifying a claim against the filed record is consistency
  checking — the solver's native operation — surfaced as a swipe.
- **Cards are constraints in costume.** The deck schema (entities, attributes, claims, one
  verdict) is domain-neutral, so the puzzle catalog becomes a deck library and new domains are
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
  receives one binary player judgment (file as constraint / dismiss as irrelevant), the solver
  re-evaluates the solution space after every filed card, and the session ends in a single
  submitted verdict.
- Define a **reputation economy** in which swiping is free, advice costs standing, and
  reputation *flows* — earned back by sound verdicts, bled by confident errors — so that
  knowing when to ask is rewarded rather than punished.
- Define the **three advisors** as distinct retrieval paradigms with characteristic strengths
  *and* characteristic failure modes, such that choosing the right advisor for the card in hand
  is a skill the game teaches.
- Make **relevance a first-class challenge**: decks mix load-bearing constraints with
  consistent-but-non-constraining noise, including *conditionally* relevant cards whose status
  depends on earlier commitments.
- Establish the **session-shape constraints** ("minutes, not hours"; casual, swipe-speed
  interaction) as hard design bounds that cap deck size, per-card decision weight, and UI
  complexity.
- Make the clue-tier spectrum (strict → ambiguous → subjective) the game's difficulty
  progression, extended by the framing to a fourth stage: **ill-posed cases** whose correct
  verdict is a classified refusal.
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
- Career meta-progression design (promotions, rank titles, unlock cadence). The clerk's
  aspiration to rise frames difficulty progression; designing that ladder is content work, out
  of scope beyond noting it exists.
- Multiplayer, leaderboards, or persistence beyond "harder cases unlock." A session is
  self-contained by design.
- Free-text player input of any kind. Binary swipes plus occasional bounded follow-ups are a
  deliberate scope decision (§5.2), not a placeholder for future natural-language interaction.
- Designing the advisors' underlying retrieval infrastructure (embedding model, graph store,
  prompt design). This RFC specifies their observable behavior and failure modes; child ADRs
  own implementation.
- Monetization, platform targets, accessibility standards. Real concerns, out of scope for a
  mechanics RFC.

## 5. Proposed Approach (high-level)

### 5.1 Solution-first case construction

A case begins as a completed grid — every entity assigned every attribute — plus a constraint
set that uniquely determines it, drawn from or generated alongside the existing catalog. From
that solved state, construction works backward into a deck:

1. **Write the cover sheet.** The case file opens with the givens: the entities, the attribute
   domains, and the (deliberately vague) instruction from above. Enough to make the board
   legible; never enough to solve.
2. **Deal the constraints into cards.** Each earnable constraint becomes a card, voiced by a
   carrier — an interviewee's claim, a ledger entry, a memo. The same underlying constraint may
   appear on more than one card in different voices.
3. **Salt the deck with noise.** Cards that are consistent with the solution but constrain
   nothing (true trivia, redundant restatements, gossip). From the CSP view this is noise; it
   is also RFC-004 §5.3's **non-problem class** made playable — the game is that vocabulary's
   first consumer, at card rather than case granularity. A gossip card is to extraction what a
   poem or a grocery list is: text from which no problem can be recovered, where the correct
   output is that diagnosis rather than a constraint. Triage is therefore the same capability a
   tool router needs when arbitrary text arrives and something must decide whether this tool has
   any business processing it — the game is that judgment made into gameplay. From the player's
   view, these are the cards where the world lives: color, humor, and perspective ride on
   exactly the material that constrains nothing, the way *Papers, Please* tells its stories
   through the passports that are fine. The authoring register sits deliberately between flat
   statement and poetry — carrier voice with texture, never so ornamented that tone obscures
   whether anything is actually being claimed (and §5.7 gives that property a mechanical
   check). Triage is a core challenge, so noise is designed content, not filler — including
   **conditionally relevant** cards, whose load-bearing status depends on how an earlier
   ambiguous card was filed.
4. **Assign each card a tier** (strict / ambiguous / subjective, per §2's shorthand for RFC-001
   §5.1 and RFC-004 §5.3). The tier determines the card's swipe grammar (§5.2): strict cards
   resolve in one swipe; ambiguous cards cost one bounded follow-up; subjective cards file as
   weights.
5. **Verify the deck.** For every reachable sequence of swipes, the solver confirms the case
   remains completable — filing all and only the true constraints must determine the grid
   uniquely, and no dismissal of pure noise may block that. Wrong swipes are survivable by
   design: the file can be reopened (§5.2), and the endgame detects underdetermination.

Because the solved state is known, the system can compute, at any moment, the exact number of
grids consistent with the filed record. That single number — the **remaining solution count** —
drives the loop, the advisors' honesty, and the endgame trigger.

### 5.2 The card loop

A session is one pass through a deck, one card at a time, with a small amount of ordering
agency:

1. **The tray.** Two or three cards lie face-up; the player chooses which to process next.
   Order matters under constraint propagation — an early commitment changes what later cards
   mean — so choosing order is real agency at zero added UI cost. Processing a card draws its
   replacement from the deck.
2. **Judge.** For the card in hand, the player renders one binary verdict:
   - **File it** (swipe right): the claim enters the case record as a constraint. The solver
     immediately recomputes the remaining solution count. If the count hits zero, the
     contradiction is surfaced at once — the stamp bounces — signaling that something filed
     (this card, or an earlier interpretation) is wrong.
   - **Dismiss it** (swipe left): the claim is marked irrelevant and set aside. Dismissed cards
     remain readable in the file; dismissal is a judgment, not deletion.
3. **Ambiguity costs one more swipe.** Filing a tier-2 card triggers a single bounded
   follow-up — "file as: *adjacent* / *anywhere right*" — so the swipe grammar stays binary and
   ambiguity is, thematically, just more paperwork. The commitment is recorded on the card and
   is what the solver actually files.
4. **Or ask first.** Before swiping, the player may show the card to one advisor (§5.4) at a
   reputation cost (§5.3). The advisor responds in character and per paradigm; the swipe
   remains the player's.
5. **Reopen the file.** At any point the player may pull a processed card back and reverse its
   judgment — the forgiveness valve, replacing the earlier design's rewind. Reopening is free
   or cheap in actions but not in standing: each reversal costs a sliver of reputation
   (clerks who re-stamp constantly get noticed). The solver recomputes on every reversal.
6. **Submit the verdict.** When the filed record determines the grid uniquely (count = 1), the
   file is stamped ready and submission is prominently unlocked. The player may also submit
   *early*, at count > 1 — a deliberate risk that rewards strong intuition and punishes
   guessing. In later, ill-posed cases (§5.5), a third submission exists: **return the file** as
   unanswerable, citing what is missing or contradictory — and for those decks, that is the
   correct verdict.

The session ends at submission: the true grid (or the file's actual defect) is revealed, the
verdict is scored, and a short debrief replays the decisive filings and dismissals — which is,
not incidentally, a decision trace.

### 5.3 The reputation economy

Reputation is the game's single currency, and its design principle is that *judgment is free;
help and error have costs* — tuned so the lesson is "knowing when to escalate is a skill,"
never "never ask."

- **Swiping is free.** Filing, dismissing, reading the file, and rearranging the tray cost
  nothing. The player is never taxed for thinking or deciding — only for consulting and for
  being wrong.
- **Advice costs reputation** — a visible, small, per-consultation debit. Different advisors
  may carry different rates (a tuning question, §7.4).
- **Reputation flows; it is not a fuse.** A sound verdict earns reputation back — scaled by
  accuracy, deck difficulty, and unspent-consultation efficiency. Errors bleed it, and the
  bleed is asymmetric by design: **confident-and-wrong costs more than advised-and-right nets
  less.** A clerk who consulted, heeded, and got it right ends ahead of one who guessed
  correctly by luck at count = 3; a clerk who never asked and stamped a contradiction pays the
  most. This asymmetry is the direct counter to the known failure mode of advice-as-cost
  systems: hoarding, where players never consult and the advisors become dead content.
- **Occasionally, advice is visibly cheaper than the mistake it prevents.** Deck design should
  guarantee moments where a consultation obviously paid for itself, so the economy *teaches*
  escalation rather than merely permitting it.
- **Reopening costs a sliver.** Reversing a processed card debits standing lightly (§5.2 step
  5) — enough that swipes feel consequential, not enough to make experimentation frightening.
- **Reputation is also the career.** Across sessions, accumulated standing is the clerk's rise
  through the ranks, which is the fiction's name for difficulty progression. Within a session
  it is the advice budget. One number, two readings.
- **Submission is free.** Ending the case never competes with learning more; the tension is
  *when* to submit and *which* verdict, not whether one can afford to.

### 5.4 The three advisors

Each advisor is a retrieval paradigm with a personality, a strength, and — critically — a
characteristic failure mode. Consultation is per-card: the player shows the card in hand and
the advisor reacts to it in light of what their paradigm can see. Learning which advisor suits
which card is the meta-game, and the paradigms are chosen so their failure modes are
*instructive*, not arbitrary:

- **The Scholar (parametric world knowledge).** A language model consulted with the card and
  the cover sheet. Excellent at priors and interpretation — "in cases like this, 'to the right
  of' usually means anywhere right" — which makes it the natural organ for tier-2 ambiguity and
  for smelling implausible noise. Failure mode: confident overgeneralization; it knows the
  world in general and this case in particular not at all. It may assert something plausible
  that is false here.
- **The Archivist (vector search over the session's memory).** Similarity search over
  everything seen this session — cards, testimony, the cover sheet. Perfect recall, zero
  synthesis: "has anyone else mentioned the blue house?" surfaces the exact three passages —
  sometimes including a similar-sounding but irrelevant one, because similarity is not
  relevance. The natural organ for spotting redundant cards and near-duplicates. Failure mode:
  cannot chain; two inferential hops and it is lost.
- **The Cartographer (graph traversal over the filed record).** Multi-hop search over the
  graph of facts and commitments the *player* has filed — route-finding through the case. The
  only advisor that can connect dots — the natural organ for "does this card matter, given
  what's already stamped?" — but a mapmaker by temperament: it shows **paths, never
  conclusions** (the map, not the route you must take), and its hop count can be bounded per
  case as a difficulty dial. Its refrain: *everything is connected.* Failure mode: scrupulous
  fidelity to the record — it faithfully propagates the player's own wrong filings with total
  confidence, because the graph is never wrong about the graph, only about a world that was
  filed wrong. When it reports "your filed roads don't connect — these facts cannot coexist,"
  the bug is upstream, in a swipe.

Advisor **disagreement is content**: the Scholar's prior colliding with the Cartographer's
propagation is tier-2 ambiguity resolution dramatized as an argument, and it falls out of the
architecture rather than being scripted.

The Cartographer is also the first genuine consumer of the constitution's Principle III ("Graphs
as the Constraint Representation"), which mandates `@relateby/pattern`'s graph primitives and
which nothing implements today — graph representation is item 3 of the project's stated purpose
and its least-exercised one. Its failure mode is worth noting as more than flavor: an advisor
that reasons flawlessly over a record the player filled in wrong, and cannot see past it, is
Principle VI's closed-world caveat dramatized — a tool reasoning only over what it was handed,
reporting the contradiction rather than reaching outside its input to resolve it.

### 5.5 Minutes, not hours: session-shape constraints

The session-length and casual-register requirements are hard bounds, not aspirations, and they
propagate into every mechanic:

- **Deck size is capped.** Indicatively: 10–16 cards over a grid of 3–5 entities and 2–3
  attribute categories, of which roughly a third is noise. Large enough that inference chains
  and triage both exist; small enough that the file is holdable in working memory.
- **Per-card interaction is seconds, not minutes.** One binary swipe; at most one bounded
  follow-up (tier-2) or one consultation. No card may demand free-text, multi-step, or
  scrollable interaction. The tray (2–3 face-up cards) is the entire extent of choice breadth —
  serialized judgment is the paradox-of-choice defense, and it is load-bearing.
- **One verdict per session.** No chapter structure, no multi-case arcs within a sitting. Depth
  across sessions comes from the tier progression and the career, not from length within one.
- **Difficulty grows by tier, not by size.** Early cases are all-strict (pure propagation and
  easy triage); mid cases introduce ambiguous cards (one-swipe interpretation commitments) and
  conditional relevance; late cases add subjective weighted cards, where no grid satisfies
  everything and the verdict defends a trade-off; the final stage is the **ill-posed case**
  (RFC-004 §5.3's non-problem class), where the winning move is returning the file with the
  defect named. The grid barely grows; the *kind of judgment* does.
- **Target: a complete session in roughly 5–10 minutes**, including the debrief. Any proposed
  mechanic that cannot survive this bound is out, however interesting.

### 5.6 Domain portability: the deck schema

A card is a constraint in costume, and the costume is the only domain-specific part. The deck
schema is domain-neutral:

- **Cover sheet**: entities, attribute domains, the instruction.
- **Cards**: each carrying a claim (a constraint or noise), a carrier voice, a tier, a
  **modality** — text, image, or both; a bureaucratic file naturally holds photographs, seals,
  sketches, and ledger scraps alongside testimony — and, for ambiguous cards, a bounded set of
  fileable readings. Image cards and readings are made for each other: a photograph asserts
  nothing until the player commits to what it shows, which makes images the most natural
  tier-2 material in the deck, and keeps them inside the swipe grammar (one bounded follow-up)
  rather than adding interaction weight.
- **Verdict**: the grid assignment (or, for ill-posed decks, the named defect).

Office assignments, cargo manifests, wedding seating for the duke, patrol rosters — all are the
same CSP shapes under different art and prose. The existing puzzle catalog therefore becomes a
deck library, and adding a domain is a content task (skin + carrier voices), not an engineering
one. This is also the argument for keeping the schema in the catalog's orbit rather than inside
the game: decks are puzzles with staging metadata.

### 5.7 What the game requires from the pipeline

Stated as consumer requirements, not designs. These sit at three different maturities, and an
ADR should sequence against that rather than treating them as one shelf: **built** today,
**designed but unbuilt**, and **not yet designed**.

- From **generation** (*not built* — RFC-001 is `draft`, and every catalog puzzle is currently
  hand-authored): puzzles with per-clue tier labels and a designated solved grid — plus, new to
  this consumer, *noise generation*: RFC-004 §5.3's non-problem class rendered at card
  granularity — claims consistent with the solution but constraining nothing, including
  conditionally relevant ones — salted per §5.1 step 3, in the between-flat-and-poetry register
  that step specifies. This RFC is a second demand signal for RFC-001's strategies, not a reason
  to redesign them.
- From **solving** (*built* — ADR-002's `solve()` classifies unsat / unique / multiple today):
  an incremental interface — given the filed record, return the remaining solution count fast
  enough for a per-swipe call — plus the ability to evaluate a *candidate* card for
  constraint-vs-noise status against a record (powering deck verification and the Cartographer).
  Both are extensions to a working capability, not new ground.
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
  the substrate: it exercises no per-claim solver capability, has no economy, and teaches
  nothing about triage or escalation.
- **Interrogation with question menus (this RFC's own earlier draft).** The player actively
  selects questions from per-character menus under an action budget — an information economy
  where *question selection* is the skill. Genuinely attractive, and closer to *Lil'
  Guardsman*'s surface. Rejected for the casual register: menu selection is a heavier
  interaction than a swipe, puts the pacing burden on the player, and courts paradox of choice
  in exactly the way serialized card judgment avoids. The trade is named honestly: cards make
  *judgment per item* the skill and hand pacing to the deck. The tray's ordering choice (§5.2
  step 1) preserves a deliberate residue of the older design's agency.
- **Gate-keeper or detective framing.** Both imply the player extracts hidden truth from
  adversaries. Rejected in favor of the clerk: verification is the solver's native operation,
  the clearance hierarchy makes solution-first authoring diegetic, and only a bureaucracy makes
  "this file is unanswerable" a winnable ending.
- **Action budget as the currency (earlier draft).** A fixed pool of actions spent on
  questions and advice. Rejected in favor of reputation: a spend-down pool is a fuse that
  encourages hoarding and ends the session by exhaustion; reputation flows in both directions,
  prices error as well as help, and doubles as the career meta-progression.
- **Per-advisor charges.** Truer to *Lil' Guardsman*'s tools and forces variety. Rejected for
  the initial design because multiple currencies complicate a minutes-long session; revisit if
  playtesting shows advisor monoculture.
- **A shift clock instead of (or alongside) reputation.** *Papers, Please*'s own pressure is
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
- **Hours-scale campaign structure.** Rejected outright by the minutes-not-hours bound; the
  career across sessions supplies the long arc instead.
- **A single omniscient hint system instead of three advisors.** Simpler, but it collapses the
  meta-game (which paradigm fits which card) and discards the pedagogical payload — the three
  retrieval paradigms *are* the point.

## 7. Open Questions

7.1. **Conditional-relevance authoring.** Cards whose relevance depends on earlier commitments
are the mechanism that gives triage depth (§5.1 step 3) — can they be generated systematically
from the solver (e.g. constraints redundant under one reading of an ambiguous card and
load-bearing under another), or are they hand-authored content for now?

7.2. **Early-submission scoring.** How should a correct verdict at solution-count > 1 be scored
relative to one at count = 1? Rewarding it too much encourages guessing; not at all makes the
subjective tier's judgment training toothless.

7.3. **Reopen pricing.** What sliver of reputation should a reversal cost, and should repeated
reversals of the *same* card escalate? The answer sets how experimental play feels, and likely
differs by tier.

7.4. **Advisor pricing.** Flat rate per consultation, or differentiated (the Cartographer's
multi-hop answer arguably worth more than the Archivist's lookup)? Differentiated rates deepen
the escalation lesson but add a number to a casual UI.

7.5. **Ill-posed verdict scoring.** When the correct submission is "return the file," what
exactly must the player name — just *that* it is unanswerable, or *which* condition of RFC-004
§5.1's ladder fails (Demand, Determinate answer-space, Relevance, Constitutive constraints,
Determinate atoms, Sufficiency)? The latter is truer to the ladder, and to its rule that a
failure is attributed to the *lowest* failing condition, but may exceed the casual register; a
bounded "reason for return" picker is the likely compromise, and its option set needs design.

7.6. **Subjective-tier verdicts.** When no grid satisfies all weighted cards, what does the
submission assert — a grid plus a bounded justification of which constraints were sacrificed?
How is that scored, and by what (solver-computed cost, authored rubric, or both)?

7.7. **Solver latency budget.** The per-swipe remaining-solution-count call must feel
instantaneous at §5.5 deck sizes. Is counting (not just deciding) solutions cheap enough, or
does the design need the unsat/unique/multiple trichotomy plus an approximate count?

7.8. **Tray size and refill policy.** Two or three face-up cards, and does the deck's draw
order adapt (e.g. hold conditionally relevant cards until their condition is settled) or stay
fixed per deck? Adaptive draw is a pacing tool but complicates deck verification (§5.1 step 5).

7.9. **Does deck verification need to be exhaustive** over all swipe sequences, or is
sampled/bounded verification acceptable given the reopen safety valve and underdetermination
detection at submission?

7.10. **Duplicate carriers.** When one constraint appears on two cards in different voices
(§5.1 step 2), is the second card noise (dismiss: correct), confirmation (file: harmless), or
either? The scoring answer teaches players what "redundant" means, so it should be principled.

7.11. **Image-card verification.** The extraction linter (§5.7) checks what text asserts —
what checks an image? Candidates: multimodal extraction over the image plus its bounded
readings; an authored assertion manifest per image that verification trusts; or restricting
images to material whose only assertions are the player-committed readings themselves. The
answer gates how load-bearing images are allowed to be.

7.12. **Advisor modality asymmetry.** The Scholar reads images natively; the Archivist needs
multimodal embeddings to recall them; the Cartographer sees an image only through its filed
reading — the graph knows only what has been committed to structure. Is that asymmetry
acceptable at v1 (it is arguably instructive, being exactly the paradigms' honest behavior),
or does the Archivist need image search before image cards ship?

## 8. ADRs

_(populated automatically as `/adr-create` links ADRs to this RFC)_

## 9. Appendix: Sample Scenarios

_(reserved — worked end-to-end scenarios to be developed here: one all-strict Tier-1 case
traced swipe-by-swipe against a real solved grid, including per-swipe remaining-solution
counts and at least one noise card; one Tier-2 case with an ambiguity commitment, a
conditionally relevant card, and a bounced stamp resolved by reopening; one Tier-3 case with a
weighted-constraint verdict; one ill-posed case whose correct verdict is returning the file.
At least one scenario should include an image card with its bounded readings, and every deck
should be written in the §5.1 register so the color-vs-assertion linter has something real to
check. Each scenario should also log every consultation with the advisor's in-paradigm
response and its reputation cost, so the economy can be sanity-checked on paper before
anything is built.)_
