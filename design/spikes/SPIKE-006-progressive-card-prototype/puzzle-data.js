// PZL-0002 atoms. A keep-correct card may carry AT MOST one of these. Cards with
// cspSource: null are extraneous (noise). Two keep-correct cards sharing a source
// means the deck is saying the same fact twice — only `redundant` is allowed that.
export const CSP_SOURCES = {
  entities: 'entities: 3 houses in a row, numbered 1–3 left to right',
  'color-domain': 'domain: colour ∈ {Blue, Red, Green}',
  'color-unique': 'all-different: no two houses share a colour',
  'animal-domain': 'domain: animal ∈ {Dog, Cat, (unregistered)}',
  C1: 'constraint: the Cat lives in the Red house',
  C2: 'constraint: the Red house is the middle house',
  C3: 'constraint: the Blue house is directly left of the Red house',
  C4: 'constraint: the Dog lives in the Blue house',
};

export const COVER_SHEET = {
  caseId: 'COMPLAINT 1187',
  title: 'Maple Street — Unregistered Animal',
  problem:
    'Neighbors are discretely complaining that someone on Maple Street is keeping an unregistered animal. They will not say which house, or what kind of animal.',
  clue: 'Sort it out. All stuff, no fluff. — Deputy Director.',
  instruction: 'Evaluate each information card, determining whether to keep it in context.',
};

// Cards are presented one at a time, in this order — no tray, no player choice of order.
export const DECK_ORDER = [
  'red-middle',
  'noise-yellow-shutters',
  'domain-colors',
  'lots',
  'cat-red',
  'domain-registry',
  'hay-delivery',
  'colors-unique',
  'blue-left-of-red',
  'noise-quiet-block',
  'dog-blue',
  'noise-society',
  'echo-cat-red',
];

// role:
//   'domain'     — constitutive. Keep-correct; filing does not cut remainingCount.
//   'constraint' — cuts the solution space. Keep-correct.
//   'redundant'  — restates a constraint another card already carries. Ignore-correct.
//   'noise'      — consistent with the solution, constrains nothing. Ignore-correct.
// cspSource: key into CSP_SOURCES, or null if the card carries no CSP atom.
export const CARDS = {
  lots: {
    id: 'lots',
    carrier: 'Assessor — Maple Street plat',
    role: 'domain',
    constraintId: null,
    dependsOn: [],
    cspSource: 'entities',
    text: 'Maple Street, this block: lots 1, 2, and 3, numbered left to right.',
  },
  'domain-colors': {
    id: 'domain-colors',
    carrier: 'Historic Preservation Society — standing mandate',
    role: 'domain',
    constraintId: null,
    dependsOn: [],
    cspSource: 'color-domain',
    text: 'Approved dwelling colours for this block: red, green, or blue.',
  },
  'colors-unique': {
    id: 'colors-unique',
    carrier: 'Historic Preservation Society — enforcement note',
    role: 'domain',
    constraintId: null,
    dependsOn: ['domain-colors'],
    cspSource: 'color-unique',
    text: 'No two dwellings on the block may share a colour.',
  },
  'domain-registry': {
    id: 'domain-registry',
    carrier: 'Municipal Pet Registry — Maple Street extract',
    role: 'domain',
    constraintId: null,
    dependsOn: [],
    cspSource: 'animal-domain',
    text: 'Registered to this block: one dog, one cat.',
  },
  'red-middle': {
    id: 'red-middle',
    carrier: 'Zoning Memo #114 — lot survey',
    role: 'constraint',
    constraintId: 'red-middle',
    dependsOn: ['domain-colors', 'lots'],
    cspSource: 'C2',
    text: 'The red-painted unit occupies the center lot, per survey marker 2B.',
  },
  'blue-left-of-red': {
    id: 'blue-left-of-red',
    carrier: 'Unsigned note, loose in the folder',
    role: 'constraint',
    constraintId: 'blue-left-of-red',
    dependsOn: ['domain-colors', 'lots'],
    cspSource: 'C3',
    text: 'Blue is one door down from red, on the low-number side.',
  },
  'cat-red': {
    id: 'cat-red',
    carrier: 'Interview — R. Alvarez, block superintendent',
    role: 'constraint',
    constraintId: 'cat-red',
    dependsOn: ['domain-colors', 'domain-registry'],
    cspSource: 'C1',
    text: 'The cat lives behind a red door.',
  },
  'dog-blue': {
    id: 'dog-blue',
    carrier: 'Vet Registry extract — tag #58',
    role: 'constraint',
    constraintId: 'dog-blue',
    dependsOn: ['domain-colors', 'domain-registry'],
    cspSource: 'C4',
    text: 'Tag #58, dog class. Address on file: the blue house.',
  },
  'echo-cat-red': {
    id: 'echo-cat-red',
    carrier: 'Interview — R. Alvarez, follow-up call',
    role: 'redundant',
    constraintId: 'cat-red',
    dependsOn: ['cat-red'],
    duplicateOf: 'cat-red',
    cspSource: 'C1',
    text: "Like I said. Cat, red door. I'm not going to keep saying it.",
  },
  'hay-delivery': {
    id: 'hay-delivery',
    carrier: 'Freight manifest — Tuesday',
    role: 'noise',
    constraintId: null,
    dependsOn: ['domain-registry'],
    cspSource: null,
    text: 'Forty pounds of timothy hay, delivered to Maple Street. Signed for. No house number given.',
  },
  'noise-yellow-shutters': {
    id: 'noise-yellow-shutters',
    carrier: 'Maintenance log — spring',
    role: 'noise',
    constraintId: null,
    dependsOn: ['domain-colors'],
    cspSource: null,
    text: 'Replaced the yellow shutters on the end unit. Weather damage.',
  },
  'noise-quiet-block': {
    id: 'noise-quiet-block',
    carrier: 'Interview — T. Okafor, mail carrier',
    role: 'noise',
    constraintId: null,
    dependsOn: ['domain-registry'],
    cspSource: null,
    text: "Quietest block on my route. Whatever's back there, it doesn't bark.",
  },
  'noise-society': {
    id: 'noise-society',
    carrier: 'Maple Street Historical Society newsletter',
    role: 'noise',
    constraintId: null,
    dependsOn: ['domain-colors'],
    cspSource: null,
    text: 'The block has kept its three colours since 1958. We remain, as ever, the most photographed street in the district.',
  },
};

