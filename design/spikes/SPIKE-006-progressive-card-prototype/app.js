import { createApp, reactive, computed, ref } from 'https://esm.sh/vue@3/dist/vue.esm-browser.js';
import { createActor } from 'https://esm.sh/xstate@5';
import { gameMachine } from './machine.js';
import { COVER_SHEET, CARDS, CSP_SOURCES, LEDGER } from './puzzle-data.js';
import { SOLVED_GRID } from './solver.js';

// NOTE: LEDGER is imported for the debrief and debug panel ONLY. It is deliberately not
// returned from setup(), so no price or ground truth can leak into the play UI.

const actor = createActor(gameMachine);

const LABELS = {
  open: 'read',
  keep: 'kept',
  ignore: 'ignored',
  reclassify: 'reconsidered',
  preflight: 'ran a check',
  submit: 'submitted',
};

createApp({
  setup() {
    const snapshot = reactive({ value: actor.getSnapshot() });
    actor.subscribe((next) => {
      snapshot.value = next;
    });
    actor.start();

    const debug = ref(new URLSearchParams(location.search).has('debug'));

    const context = computed(() => snapshot.value.context);
    const isCardOpen = computed(() => snapshot.value.matches({ processing: 'cardOpen' }));
    const isReadyToSubmit = computed(() => snapshot.value.matches({ processing: 'readyToSubmit' }));
    const isAnswering = computed(() => snapshot.value.matches({ processing: 'answering' }));
    const isSubmitted = computed(() => snapshot.value.matches('submitted'));
    const currentCard = computed(() => (context.value.currentCardId ? CARDS[context.value.currentCardId] : null));
    const keptCards = computed(() => Object.keys(context.value.filed).map((id) => CARDS[id]));
    const ignoredCards = computed(() => Object.keys(context.value.dismissed).map((id) => CARDS[id]));
    const preflightReport = computed(() => context.value.preflightReport);

    // Debug only — a category, never a number, and never shown during play at all.
    const readiness = computed(() => {
      const n = context.value.remainingCount;
      return n === 0 ? 'contradiction' : n === 1 ? 'complete' : 'open';
    });

    const debriefEntries = computed(() =>
      context.value.decisionLog.map((entry) => ({
        ...entry,
        label: LABELS[entry.type] ?? entry.type,
        subject:
          entry.type === 'submit'
            ? entry.mode === 'answer'
              ? `House ${entry.house}`
              : 'Just the facts'
            : entry.type === 'preflight'
              ? 'Pre-flight check'
              : CARDS[entry.cardId].carrier,
      })),
    );

    // Cheapest possible regression test in a zero-build project: the ledger must always equal
    // the starting value plus every logged delta.
    const logSum = computed(
      () => LEDGER.start + context.value.decisionLog.reduce((total, e) => total + (e.delta ?? 0), 0),
    );
    const logSumOk = computed(() => logSum.value === context.value.ledger);

    // Debug only — role and deps-satisfaction would hand the player the correct judgment.
    const debugCards = computed(() =>
      Object.values(CARDS).map((card) => ({
        id: card.id,
        role: card.role,
        cspSource: card.cspSource ? CSP_SOURCES[card.cspSource] : '—',
        dependsOn: card.dependsOn,
        revealed: !!context.value.revealed[card.id],
        depsSatisfied: card.dependsOn.every((dep) => context.value.revealed[dep]),
        judged: context.value.filed[card.id] ? 'kept' : context.value.dismissed[card.id] ? 'ignored' : '—',
        banked: context.value.judgmentDelta[card.id],
        reopened: !!context.value.reopened[card.id],
      })),
    );

    const currentCspSource = computed(() => {
      const card = currentCard.value;
      if (!card) return null;
      return card.cspSource ? CSP_SOURCES[card.cspSource] : 'no CSP source (extraneous)';
    });

    const solvedGrid = computed(() => SOLVED_GRID);

    return {
      CARDS,
      COVER_SHEET,
      startingLedger: LEDGER.start,
      debug,
      context,
      isCardOpen,
      isReadyToSubmit,
      isAnswering,
      isSubmitted,
      currentCard,
      keptCards,
      ignoredCards,
      preflightReport,
      readiness,
      debriefEntries,
      logSum,
      logSumOk,
      debugCards,
      currentCspSource,
      solvedGrid,
      toggleDebug: () => {
        debug.value = !debug.value;
      },
      keep: () => actor.send({ type: 'FILE' }),
      ignore: () => actor.send({ type: 'DISMISS' }),
      toggleKeep: (cardId, checked) => actor.send({ type: 'RECLASSIFY', cardId, judgment: checked ? 'keep' : 'ignore' }),
      runPreflight: () => actor.send({ type: 'RUN_PREFLIGHT' }),
      chooseJustFacts: () => actor.send({ type: 'JUST_FACTS' }),
      chooseAnswer: () => actor.send({ type: 'CHOOSE_ANSWER' }),
      backToSubmitChoice: () => actor.send({ type: 'BACK' }),
      submitAnswer: (house) => actor.send({ type: 'SUBMIT_ANSWER', house }),
    };
  },
  template: '#app-template',
}).mount('#app');
