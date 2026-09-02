// Advisors answer "do you know anything about this?" about the card in isolation.
//
// Scholar      — parametric world knowledge. Never this-file facts.
// Archivist    — session memory / similarity. What else in this file resembles this card.
// Cartographer — topology of attributes: houses, colours, animals, and the edges between them.
//                Never street geography.
//
// Each card: exactly one illuminating, one neutral, one irrelevant. Outcome is STATIC.
export const ADVISOR_RESPONSES = {
  lots: {
    scholar: {
      outcome: 'neutral',
      text: 'Municipal plats number lots left to right as a matter of convention. Nothing surprising in the form of it.',
    },
    archivist: {
      outcome: 'irrelevant',
      text: 'This is the only plat in the file. Nothing else cites a lot number, so I have nothing to match it against.',
    },
    cartographer: {
      outcome: 'illuminating',
      text: 'Three positions in a line. That is the skeleton — every colour and every animal has to hang on one of those three nodes.',
    },
  },

  'domain-colors': {
    scholar: {
      outcome: 'illuminating',
      text: 'A named palette is exhaustive. If an instrument lists three colours, a fourth is not a dwelling colour under that instrument.',
    },
    archivist: {
      outcome: 'neutral',
      text: 'The Society appears more than once in this file — a mandate, an enforcement note, a newsletter. Same body, different documents.',
    },
    cartographer: {
      outcome: 'irrelevant',
      text: 'Three colour values, no house attached. A palette is not a graph.',
    },
  },

  'colors-unique': {
    scholar: {
      outcome: 'neutral',
      text: 'Uniqueness clauses are standard in preservation instruments. I can tell you that in general, which does not tell you which house is which.',
    },
    archivist: {
      outcome: 'illuminating',
      text: 'This is the uniqueness clause that belongs with the three-colour mandate already in the file. Same instrument family, second document — a companion, not a new palette.',
    },
    cartographer: {
      outcome: 'irrelevant',
      text: 'A uniqueness rule is a restriction on a graph, not an edge in one. I still have no house-to-colour link.',
    },
  },

  'domain-registry': {
    scholar: {
      outcome: 'neutral',
      text: 'Registries lag reality. Absence of a filing is weak evidence in general — though an unfiled animal is exactly what a complaint like this tends to be about.',
    },
    archivist: {
      outcome: 'illuminating',
      text: 'This is the only document that names animal kinds. Everything else, if it mentions an animal at all, names one at a time.',
    },
    cartographer: {
      outcome: 'irrelevant',
      text: 'Two animal values, no house attached. I cannot hang either of them on a node yet.',
    },
  },

  'red-middle': {
    scholar: {
      outcome: 'neutral',
      text: 'Survey markers are dependable, and "2B" is ordinary centre-lot notation. Nothing surprising in the form of it.',
    },
    archivist: {
      outcome: 'irrelevant',
      text: 'Memo #114 stands alone. Nothing else in the file cites a survey marker.',
    },
    cartographer: {
      outcome: 'illuminating',
      text: 'This is an edge: colour Red — occupies — the middle position. Once that node is coloured, every other colour is relative to it.',
    },
  },

  'blue-left-of-red': {
    scholar: {
      outcome: 'neutral',
      text: '"Low-number side" is municipal usage for toward lot one. No interpretation needed.',
    },
    archivist: {
      outcome: 'irrelevant',
      text: 'Unsigned, undated, and nothing else in the file shares its phrasing.',
    },
    cartographer: {
      outcome: 'illuminating',
      text: 'An adjacency edge: Blue sits immediately left of Red. Given a fixed Red, Blue is determined, and the third colour has one slot left.',
    },
  },

  'cat-red': {
    scholar: {
      outcome: 'irrelevant',
      text: 'Cats and doors — there is no general rule. A red door proves nothing about cats in the abstract.',
    },
    archivist: {
      outcome: 'neutral',
      text: 'Alvarez appears more than once in this file. Worth knowing the same voice recurs.',
    },
    cartographer: {
      outcome: 'illuminating',
      text: 'An edge between an animal and a colour. Without at least one such edge, the colour map and the animal map are two unconnected diagrams.',
    },
  },

  'dog-blue': {
    scholar: {
      outcome: 'irrelevant',
      text: 'I have nothing general to say about tag numbering. A municipal serial is a fact about a filing cabinet, not about the world.',
    },
    archivist: {
      outcome: 'illuminating',
      text: "Tag #58 is the registry's dog — same animal, second document. The dog is accounted for; whatever is unregistered is not this dog.",
    },
    cartographer: {
      outcome: 'neutral',
      text: 'Another animal-to-colour edge. It extends the map the same way the cat did — useful, but not a new kind of road.',
    },
  },

  'echo-cat-red': {
    scholar: {
      outcome: 'irrelevant',
      text: 'People repeat themselves. I can tell you that in general, which tells you nothing about this particular repetition.',
    },
    archivist: {
      outcome: 'illuminating',
      text: "Near-identical to Alvarez's first statement — same claim, same source, no new content. A second copy of a fact, not a second fact.",
    },
    cartographer: {
      outcome: 'neutral',
      text: 'It traces an edge the map already has. No new roads.',
    },
  },

  'hay-delivery': {
    scholar: {
      outcome: 'illuminating',
      text: 'Forty pounds of timothy is an equine ration — no cat or dog eats hay in that quantity. And no horse fits a row house. Something equine, then, and smaller.',
    },
    archivist: {
      outcome: 'neutral',
      text: 'One other dated delivery in the file — a shutter replacement in spring. Different freight, no obvious connection.',
    },
    cartographer: {
      outcome: 'irrelevant',
      text: 'A delivery is an event, not a relation among house, colour, and animal. I have nowhere to put it on the graph.',
    },
  },

  'noise-yellow-shutters': {
    scholar: {
      outcome: 'illuminating',
      text: 'Shutters are trim, not the dwelling. A shutter colour is not a house colour — it tells you nothing about how the house itself is painted.',
    },
    archivist: {
      outcome: 'neutral',
      text: 'A maintenance log and a freight manifest are the only two dated records. Nothing else here mentions shutters.',
    },
    cartographer: {
      outcome: 'irrelevant',
      text: 'Yellow hangs on shutters, and shutters are not a house-node. No edge to dwelling-colour, animal, or position.',
    },
  },

  'noise-quiet-block': {
    scholar: {
      outcome: 'neutral',
      text: 'Silence proves very little. Plenty of animals are quiet, and plenty of dogs scarcely bark at all.',
    },
    archivist: {
      outcome: 'illuminating',
      text: 'The registry already accounts for the only dog on file. A carrier noticing no barking adds nothing the registry has not already established.',
    },
    cartographer: {
      outcome: 'irrelevant',
      text: 'Silence is not a node. I cannot attach it to a house, a colour, or an animal.',
    },
  },

  'noise-society': {
    scholar: {
      outcome: 'irrelevant',
      text: 'Historical societies say this sort of thing about every block they have ever occupied. I would read nothing into it.',
    },
    archivist: {
      outcome: 'illuminating',
      text: 'This restates the three-colour mandate already in the file, in softer language — no new claim. A newsletter is not a second source for its own mandate.',
    },
    cartographer: {
      outcome: 'neutral',
      text: 'It describes the whole block at once, so there is no edge to draw. A chorus, not a connection.',
    },
  },
};