// Every ledger value in the game, in one place — the tuning knob set. Starts at zero: this is
// not a "reputation" that decays from some starting trust, it's a plain tally of bonuses and
// penalties, so a perfect one-pass session with a correct answer produces the highest possible
// number and nothing else can beat it.
//
// `consult` is deliberately absent — advisors are shelved (see advisors.js and the machine's
// dead-but-intact CONSULT wiring), not deleted; reinstating them means restoring this key too.
export const LEDGER = {
  start: 0,
  judgment: {
    domain: { keep: +3, ignore: -3 },
    constraint: { keep: +3, ignore: -3 },
    redundant: { keep: 0, ignore: +1 },
    noise: { keep: -1, ignore: +1 },
  },
  reopen: { justified: 0, unjustified: -1 },
  reopenedMisjudge: -1,
  // A tool call costs something even when it's the right call — at minimum latency, plausibly
  // tokens. Flat and small: the point is that asking is never free, not that asking is unwise.
  preflight: -1,
  // `correctAmbiguous`: a right answer given while the file still admitted more than one
  // arrangement — still correct, but less informed than a right answer on a fully-determined
  // file, so it nets less. A wrong answer costs real points; it is not a free roll of the dice.
  verdict: { correct: +20, correctAmbiguous: +8, incorrect: -25 },
};

export const KEEP_IS_CORRECT = {
  domain: true,
  constraint: true,
  redundant: false,
  noise: false,
};

function validateDeck() {
  const ids = Object.keys(CARDS);
  for (const id of ids) {
    const card = CARDS[id];
    console.assert(card.id === id, `CARDS['${id}'].id is '${card.id}'`);
    console.assert(KEEP_IS_CORRECT[card.role] !== undefined, `card '${id}' has unknown role '${card.role}'`);
    console.assert(LEDGER.judgment[card.role], `no ledger values for role '${card.role}'`);
    console.assert(
      card.cspSource === null || CSP_SOURCES[card.cspSource],
      `card '${id}' has unknown cspSource '${card.cspSource}'`,
    );
    console.assert(
      card.role === 'noise' ? card.cspSource === null : true,
      `noise card '${id}' must have cspSource: null`,
    );
    for (const dep of card.dependsOn) {
      console.assert(CARDS[dep], `card '${id}' depends on unknown card '${dep}'`);
      console.assert(dep !== id, `card '${id}' depends on itself`);
    }
  }
  for (const id of DECK_ORDER) console.assert(CARDS[id], `DECK_ORDER references unknown card '${id}'`);
  console.assert(DECK_ORDER.length === ids.length, `DECK_ORDER has ${DECK_ORDER.length} of ${ids.length} cards`);
  console.assert(new Set(DECK_ORDER).size === DECK_ORDER.length, 'DECK_ORDER contains duplicates');

  // One non-redundant keep-correct card per CSP atom. A second voice is `redundant`.
  const claimed = {};
  for (const card of Object.values(CARDS)) {
    if (!card.cspSource || card.role === 'redundant') continue;
    console.assert(
      !claimed[card.cspSource],
      `cspSource '${card.cspSource}' claimed by both '${claimed[card.cspSource]}' and '${card.id}' — split the card`,
    );
    claimed[card.cspSource] = card.id;
  }

  const state = {};
  const visit = (id, trail) => {
    if (state[id] === 'done') return;
    if (state[id] === 'open') {
      console.assert(false, `dependency cycle: ${[...trail, id].join(' -> ')}`);
      return;
    }
    state[id] = 'open';
    for (const dep of CARDS[id]?.dependsOn ?? []) visit(dep, [...trail, id]);
    state[id] = 'done';
  };
  for (const id of ids) visit(id, []);
}

validateDeck();
