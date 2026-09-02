# Maple Street — a progressive card game about context engineering

A playable prototype for [RFC-005](../../rfc/RFC-005-progressive-puzzle-game-mechanics.md)'s
progressive puzzle mechanics. You play a clerk sorting a case file, one card at a time — the
game is a small, concrete stand-in for two things AI engineers do constantly: **deciding what
belongs in a context window**, and then **deciding how much of the reasoning to do yourself
versus hand to the model**.

For the full design rationale, the dead ends, and everything that changed along the way, see
[SPIKE.md](SPIKE.md). This document is just how to play.

## Running it

From the repo root:

```bash
pnpm run spike:006
```

This serves the prototype at `http://localhost:4173` and opens it in your browser. It's a
zero-build static app (Vue 3 + XState 5 + Tailwind, all loaded from a CDN) — there's nothing to
compile, but it does need to be served over HTTP rather than opened as a local file, since
browsers won't load ES modules over `file://`.

## The setup

Someone on Maple Street is keeping an animal that's not on the municipal registry. Neighbors
won't say which house, or what kind of animal. Your job: sort through a stack of information
cards — interviews, memos, registry extracts, zoning records — and work out which house.

**There is exactly one question to answer.** Anything else satisfying you learn along the way is
just the story paying off, not something you're scored on.

## How to play

1. **One card at a time.** Cards are presented automatically, in a fixed order — there's no
   tray to choose from. Read the card, then decide: **Keep** it (it's a real fact about the
   case) or **Ignore** it (it's noise — true, maybe, but it doesn't help pin down the answer).
2. **You're on your own.** There's no hint button while you work through the deck. Some cards
   won't make sense yet — you may not have read the card that gives them context. That's fine;
   judging a card before you have the context for it costs you nothing, good or bad. Order
   matters, but blind guessing has no upside either.
3. **"The file" tracks everything you've decided**, kept and ignored, with the actual text of
   each card (not just its label) so you're never stuck trying to remember what a card said.
   Changed your mind about one? Toggle its **Keep?** checkbox — that's a full do-over for that
   card, no need to re-read it.
4. **Once every card has been processed**, a "Ready to submit?" card appears in the same spot
   the regular cards did. Before deciding how to close the file, you can **run a pre-flight
   check** — a stand-in for three tool calls (web search, vector search, graph search) an AI
   engineer might actually reach for. It won't tell you what's wrong, only that something might
   be: an incomplete picture of the block, something kept that says the same thing twice, or
   facts that don't yet connect to a single answer. Running it isn't free, and running it again
   after you've made changes costs again too.
5. **Close the file one of two ways:**
   - **Just the facts** — end the session on the strength of your triage alone. This is the
     "hand the model curated context and let it reason" move: you're not naming a house, just
     asserting that your kept pile is the right and complete one.
   - **Facts + an Answer** — go one step further and name the house yourself. This is "do the
     reasoning yourself, so the model's job is just to act on it." A right answer is worth more
     when your file was fully conclusive at the time; a wrong answer costs real points — it's a
     real guess, not a free one.

## What you don't see, and when you do

Your standing — a plain tally of bonuses and penalties, starting at zero — is hidden while you
play, along with how many possible arrangements the file still admits. A real clerk doesn't see
their own score mid-shift. Once you close the file, a debrief shows the actual solved case, your
final standing, and a full breakdown of what every action was worth and why — the teaching
moment the rest of the session deliberately withholds.

## Debug mode

Check the **debug** box in the header (or load the page with `?debug=1`) to see your running
standing, the remaining-solution count, each card's true role and dependency state, and a live
self-check that the ledger adds up. Useful for understanding the mechanics; turn it off before
you actually try to play.
