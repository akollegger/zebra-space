---
id: SPIKE-006
title: Progressive Card-Loop Playable Prototype
status: done
rfcs: [RFC-005]
created: 2026-08-26
---

# SPIKE-006: Progressive Card-Loop Playable Prototype

Want to just play it? See [README.md](README.md) for how to run it and how to play — this
document is the design log: the question being investigated, the method, and a dated record of
every revision playtesting drove.

## 1. Question

[RFC-005](../../rfc/RFC-005-progressive-puzzle-game-mechanics.md) §9 (Appendix: Sample Scenarios)
calls for at least one worked end-to-end scenario, traced swipe-by-swipe against a real solved
grid, before any ADR commits to mechanics details. This spike builds that scenario as a playable
prototype instead of prose: do the card loop (§5.2), reputation economy (§5.3), and three-advisor
consultation (§5.4) — as specified — actually hang together as a coherent few-minutes session
against one real puzzle? Or does building it surface friction, missing rules, or dead mechanics
the RFC's prose didn't anticipate?

This intentionally stays at the strict/tier-1 rung only (RFC-005 §5.5's difficulty ladder) —
ambiguous and subjective cards, and the ill-posed-case ending, are separate future questions.
Several of the RFC's own open questions get answered as a side effect of building a real deck
rather than a designed one: §7.10 (duplicate carriers), §7.1 (conditional-relevance authoring),
§7.3 (reopen pricing), and, partially, §7.9 (does verification need to be exhaustive, or does the
reopen valve make sampling acceptable?).

## 2. Method

Hand-converted [PZL-0002](../../../catalog/puzzles/PZL-0002-context-graphs-example.md) (3 houses,
2 attribute categories, 4 constraints) into a bureaucratic case file per §5.1's construction
steps. **Revised after the first round of playtesting** (see Notes) into an 11-card deck organized
as a **dependency DAG** rather than a flat list — the first pass front-loaded the whole board as
prose on the cover sheet, which is a word problem rather than §5.1 step 1's "enough to make the
board legible; never enough to solve."

The deck now carries four card roles on an axis separate from the RFC's strictness tier:
`domain` cards diegetically establish the attribute domains ("all dwellings shall be red, green,
or blue"), `constraint` cards cut the solution space, `redundant` cards restate a constraint
another card already carries, and `noise` cards constrain nothing. Each card declares
`dependsOn: [cardId]` — the cards that must have been **read** before its relevance is knowable.
A card is *revealed* by being opened, whether it was kept or ignored, which makes deps-satisfaction
monotone. This is §5.1 step 3's **conditionally relevant** cards and open question §7.1, named in
the RFC and previously unbuilt; it was explicitly out of scope for the first pass, so treating it
as in scope is a deliberate scope change.

The premise was rewritten to a single problem statement plus one associative clue: an unregistered
animal somewhere on the Row, with nobody willing to name the house or the animal. That premise
constrains the deck in a useful way — no card may name the zebra, so the animal domain is
established as "one dog, one cat, and a third household that filed nothing," and the verdict asks
only *which house*, which is answerable without knowing the species. The zebra becomes narrative
payoff (a hay-delivery card plus the Scholar's world knowledge) rather than a scored dimension.

Built as a static, zero-build single-page app, matching the tech direction settled earlier in
this session: **Vue 3** (ESM, no SFC compile) for rendering, **Tailwind** (Play CDN) for layout,
and an **XState v5** state machine (ESM, imported from a CDN) modeling the full §5.2 loop — card
in hand → judge (keep/ignore) → reconsider → closure — so the state graph
stays explicit and inspectable rather than implicit in ad hoc component state. The remaining
solution count is computed for real by brute-force enumeration over the puzzle's full 36-grid
solution space (3! color permutations × 3! animal permutations) — small enough that no solver
integration is needed for this prototype; RFC-005 §5.7 already scopes that as a separate,
built-but-unintegrated capability.

The three advisors are scripted (not live retrieval), and were **reframed** in the revision. They
no longer comment on whether a card matters — that made them an oracle, and made the swipe
pointless. Each now answers "do you know anything about this?" about the card in isolation, and
every card carries exactly one `illuminating`, one `neutral`, and one `irrelevant` response across
the three. Cost is keyed to that outcome, not to advisor identity, so asking the right advisor is
cheap and wasting the Deputy Director's time is not — which makes "who knows about what kind of
thing" the learnable meta-game §5.4 describes. The division of labour is Scholar = world knowledge,
Archivist = what else is in this file, Cartographer = position and adjacency. This per-card
mechanic was itself superseded by a later revision's bundled pre-flight audit (see Notes and the
Conclusion) — kept here as the intermediate step that motivated it.

The ledger (initially called reputation) and the remaining-solution count are **hidden during
play** and revealed only in the post-closure debrief, on the grounds that a clerk does not see
their own score mid-shift. A `?debug=1` flag (plus an in-page toggle) re-exposes them along with a
live dependency-graph table and a running self-check that the ledger always equals the starting
value plus every logged delta.

Explicitly out of scope for this pass, deferred to later spikes if this one's findings warrant
them: ambiguous/subjective card tiers, animations/transitions, live advisor retrieval, and any
integration with the solver/extraction/generation backends.

Code lives alongside this file: `index.html`, `puzzle-data.js`, `solver.js`, `advisors.js`,
`machine.js`, `app.js`. Run `pnpm run spike:006` from the repo root (browsers will not load ES
modules over `file://`), which serves the spike at `http://localhost:4173/` and opens it — append
`/?debug=1` for the instrumented view. The server watches the directory and reloads the page on
every save.

## 3. Time-box

1 day.

## 4. Notes

Running log, kept as playtesting surfaces decisions — see the spike-create skill's rationale for
why this is a log kept during the work rather than reconstructed from memory at the end.

- **2026-08-26** — Tech stack settled before scaffolding: Vue 3 for rendering (real reactivity for
  the reputation/count/tray state without hand-rolled diffing), Tailwind for layout, XState v5 for
  the card-loop state machine — all via CDN, zero build step. XState judged not overkill because
  RFC-005 §5.1 step 5's recoverability invariant and §7.9 (verification exhaustiveness) are
  exactly the kind of property a statechart makes inspectable rather than re-derived by hand.
  Effect (this repo's pinned functional-effects library) rejected for the UI layer: no
  statechart/FSM primitive, and CLAUDE.md already scopes Effect's role to the solver/extraction/
  generation pipelines, not UI state.
- **2026-08-26** — Playtest feedback: "File as constraint" / "Dismiss as noise" named the
  implementation, not the player's action — renamed to "Keep" / "Ignore" throughout (buttons and
  the processed-card list). Also removed the STRICT/NOISE tier badges from cards entirely: showing
  them gave away the correct judgment before the player made it, defeating the triage-under-
  uncertainty tension that's the point of the game.
- **2026-08-26** — Playtest feedback: correct judgments should restore reputation, not just be
  free — added a reward for keeping a relevant card or ignoring a noise card. Follow-up feedback
  then added the missing counterpart: ignoring a *relevant* card should cost reputation (it had
  been neutral). Finally consolidated every reputation number in the game — judgment rewards/
  penalties, advisor consult costs, reopen cost, verdict scoring — into one `REPUTATION` object in
  `puzzle-data.js`, specifically so future balance tuning is a one-file edit rather than a hunt
  through `machine.js`. Current table: keep-relevant +3, ignore-relevant −3, keep-noise −1,
  ignore-noise +1, advisor consults 5–8, reopen −3, verdict correct/early/incorrect +20/+8/−25 —
  all placeholders for actual tuning, not considered final.
- **2026-08-26** — Second playtest round produced three findings that turned out to be one
  problem. (a) The cover sheet was a CSP spec in prose — too much to read, and it gave away the
  whole board. (b) A simpler premise was wanted: an illegal pet, nobody naming who or what. (c)
  There was no motivation to consult an advisor. The common cause: the board arrived all at once as
  exposition, so nothing was ever uncertain, and the advisors had nothing to do but confirm what
  the player could already see. Fixed by one mechanic rather than three patches — a **dependency
  DAG**, with the board revealed through `domain` cards, so a card's apparent relevance depends on
  what has been read. This is RFC-005 §5.1 step 3 / §7.1, named in the RFC and previously unbuilt.
  **Why:** three separate patches would each have addressed a symptom; the DAG addresses why all
  three symptoms existed. **How to apply:** when several playtest complaints share a root, look for
  the mechanic the design was already reaching for rather than fixing each complaint locally.
- **2026-08-26** — Settled two RFC open questions rather than leaving them implicit. §7.10
  (duplicate carriers): the echo card scores as `redundant` — **ignoring it is correct** — which
  teaches that a second voice adds nothing to the record, and gives the Archivist's near-duplicate
  detection a genuine job. §7.3 (reopen pricing): reopening is **free when the card's dependencies
  have since been read** (justified re-assessment) and **−1 when nothing new has been read**
  (churn), with a further −1 for re-affirming a wrong call. The two worst/best cases were fixed as
  design invariants and verified in the browser: blind-judge → unjustified reopen → wrong re-judge
  is exactly **−2**; wrongly ignoring a knowable constraint then reopening and correcting it is
  **+3** with zero residue from the wrong turn.
- **2026-08-26** — Reputation is now a **ledger, not a running tally**. Reopening exactly reverses
  the card's banked judgment value, so the score is a function of the final state (plus consult
  costs, churn, and penalties) rather than of the path taken. This also fixed a real bug: reopening
  previously did not reverse the original delta, so reopen→refile paid twice. The ledger banks
  *only* the role value — never penalties — or a second reopen would refund the penalty and the
  sunk cost would evaporate. A `start + Σdelta === reputation` assertion is rendered live in the
  debug panel; in a project with no build step and no type checker it is the cheapest available
  regression test, and it caught nothing only because it was added before the rewrite.
- **2026-08-26** — Hid reputation and the remaining-grid count during play (they had been a debug
  HUD read as game UI), revealing them only in the debrief. Two consequences worth recording:
  advisor buttons can no longer show prices, which is arguably better since the cost now depends on
  an outcome the player is trying to predict; and the **debrief becomes the entire teaching
  moment**, so it needed per-entry deltas, a running standing column, and a note on every judgment
  explaining why it scored what it did. Also removed the tray's card-text preview — it leaked the
  text that opening a card is supposed to buy.
- **2026-08-26** — Known gap, deliberately accepted: a card judged *correctly* while its
  dependencies were unread banks 0, and since reopening is then free, re-judging it the same way
  later banks full value. Blind-judge-then-revisit is therefore strictly optimal, costing only
  clicks. Two fixes were checked and rejected — a churn penalty is arithmetically incompatible with
  the −2 invariant above, and evaluating dependencies at debrief time instead of judgment time
  destroys the lesson (a player who blindly judged everything would end up scoring everything).
  Accepting it is defensible because re-judging correctly still requires knowing which cards
  matter, which is the actual skill. **How to apply:** this is a real answer to §7.3, not a bug to
  hide — it says free reopening and deps-gated scoring cannot both be unconditional.
- **2026-08-26** — Preview tooling: started with a bare `python3 -m http.server`, which sends no
  cache headers — this silently served stale ES modules across edits during manual testing more
  than once (looked like a state-management bug; was browser caching). Switched to the `serve` npm
  package as a root devDependency with a `spike:006` script in the root `package.json`
  (`pnpm run spike:006`), and established that as the convention for any future spike shipping a
  static browser prototype (documented in `design/spikes/README.md`) — a Python server in a
  TypeScript project was the wrong default. Then replaced `serve` with **`@web/dev-server`**
  (`--watch --open`), which adds browser reload on file change while keeping the zero-build
  property: it serves native ES modules untouched rather than bundling them, so no build step
  creeps into the spike. Reload is whole-page, not module-level HMR — an edit mid-game restarts the
  XState actor and resets the run, which is acceptable (arguably useful, since most edits under test
  here are to card data or reputation constants that want a fresh deck anyway). **How to apply:** a
  buildless ESM prototype wants a dev server built for that model, not a bundler and not a bare
  file server; the deciding properties are no-cache headers and untouched module semantics.
- **2026-08-26** — Third playtest pass, language and information density. "Records Row" renamed to
  **Maple Street** — the database pun was distracting. Cover sheet stripped of "three properties"
  (that fact is now its own `lots` card) and of the quoted "directions by paint color" line, which
  was both confusing (who is speaking?) and over-specified. Replaced with a triage instruction
  ("Keep whatever concerns house colors or animals") and a second catchphrase ("All stuff, no
  fluff") beside "Sort it out." The municipal registry no longer restates the complaint: it only
  names the animal domain (one dog, one cat on file). Scholar on the yellow-shutters card is now
  world knowledge only (shutters are trim, not dwelling paint); knowing yellow is off the mandate
  is the Archivist's job, and the Cartographer no longer recites street geography — only
  attribute topology (house / colour / animal edges).
- **2026-08-26** — **One CSP atom per card.** Debug now labels each card with its source component
  from PZL-0002 (or "extraneous"). A load-time assert forbids two non-redundant cards sharing a
  source. That audit forced splits: colour-domain vs colour-uniqueness were one card; "three
  houses" had been leaking from the cover. Cards carrying no atom stay `cspSource: null`.
- **2026-08-26** — **Removed the tray.** A 2–3 card grid that the player chose among (§5.2 step 1's
  "ordering agency") needed its own explanation and, on reflection, wasn't earning that cost in a
  short session — RFC-005 itself calls the tray "real agency at zero added UI cost," and this
  spike's version wasn't zero. Cards are now presented one at a time, straight from `DECK_ORDER`,
  with no choice of which to open next. Mechanically: `trayIds`/`deck`/`OPEN_CARD` collapsed into a
  single `queue` plus an eventless (`always`) transition on the machine's `tray` state that
  auto-presents the queue's head whenever no card is in hand — so "tray" is now purely an internal
  waypoint, never rendered. `REOPEN` now targets `cardOpen` directly (it used to just mutate context
  and stay put), presenting the reopened card immediately rather than dropping it back into a tray
  to be reselected; the queue is untouched by this; and resumes exactly where it left off once the
  reopened card is re-judged. **The file** (the kept/ignored list) is now unconditionally rendered,
  including before anything has been judged ("Nothing filed yet."), rather than appearing only once
  it has contents — per-row reopen actions are hidden while a card is in hand, since `REOPEN` isn't
  wired for that state and a visible-but-inert button reads as broken. **Why:** ordering agency is
  a real RFC mechanic, but this session's own experience playing it was that deciding which of 3
  face-up cards to open first was friction, not agency, when the deck is this small — worth
  recording as a data point against §5.2 step 1 at this scale, without concluding it fails at
  a larger one. **How to apply:** re-litigate tray-vs-linear if a future pass grows the deck enough
  that reading order might matter strategically rather than just chronologically.
- **2026-08-26** — Bug, caught by playtesting immediately after removing the tray: reopen had
  effectively vanished. The reopen buttons were gated on `!isCardOpen`, which used to be true in
  the gap between judging a card and the next one appearing — but that gap no longer exists once
  cards auto-present (the previous entry's change), so `isCardOpen` is true for nearly the entire
  session. Same root cause silently broke the submit controls and the contradiction banner too
  (both were also gated on `!isCardOpen`), which would have been the next thing found. Fixed by
  making `REOPEN` an event the machine actually handles while a card is in hand, not just between
  cards: reopening a different card now defers the one currently being judged back to the front of
  the queue (nothing is lost or force-judged blind), and the gating for reopen/submit/contradiction
  moved to `!isConsulting` — the one state where none of them are actually wired. **Why:** a UI
  condition and a state-machine capability had been silently assumed to coincide ("between cards"
  used to be a real, frequent state); once the state machine changed shape, everything gated on
  that assumption broke at once without anything crashing. **How to apply:** when a state disappears
  or a transition changes what triggers it, grep the whole UI for every place that state was used
  as a proxy condition — don't assume the regression is isolated to the one symptom reported.
- **2026-08-26** — "The file" listed processed cards by carrier ("Zoning Memo #114 — lot survey"),
  which meant recalling what a card actually *said* was on the player, not the file — an
  unintended memory-recall challenge stacked on top of the actual challenge, judging relevance.
  Both kept and ignored rows now lead with the claim text itself; the carrier survives only as a
  small attribution line underneath. Extended to ignored cards too, not just kept ones as
  literally requested — the same memory burden applies when deciding whether to reopen a
  dismissed card, and restricting the fix to kept cards would have left that half of it standing.
- **2026-09-02** — **Advisors shelved.** Even after reframing them from "is this card important?"
  to "do you know anything about this?" with authored illuminating/neutral/irrelevant tiers and
  cost keyed to outcome, the hints simply didn't factor into play. Rather than tune again, pulled
  them out entirely to isolate whether the core judgment loop holds up without them. This is a
  real finding against RFC-005 §5.4 as specified, not just a tuning miss in this build — a session
  this short may not have room for a three-way "who do I ask" meta-game to ever pay for itself,
  independent of how the paradigm is framed. `advisors.js` and the machine's `CONSULT` handling
  are untouched, just unwired from any UI control, so reviving them later is re-adding buttons and
  event wiring, not re-deriving the content.
- **2026-09-02** — **Reframed the win condition from "reputation for correct swipes" to "did you
  submit the fewest cards required to solve it" — a quiz, not a ledger of individually-priced
  actions.** First pass at this drew a wrong line: domain cards (`domain-colors`, `colors-unique`,
  `domain-registry`) don't move `remainingCount` when kept, since the solver already assumes a
  closed 3-colour/3-animal domain — so a naive "does removing this change the answer?" minimality
  test would flag them as unnecessary. Corrected: that's circular, since the solver's assumption
  *is* exactly the fact those cards supply — without them, "the red-painted unit" is uninterpretable
  (there could be a dozen houses, or a hundred colours). Domain cards are required evidence, not
  exempt context, and the code already scored them that way (`role: 'domain'`, same
  `keep/ignore` values as `constraint`) — no code change needed, just a correction to how I was
  reasoning about it. That also dissolved the minimality question entirely: grading is a flat
  per-card correctness tally against the same `KEEP_IS_CORRECT` ground truth the ledger already
  uses, and in this deck exactly 8 of 13 cards are keep-correct — a perfect player keeps exactly
  those 8, which *is* "fewest cards required," with no separate solver-perturbation logic needed.
- **2026-09-02** — **Renamed "reputation" to a ledger, starting at 0 instead of 100.** Not a trust
  score that decays — a plain tally of bonuses and penalties, so a perfect one-pass session with a
  correct answer produces the single highest number and nothing can beat it. Walked both shapes of
  that claim by hand in the browser: a clean pass with no mistakes accumulates only positive
  deltas; a wrong judgment on `red-middle`, made before its dependencies were read (so it banked
  0, not the full -3 — the deps-gate applied exactly as designed even mid-mistake) followed by a
  `Keep?` toggle correction, nets exactly the +3 the correct judgment was worth, with zero residue
  from the wrong turn (verified live: 22 → 25); a wrong final answer costs -25 for real, confirmed
  live (22 → **-3**, ledger going negative) rather than being a risk-free guess. That asymmetry —
  reasonable correction is free, a wrong answer is not — was explicit in the design conversation
  and is now load-bearing, not aspirational.
- **2026-09-02** — **Reopen replaced by a `Keep?` checkbox** on each row in "the file." With no
  advisors and the claim text already shown in the list (previous entry), there was no reason left
  to re-open a card into full view before re-deciding — toggling the checkbox now reverses the old
  judgment and applies the new one in one atomic action (`RECLASSIFY`), never leaving whichever
  screen you're on. The old two-step reopen-then-rejudge, including its "defer the card currently
  in hand" logic, is gone — unneeded, since a toggle never changes what's on screen.
- **2026-09-02** — **Submission restructured as a two-step choice, offered only once every card
  has been processed** — no more submit panel sitting alongside the current card, no more early
  submission at will. A "Ready to submit?" card appears in the same slot regular cards occupy, with
  two options: **Just the facts** (ends the session, graded purely on the ledger already
  accumulated from judgments — no house named) or **Facts + an Answer** (an added step asking
  which house, with a real bonus for right and a real penalty for wrong). "Early" submission as a
  concept is gone along with it — you can no longer submit before the queue empties — but the file
  can still be *ambiguous* at that point if some cards were misjudged, so the old `correctEarly`
  bonus tier survives renamed to `correctAmbiguous`: a right answer on an under-determined file
  still nets less than a right answer on a fully pinned-down one.
- **2026-09-02** — **Rule for future decks: exactly one answerable question per puzzle.** This
  deck already asks only "which house" — the animal's identity (a zebra) is revealed in the
  debrief regardless of which submission mode was chosen, but it is never itself a scored guess.
  Worth stating as a standing authoring rule rather than something to rediscover per deck: a
  satisfying extra fact is narrative payoff, not a second thing to get right.
- **2026-09-02** — **Reframed for the actual target audience (AI engineers) and brought the
  shelved advisors back on that basis.** The keep/ignore loop *is* context engineering — iterate
  over incoming items, keep what's relevant, no more than needed. The submission choice *is*
  prompt engineering — hand the LLM curated context and let it reason ("Just the facts") versus
  pre-resolve the answer yourself and reduce the LLM's job to execution ("Facts + an Answer").
  This isn't a new mechanic, just the first framing where the mechanic is legible to the people
  it's for — the Scholar/Archivist/Cartographer fiction never gave AI engineers a reason to care
  which one they were "asking"; naming them by what they actually are (web search, vector search,
  graph search) might.
- **2026-09-02** — **Advisors revived as one bundled pre-flight check**, run at most once per
  state of the file, available only from "Ready to submit?" — Approach A of three considered
  (the others: delegate the final answer to a tool instead of reasoning it out; or surface tools
  only when the file is diagnosably insufficient). Each of the three stands in for a real
  retrieval primitive and a real class of card: web search ↔ missing domain/reference grounding,
  vector search ↔ redundancy, graph search ↔ a missing constraint edge. `noise` cards are the
  clean residual — no check ever flags them, which only holds because the checks are exhaustive
  over the other three roles; that was a useful design test in itself. Every run costs a flat,
  small ledger penalty regardless of what it finds (a tool call costs something even when it's
  the right call — latency at minimum, plausibly tokens) and any subsequent `Keep?` reclassify
  invalidates the report, since a stale audit over a changed file is worse than no audit. Findings
  stay deliberately vague ("something's missing," never "you're missing card X") — advisors, not
  omniscient evaluators; the debrief is the only place a fuller account exists (as `note` text on
  each `preflight` log entry), matching how every other judgment's correctness is likewise hidden
  live and revealed only in the debrief. Verified live: a clean pass reports "Nothing here raised a
  concern"; a deliberately broken pass (dropped a domain card, kept the redundant echo, dropped a
  needed constraint) flags exactly the three matching findings at once; fixing one via the toggle
  clears the report, and re-running shows exactly the two that remain.

## 5. Findings

1. **The playable loop is context curation.** Keep/ignore is a legible, short-form analogue of
   deciding what belongs in an AI system's context window. The later choice between submitting
   **Just the facts** and **Facts + an Answer** makes the second decision equally concrete:
   whether to supply curated context for a model to reason over, or resolve the answer before
   handing it off. This framing made the purpose of each interaction clearer than the original
   clerk-and-case fiction. The bureaucracy remains a usable skin, but is not load-bearing.

2. **A post-curation pre-flight audit earns its interaction cost; per-card advisor choice did
   not in this deck.** The original Scholar, Archivist, and Cartographer were reframed several
   times, but selecting one before a judgment remained an interruption to the central triage
   loop. One optional, costed audit of the assembled kept set works better for a short session.
   Its three checks map directly to useful retrieval operations: web/reference search detects
   missing grounding, vector/similarity search detects duplicate context, and graph/constraint
   search detects facts that do not yet determine an answer. This finding rejects the per-card
   advisor mechanic, not retrieval assistance or its cost.

3. **The ledger and debrief support recoverable learning.** Reclassifying a card in place avoids
   turning a mistaken first pass into a dead end, while a logged tally makes the debrief explain
   the consequences of every decision. Starting at zero makes the number a session outcome,
   rather than an implied career reputation. The current values are placeholders, but the
   reversible judgment ledger is a useful invariant for a later implementation.

4. **A duplicate carrier should be treated as conditionally useful evidence, not permanently
   fixed noise.** The current deck's echo card is ignore-correct when the original `cat-red`
   card is retained. If the original is ignored, however, the echo is the only available carrier
   of that needed fact and should be kept. This offers a narrow, Tier-1 form of conditional
   relevance using the same deck scale: the final value of evidence depends on the selected
   context. It is distinct from the RFC's still-unbuilt Tier-2 form, where relevance changes
   under competing ambiguous readings.

5. **The first fixed-order pass does not establish ordering agency.** Removing the 2-3 card tray
   reduced friction in this small deck, but a fixed sequence cannot test whether order is useful
   agency. A dependency-respecting random topological order is the next proportionate experiment:
   it varies pacing without forcing players to judge claims before their prerequisite context.

6. **The prototype validates interaction coherence, not player-population or pipeline claims.**
   Author/developer playtesting established that the loop can be played and revised without
   mechanical dead ends. It does not establish a measured 5-10 minute completion time, a broader
   usability result, production solver latency, or that the retained context is solver-verified
   as sufficient. The brute-force prototype intentionally hard-codes its domains, so its domain
   cards are scored as essential evidence without participating in the remaining-grid count.

7. **The final context must be assessed as a whole.** A per-swipe fixed truth label is insufficient
   once duplicate or substitute carriers can be conditionally useful. Future scoring needs to
   distinguish a provisional local judgment from final file quality: whether the selected context
   is correct, sufficient to answer the declared question, and free of unnecessary duplication.

## 6. Conclusion

**SPIKE-006 succeeds as a Tier-1 direction-finding prototype.** It establishes context curation,
not bureaucratic case processing, as the primary gameplay metaphor; replaces the per-card
three-advisor meta-game with an optional, costed pre-flight retrieval audit; and reframes the
final move as submitting curated context alone or curated context plus a resolved answer.

These findings require RFC-005 to be revised before an ADR is created. In particular, the RFC
should no longer promise a tray, per-card advisor selection, reputation as career standing, or a
clerk fiction as the product's load-bearing explanation. The retained principles are short,
binary card triage; recoverable decisions; a single session-closing choice; solver-backed
assessment; and escalation that costs something without taxing ordinary thought.

The next bounded work is a follow-up pass, not product infrastructure: formalize a deck/solver
contract that evaluates domains and retained context together; make `cat-red` and its echo
conditionally substitutable; and use a dependency-respecting shuffled order. That tests
final-context conditional relevance without claiming to solve Tier-2 ambiguity-driven relevance.
Tier-2 ambiguity, subjective constraints, ill-posed cases, image verification, production solver
latency, and measured external playtesting remain outside this spike's conclusion.
