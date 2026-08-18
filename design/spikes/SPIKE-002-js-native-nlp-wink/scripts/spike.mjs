// Throwaway spike script — SPIKE-002 (RFC-003 Appendix §9.2).
// Tests wink-nlp's custom-entity pattern matcher against SPIKE-001's stratified sample.
import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";

const nlp = winkNLP(model);
const its = nlp.its;

function report(title, patterns, sentences) {
  console.log(`\n=== ${title} ===`);
  try {
    nlp.learnCustomEntities(patterns, { matchValue: false, usePOS: true, useEntity: true });
  } catch (err) {
    console.log(`  !! learnCustomEntities threw: ${err.message}`);
    return;
  }
  for (const sentence of sentences) {
    const doc = nlp.readDoc(sentence);
    const matches = doc.customEntities().out(its.detail);
    console.log(`- "${sentence}"`);
    if (matches.length === 0) {
      console.log("  -> NO MATCH");
    } else {
      for (const m of matches) console.log(`  -> [${m.type}] "${m.value}"`);
    }
  }
}

// --- Shapes A/B/D/C (simple) — PZL-0001 clue sentences ---
report(
  "Shapes A/B/D/C: attribute-assignment, positional, negation, ordering",
  [
    { name: "livesIn", patterns: ["[NOUN|PROPN] lives in the [NOUN|ADJ] house"] },
    { name: "drinks", patterns: ["[NOUN|PROPN] drinks [NOUN|PROPN]"] },
    { name: "immediatelyRightOf", patterns: [
      "the [NOUN|ADJ] house is immediately to the right of the [NOUN|ADJ] house",
    ] },
    { name: "livesNextTo", patterns: [
      "the [NOUN|PROPN] lives next to the [NOUN|ADJ] house",
    ] },
  ],
  [
    "The Englishman lives in the red house.",
    "The Ukrainian drinks tea.",
    "The green house is immediately to the right of the ivory house.",
    "The Norwegian lives next to the blue house.",
    "Coffee is drunk in the green house.", // passive-voice variant of "drinks" — expect NO MATCH
  ]
);

// --- Shape E: relational fact + generative meta-rule — PZL-0005 ---
report(
  "Shape E: symmetric relation + derived meta-rule (PZL-0005)",
  [
    { name: "sharesBorder", patterns: ["[PROPN] and [PROPN] share a border"] },
    { name: "metaRule", patterns: [
      "[NOUN] that share a border must be colored differently",
    ] },
  ],
  [
    "Avalon and Borealis share a border.",
    "Two countries that share a border must be colored differently.",
  ]
);

// --- Shape F: implicit spatial/arithmetic constraints from a named problem type — PZL-0008 ---
// First attempt: a literal "3-by-3" style hyphenated compound in the pattern — expect failure.
report(
  "Shape F attempt 1: hyphenated compound in pattern (PZL-0008) — expected to fail",
  [
    { name: "gridFill", patterns: [
      "fill a [CARDINAL]-by-[CARDINAL] grid with each of the digits",
    ] },
  ],
  ["Fill a 3-by-3 grid with each of the digits 1 through 9."]
);
// Fallback: drop the hyphenated compound, match only the recoverable parts.
report(
  "Shape F attempt 2: fallback without hyphenated compound (PZL-0008)",
  [
    { name: "gridFill", patterns: ["fill a grid with each of the digits"] },
    { name: "cellValue", patterns: ["the [ADJ|NOUN] cell is [CARDINAL]"] },
  ],
  [
    "Fill a 3-by-3 grid with each of the digits 1 through 9, using each digit exactly once, so that every row, every column, and both diagonals add up to the same total: 15.",
    "The top-left cell is 4.",
  ]
);

// --- Shapes H/I: numeric threshold + derived variable + rule-chain — PZL-0011 ---
report(
  "Shapes H/I: numeric threshold + derived variable + cross-referenced rule chain (PZL-0011)",
  [
    { name: "thresholdRule", patterns: [
      "if [NOUN|DET] score is below [CARDINAL] the loan is [NOUN|PROPN]",
    ] },
    { name: "ruleReference", patterns: [
      "if not denied by rules [CARDINAL]-[CARDINAL]",
    ] },
  ],
  [
    "If that score is below 600, the loan is Denied.",
    "If not denied by rules 1-2, and the requested amount is within policy limits for their combined income, the loan is Approved.",
  ]
);

// --- Shape K: embedded table + vocabulary-mapping preference — PZL-0013 ---
report(
  "Shape K: preference statement needing vocabulary mapping to a table column (PZL-0013)",
  [
    { name: "dietaryPreference", patterns: ["[PROPN] is [ADJ]"] },
    { name: "allergyRequirement", patterns: [
      "[PROPN] has a [NOUN] allergy and needs a [ADJ] kitchen",
    ] },
  ],
  [
    "Amara is vegan.",
    "Ben has a nut allergy and needs a nut-free kitchen.",
    "| Thai Palace | No | No | Yes | $$ |", // the markdown table row itself — expect NO MATCH / garbage tokenization
  ]
);