import { CARDS } from './puzzle-data.js';

export const ADVISOR_IDS = ['scholar', 'archivist', 'cartographer'];

const FALLBACK = { outcome: 'irrelevant', text: 'Nothing comes to mind on this one.' };

export function askAdvisor(advisorId, cardId, context) {
  const entry = ADVISOR_RESPONSES[cardId]?.[advisorId] ?? FALLBACK;
  const text = typeof entry.text === 'function' ? entry.text(cardId, context) : entry.text;
  return { outcome: entry.outcome, text };
}

function validateAdvisors() {
  for (const id of Object.keys(CARDS)) {
    console.assert(ADVISOR_RESPONSES[id], `no advisor responses for card '${id}'`);
  }
  for (const [cardId, byAdvisor] of Object.entries(ADVISOR_RESPONSES)) {
    const outcomes = ADVISOR_IDS.map((id) => byAdvisor[id]?.outcome);
    console.assert(
      outcomes.filter((o) => o === 'illuminating').length === 1 &&
        outcomes.filter((o) => o === 'neutral').length === 1 &&
        outcomes.filter((o) => o === 'irrelevant').length === 1,
      `card '${cardId}' advisor outcomes are ${JSON.stringify(outcomes)} — expected one of each`,
    );
  }
}

validateAdvisors();
