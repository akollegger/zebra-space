// SPIKE-013 §2 step 1: expected vocabulary shape for the determinate subset of SPIKE-008's
// 14-puzzle sample (9 of 14 — PZL-0022 is a COP, PZL-0028 ambiguous, PZL-0033 subjective,
// PZL-0015/0018 non-problem; "correct" has no single meaning for those five, so this spike
// scores only the nine where it does).
//
// NOT mechanically derived from eval/answer-keys.json alone — that file's own shape varies too
// much to parse generically (parallel arrays for PZL-0001/0002/0010; a flat digit-map for
// PZL-0007; a single scalar for PZL-0003/0011; a dict-keyed-by-entity for PZL-0038 — confirmed
// by inspecting src/eval/grader.ts's own gradeDeterminate dispatch, which is itself partly
// puzzle-id-specific rather than fully generic). Instead, hand-verified once against the REAL,
// already-known-successful extraction each puzzle produced in full-critic runs (SPIKE-011's
// results/comparison-2026-09-15T11-24-35-879Z.json — the run that achieved MATCH on PZL-0004/
// PZL-0011, and reached SOLVE_UNIQUE on every puzzle here) — grounding "expected" in a real
// working vocabulary shape, not a guess.
//
// Two puzzles need an explicit note on why the shape isn't a single obvious answer:
// - PZL-0010's real successful extraction ALSO declared a second domain ("arrivalTime") beyond
//   what the answer key's own "order" key requires — a legitimate, even more complete
//   vocabulary. Scoring is a COVERAGE check (every expected domain must be found), never an
//   exact-count match, so an extraction with MORE domains than listed here is never penalized —
//   mirrors ADR-007 §2.2's own "subset, not exact match" lesson for the real grader.
// - PZL-0038's real successful extraction modeled the INVERSE of the answer key's own shape
//   (entities = the 5 animals, one domain "pen" ranging 1..5 — rather than entities = 5 pens,
//   domain "animal") — an equally valid isomorphic representation. `valueSets` lists both
//   acceptable value sets; either counts as a match.

export interface ExpectedDomain {
  /** Canonical name(s) this domain might reasonably be called — fuzzy-matched by score.ts, not
   * required to match verbatim. */
  readonly names: readonly string[]
  /** Acceptable value sets — usually one; PZL-0038 has two because either of an isomorphic
   * pair of representations is correct. A produced domain matches if its value set covers ANY
   * one of these (subset/coverage, not exact-count — extra values are fine). */
  readonly valueSets: readonly (readonly string[])[]
}

export interface GroundTruthEntry {
  readonly puzzleId: string
  /** Size of the puzzle's primary entity axis — the row count clues actually reference by
   * identity. Not the domain-value count (a domain's own values are listed in `domains`
   * separately). */
  readonly expectedEntityAxisSize: number
  /** Every domain listed here must be found among the produced domains (coverage, not exact
   * match) for the puzzle to score as structurally correct — see score.ts. */
  readonly domains: readonly ExpectedDomain[]
}

export const GROUND_TRUTH: readonly GroundTruthEntry[] = [
  {
    puzzleId: "PZL-0001",
    expectedEntityAxisSize: 5,
    domains: [
      { names: ["color"], valueSets: [["Yellow", "Blue", "Red", "Ivory", "Green"]] },
      { names: ["nationality"], valueSets: [["Norwegian", "Ukrainian", "Englishman", "Spaniard", "Japanese"]] },
      { names: ["pet"], valueSets: [["Fox", "Horse", "Snails", "Dog", "Zebra"]] },
      { names: ["drink"], valueSets: [["Water", "Tea", "Milk", "Orange Juice", "Coffee"]] },
      { names: ["cigarette", "smoke"], valueSets: [["Kools", "Chesterfields", "Old Gold", "Lucky Strike", "Parliaments"]] },
    ],
  },
  {
    puzzleId: "PZL-0002",
    expectedEntityAxisSize: 3,
    domains: [
      { names: ["color"], valueSets: [["Blue", "Red", "Green"]] },
      { names: ["animal"], valueSets: [["Dog", "Cat", "Zebra"]] },
    ],
  },
  {
    puzzleId: "PZL-0003",
    expectedEntityAxisSize: 2, // player + opponent
    domains: [{ names: ["move"], valueSets: [["Paper", "Rock", "Scissors"]] }],
  },
  {
    puzzleId: "PZL-0004",
    expectedEntityAxisSize: 1, // one implicit "murder"/"scenario" entity
    domains: [
      { names: ["suspect"], valueSets: [["Miss Scarlett", "Colonel Mustard", "Professor Plum"]] },
      { names: ["weapon"], valueSets: [["Candlestick", "Revolver", "Rope"]] },
      { names: ["room"], valueSets: [["Kitchen", "Library", "Conservatory"]] },
    ],
  },
  {
    puzzleId: "PZL-0007",
    expectedEntityAxisSize: 8, // the letters S,E,N,D,M,O,R,Y
    domains: [{ names: ["digit"], valueSets: [["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]] }],
  },
  {
    puzzleId: "PZL-0010",
    expectedEntityAxisSize: 5,
    domains: [{ names: ["order"], valueSets: [["South", "Pedestrian", "East", "North", "West"]] }],
  },
  {
    puzzleId: "PZL-0011",
    expectedEntityAxisSize: 1, // one implicit "application"/"scenario" entity
    // Only the final decision domain is required — the intermediate known-fact domains
    // (credit scores, income, debt) a real extraction may also declare are legitimate but not
    // required, since declaring given facts as domains vs. compile-time constants is itself an
    // underdetermined modeling choice this spike doesn't take a position on.
    domains: [{ names: ["outcome", "decision"], valueSets: [["Denied", "Approved", "Counter-Offer"]] }],
  },
  {
    puzzleId: "PZL-0012",
    expectedEntityAxisSize: 3, // the three drugs
    domains: [{ names: ["time"], valueSets: [["9am", "11am", "4pm"]] }],
  },
  {
    puzzleId: "PZL-0038",
    expectedEntityAxisSize: 5,
    domains: [
      {
        names: ["pen", "animal"],
        valueSets: [
          ["1", "2", "3", "4", "5"],
          ["tortoise", "parrot", "goat", "rabbit", "wolf"],
        ],
      },
    ],
  },
]

export function groundTruthFor(puzzleId: string): GroundTruthEntry | undefined {
  return GROUND_TRUTH.find((g) => g.puzzleId === puzzleId)
}
