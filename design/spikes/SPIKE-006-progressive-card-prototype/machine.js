import { createMachine, assign } from 'https://esm.sh/xstate@5';
import { DECK_ORDER, CARDS, LEDGER, KEEP_IS_CORRECT } from './puzzle-data.js';
import { remainingGrids, SOLVED_GRID } from './solver.js';

// Advisors (Scholar/Archivist/Cartographer) are shelved, not deleted: the hints didn't factor
// into play even after being reframed as "do you know anything about this?" (see SPIKE.md
// Notes). advisors.js is untouched and ready to revive; this machine simply no longer wires a
// CONSULT event to anything, so it's unreachable without also restoring that wiring.

function filedConstraintIds(filed) {
  return Object.keys(filed)
    .filter((id) => filed[id])
    .map((id) => CARDS[id].constraintId)
    .filter(Boolean);
}

// A card's dependencies are satisfied once every one of them has been READ (opened) — whether
// it was kept or ignored. `revealed` only ever grows, so this is monotone: once satisfied,
// always satisfied. That monotonicity is what makes the scoring invariants unambiguous.
const depsSatisfied = (ctx, cardId) => (CARDS[cardId].dependsOn ?? []).every((dep) => ctx.revealed[dep]);

const isCorrect = (role, judgment) => (judgment === 'keep' ? KEEP_IS_CORRECT[role] : !KEEP_IS_CORRECT[role]);

// The pre-flight check: one bundled tool call over the WHOLE kept set, not per-card, run at
// most once per state of the file (a subsequent reclassify invalidates the report — see
// `reclassify` below). Each of the three checks stands in for a real retrieval tool an AI
// engineer would reach for:
//   web search    — is the file's domain/reference grounding complete?
//   vector search — does the kept set say the same thing twice?
//   graph search  — do the kept constraints actually connect to a determinate answer?
// Findings are deliberately vague ("something's missing"), never naming the card — these are
// advisors, not omniscient evaluators, and the swipe (deciding what to actually do about it)
// stays the player's.
function runPreflightChecks(context) {
  const findings = [];

  const missingDomain = Object.values(CARDS).some((card) => card.role === 'domain' && !context.filed[card.id]);
  if (missingDomain) {
    findings.push({ tool: 'web search', text: "The file's picture of the block itself may be incomplete." });
  }

  const seenConstraintIds = new Set();
  const hasRedundancy = Object.keys(context.filed).some((id) => {
    const card = CARDS[id];
    if (card.role === 'redundant') return true;
    if (!card.constraintId) return false;
    if (seenConstraintIds.has(card.constraintId)) return true;
    seenConstraintIds.add(card.constraintId);
    return false;
  });
  if (hasRedundancy) {
    findings.push({ tool: 'vector search', text: 'Something in the kept pile might be saying the same thing twice.' });
  }

  const currentIds = filedConstraintIds(context.filed);
  const currentCount = remainingGrids(currentIds).length;
  const missingConstraint =
    currentCount > 1 &&
    Object.values(CARDS).some(
      (card) =>
        card.role === 'constraint' &&
        !context.filed[card.id] &&
        remainingGrids([...currentIds, card.constraintId]).length < currentCount,
    );
  if (missingConstraint) {
    findings.push({ tool: 'graph search', text: 'The kept facts may not all connect to a single answer yet.' });
  }

  if (findings.length === 0) {
    findings.push({ tool: null, text: 'Nothing here raised a concern.' });
  }
  return findings;
}

// The first judgment of a card, made as it's presented from the queue.
const judge = (judgment) =>
  assign(({ context }) => {
    const cardId = context.currentCardId;
    const card = CARDS[cardId];
    const satisfied = depsSatisfied(context, cardId);
    const correct = isCorrect(card.role, judgment);

    // Deps not satisfied => 0. The player could not have known, so no credit and no blame.
    const base = satisfied ? LEDGER.judgment[card.role][judgment] : 0;

    const filed = judgment === 'keep' ? { ...context.filed, [cardId]: true } : context.filed;
    const dismissed = judgment === 'ignore' ? { ...context.dismissed, [cardId]: true } : context.dismissed;

    return {
      filed,
      dismissed,
      currentCardId: null,
      judgmentDelta: { ...context.judgmentDelta, [cardId]: base },
      ledger: context.ledger + base,
      remainingCount: remainingGrids(filedConstraintIds(filed)).length,
      decisionLog: [
        ...context.decisionLog,
        {
          type: judgment === 'keep' ? 'keep' : 'ignore',
          cardId,
          role: card.role,
          depsSatisfied: satisfied,
          correct,
          delta: base,
          ledgerAfter: context.ledger + base,
          note: satisfied
            ? correct
              ? 'Correct.'
              : 'Incorrect.'
            : 'Judged before its dependencies were read — no credit, no blame.',
        },
      ],
    };
  });

// Reconsidering an already-processed card via the "Keep?" toggle — reverses the old banked
// judgment and applies the new one in one atomic step. No advisors, no need to re-view the card
// (its text is already visible in the processed list), so no state transition either: this is
// pure ledger bookkeeping, reachable from wherever the toggle lives.
const reclassify = assign(({ context, event }) => {
  const { cardId, judgment } = event;
  const card = CARDS[cardId];
  const wasReopenedBefore = !!context.reopened[cardId];
  const satisfied = depsSatisfied(context, cardId);
  const correct = isCorrect(card.role, judgment);

  const banked = context.judgmentDelta[cardId] ?? 0;
  const reopenCost = satisfied ? LEDGER.reopen.justified : LEDGER.reopen.unjustified;
  const base = satisfied ? LEDGER.judgment[card.role][judgment] : 0;
  // Only a card that has ALREADY been reconsidered once risks this — the first correction is
  // never penalized beyond losing the correct-value credit, only repeated indecision is.
  const misjudgePenalty = wasReopenedBefore && !correct ? LEDGER.reopenedMisjudge : 0;
  const delta = -banked + reopenCost + base + misjudgePenalty;

  const filed = { ...context.filed };
  const dismissed = { ...context.dismissed };
  delete filed[cardId];
  delete dismissed[cardId];
  if (judgment === 'keep') filed[cardId] = true;
  else dismissed[cardId] = true;

  const notes = [
    satisfied
      ? 'Reconsidered — the file had moved on since this was judged.'
      : 'Reconsidered before anything new had been read — churn.',
  ];
  if (misjudgePenalty) notes.push('Wrong again after already reconsidering it once.');

  return {
    filed,
    dismissed,
    // Bank ONLY the role value — never the churn/misjudge cost, or a later reclassify would
    // refund a penalty that already landed.
    judgmentDelta: { ...context.judgmentDelta, [cardId]: base },
    reopened: { ...context.reopened, [cardId]: true },
    ledger: context.ledger + delta,
    remainingCount: remainingGrids(filedConstraintIds(filed)).length,
    // The file just changed — any prior pre-flight report is stale until re-run.
    preflightReport: null,
    decisionLog: [
      ...context.decisionLog,
      {
        type: 'reclassify',
        cardId,
        role: card.role,
        depsSatisfied: satisfied,
        correct,
        delta,
        ledgerAfter: context.ledger + delta,
        note: notes.join(' '),
      },
    ],
  };
});

export const gameMachine = createMachine({
  id: 'game',
  initial: 'processing',
  context: () => ({
    queue: DECK_ORDER.slice(),
    currentCardId: null,
    filed: {},
    dismissed: {},
    revealed: {}, // cardId -> true, set on open, never cleared
    judgmentDelta: {}, // cardId -> banked role value, replaced on reclassify
    reopened: {}, // cardId -> true, sticky; gates the misjudge penalty
    ledger: LEDGER.start,
    remainingCount: remainingGrids([]).length,
    preflightReport: null, // [{ tool, text }], set by RUN_PREFLIGHT, cleared by any reclassify
    decisionLog: [],
    verdict: null,
  }),
  states: {
    processing: {
      initial: 'tray',
      // Reclassifying a processed card is possible from any point in play — while a card is in
      // hand, while deciding whether to answer, wherever. It never changes which screen is
      // showing, only the ledger and the file, so it's handled once here rather than in every
      // child state.
      on: {
        RECLASSIFY: {
          guard: ({ context, event }) => !!(context.filed[event.cardId] || context.dismissed[event.cardId]),
          actions: reclassify,
        },
      },
      states: {
        tray: {
          // Eventless: whenever `tray` is entered (start, or after a judgment returns here),
          // present the next queued card immediately — no click to open it. Once the queue is
          // empty, move on to the submission choice instead of waiting for one.
          always: [
            {
              guard: ({ context }) => context.queue.length > 0,
              target: 'cardOpen',
              actions: assign(({ context }) => {
                const cardId = context.queue[0];
                return {
                  currentCardId: cardId,
                  queue: context.queue.slice(1),
                  revealed: { ...context.revealed, [cardId]: true },
                  decisionLog: [
                    ...context.decisionLog,
                    {
                      type: 'open',
                      cardId,
                      depsSatisfied: depsSatisfied(context, cardId),
                      delta: 0,
                      ledgerAfter: context.ledger,
                      note: '',
                    },
                  ],
                };
              }),
            },
            { target: 'readyToSubmit' },
          ],
        },
        cardOpen: {
          on: {
            FILE: { target: '#game.processing.tray', actions: judge('keep') },
            DISMISS: { target: '#game.processing.tray', actions: judge('ignore') },
          },
        },
        readyToSubmit: {
          on: {
            RUN_PREFLIGHT: {
              actions: assign(({ context }) => {
                const findings = runPreflightChecks(context);
                const delta = LEDGER.preflight;
                return {
                  preflightReport: findings,
                  ledger: context.ledger + delta,
                  decisionLog: [
                    ...context.decisionLog,
                    {
                      type: 'preflight',
                      delta,
                      ledgerAfter: context.ledger + delta,
                      note: findings.map((f) => (f.tool ? `${f.tool}: ${f.text}` : f.text)).join(' '),
                    },
                  ],
                };
              }),
            },
            JUST_FACTS: {
              target: '#game.submitted',
              actions: assign(({ context }) => ({
                verdict: {
                  mode: 'facts',
                  correctHouse: SOLVED_GRID.find((house) => house.animal === 'Zebra').position,
                },
                decisionLog: [
                  ...context.decisionLog,
                  { type: 'submit', mode: 'facts', delta: 0, ledgerAfter: context.ledger, note: 'Closed the file on the facts alone.' },
                ],
              })),
            },
            CHOOSE_ANSWER: 'answering',
          },
        },
        answering: {
          on: {
            BACK: 'readyToSubmit',
            SUBMIT_ANSWER: {
              target: '#game.submitted',
              actions: assign(({ context, event }) => {
                const correctHouse = SOLVED_GRID.find((house) => house.animal === 'Zebra').position;
                const correct = event.house === correctHouse;
                const ambiguous = context.remainingCount !== 1;
                const delta = !correct
                  ? LEDGER.verdict.incorrect
                  : ambiguous
                    ? LEDGER.verdict.correctAmbiguous
                    : LEDGER.verdict.correct;
                return {
                  verdict: {
                    mode: 'answer',
                    house: event.house,
                    correct,
                    ambiguous,
                    correctHouse,
                    remainingCountAtAnswer: context.remainingCount,
                  },
                  ledger: context.ledger + delta,
                  decisionLog: [
                    ...context.decisionLog,
                    {
                      type: 'submit',
                      mode: 'answer',
                      house: event.house,
                      correct,
                      delta,
                      ledgerAfter: context.ledger + delta,
                      note: correct
                        ? ambiguous
                          ? 'Correct, but the file still admitted more than one arrangement.'
                          : 'Correct, on a file that admitted only one arrangement.'
                        : 'Incorrect.',
                    },
                  ],
                };
              }),
            },
          },
        },
      },
    },
    submitted: { type: 'final' },
  },
});
