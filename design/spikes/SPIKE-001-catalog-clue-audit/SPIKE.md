---
id: SPIKE-001
title: Catalog Clue-Shape Audit
status: done
rfcs: [RFC-003]
created: 2026-08-18
---

# SPIKE-001: Catalog Clue-Shape Audit

## 1. Question

What are the actual distinct clue-shapes/phrasing patterns present in the seeded catalog
(`catalog/puzzles/`) today? This is the Coverage baseline for
[RFC-003](../../rfc/RFC-003-natural-language-csp-extraction.md) Appendix §9.1 (rule-based/grammar
tier), and gives the §9.2-9.4 spikes (JS-native NLP, GLiNER2, LLM-based) a concrete, stratified
sample of real clue text to test against instead of guessing at phrasing variety.

## 2. Method

Read all 14 puzzles in `catalog/puzzles/` (`PZL-0001` through `PZL-0014`) in full, and manually
categorized every distinct clue/constraint phrasing pattern encountered — not just the classic
zebra-style examples RFC-003 §5.2 used as running examples ("X drinks Y", "X is immediately to
the right of Y"). Cross-checked against `catalog/README.md` to confirm what "the catalog" is
actually scoped to.

## 3. Time-box

≤2 hours (audit only, no code — matches RFC-003 Appendix §9.1's own note that this is "cataloging
work, not a technical risk to de-risk").

## 4. Findings

**The catalog is intentionally broader than zebra-style clue phrasing.** `catalog/README.md`
frames it as "a catalog of zebra puzzles (and **other classic-CSP logic puzzles**)," per
ADR-001 — this isn't a coincidence of seeding, it's the stated scope. RFC-003's §5.2 running
examples ("X drinks Y", "X lives next to Y") only describe a subset of what "the seeded catalog"
in its own Goals (§3) actually contains.

Twelve distinct structural shapes were identified across the 14 puzzles:

| # | Shape | Example | Puzzle(s) | Extraction difficulty note |
|---|---|---|---|---|
| A | Attribute-assignment | "The Englishman lives in the red house." | PZL-0001, 0002 | Matches RFC-003's running examples — straightforward per-clue pattern. |
| B | Positional/adjacency (relative & absolute) | "immediately to the right of", "the middle house", "next to" | PZL-0001, 0002 | Same family as A; well-trodden zebra-style. |
| C | Ordering/precedence (temporal) | "Chen interviews immediately before Deepak"; compound/group forms like "arrive at the same moment, after..." | PZL-0009 (simple), PZL-0010 (compound/group — harder) | Simple form mirrors B; PZL-0010's group-simultaneity + group-ordering forms need multi-entity relation modeling, not a pairwise clue template. |
| D | Negative/elimination | "The culprit is not Colonel Mustard."; "Amara does not interview at 9am." | PZL-0004, 0009 | Straightforward but a distinct template from A/B (negated equality, not positive assignment). |
| E | Symmetric relation + derived meta-rule | "Avalon and Borealis share a border." + "Two countries that share a border must be colored differently." | PZL-0005 | Requires **two-pass extraction**: literal relational facts first, then a generative rule applied over those facts to produce the actual pairwise constraints. Not a flat per-clue pattern. |
| F | Implicit global constraints from stated problem type | N-Queens' "no two queens share a column/diagonal"; magic square's row/column/diagonal sums | PZL-0006, 0008 | Requires recognizing the *named problem type* (chessboard, magic square) and translating it into implicit arithmetic constraints never spelled out per-pair in prose. |
| G | Arithmetic via non-prose diagram | ASCII vertical-addition layout (`SEND + MORE = MONEY`) | PZL-0007 | Not sentence-based at all — a semi-structured visual format. No clue-pattern grammar over sentences applies; needs diagram-aware parsing. |
| H | Quantified numeric-gap/threshold | "at least 4 hours after", "exceeds 43%", "below 600" | PZL-0011, 0012 | Needs numeric/unit parsing; PZL-0011 additionally needs a **derived variable** (min of two scores, a ratio) computed before the threshold check applies. |
| I | Rule-chains with cross-references + branching (non-binary) outcomes | "If not denied by rules 1-2, and the requested amount is within policy limits... Approved." | PZL-0011 | References earlier clues **by number** and encodes multi-way branching to a 3-valued outcome (Denied/Approved/Counter-Offer) rather than a flat constraint set — closer to a decision procedure than a declarative clue list. |
| J | Compound procedural priority rules | "goes before... otherwise... if tied, rotates clockwise starting from North..." | PZL-0010 | Reads as an algorithm description, not a flat constraint list. |
| K | Embedded structured data + vocabulary-mapping preferences | "Amara is vegan." mapped against a markdown table column "Vegan-friendly" | PZL-0013 | The actual constraint data is a markdown table, not prose — a fundamentally different input format. Requirement statements also need an implicit vocabulary mapping ("vegan" → table column name) not stated directly. |
| L | Subset-selection with parenthetical attributes | "a bag of rice (4 kg)... must weigh exactly 10 kg total." | PZL-0014 | A `NAME (VALUE unit)` micro-syntax plus a target-sum-over-a-subset constraint, unlike any assignment clue. |

**Only 4 of 14 puzzles (~29%: PZL-0001, 0002, 0004, 0009) are built entirely from shapes A/B/D/C
(simple)** — the flat, per-clue-sentence patterns RFC-003 §5.2's running examples describe. The
other 10 (~71%) contain at least one shape (E, F, G, H, I, J, K, or L) that a flat clue-pattern
grammar modeled on zebra-style sentences would not handle without additional, family-specific
parsing logic — either a second extraction pass (E), domain-type recognition (F), non-prose
format parsing (G, K), numeric/derived-variable evaluation (H, I), or procedural/rule-chain
interpretation (I, J).

## 5. Conclusion

**For RFC-003 Appendix §9.1 (rule-based/grammar tier)**: the "Coverage: Unmeasured but plausibly
high" and "Level of effort: Low" estimates were implicitly scoped to shapes A/B/D/C only. Against
the *actual* seeded catalog, coverage of all 14 puzzles needs each of the twelve shapes above
handled, not just a handful of zebra-style sentence templates — effort is better described as
"moderate, scoped per distinct problem family" rather than "low, scoped per phrasing variant."
This doesn't rule out the rule-based tier — every shape above is still a bounded, enumerable
category (not unbounded natural language, consistent with RFC-003 §4's Non-Goal), so a grammar
*can* cover all of it — but the honest effort estimate is materially higher than the original
"low" guess, and shapes G (diagram) and K (embedded table) aren't really "grammar over sentences"
problems at all; they need dedicated parsers regardless of which extraction tier is chosen for
the sentence-shaped clues.

**Suggested RFC-003 update** (manual — this spike doesn't edit the RFC): revise the §9.1 Coverage
and Level-of-effort cells to cite this shape breakdown instead of "plausibly high" / "Low," and
add a note that shapes G and K need a non-grammar parsing step regardless of tier choice.

**For the §9.2-9.4 spikes**: don't test only against zebra-style clues (PZL-0001/0002-shaped).
Recommend a stratified sample spanning the difficulty range for whichever tier is spiked next:

- **PZL-0001** — baseline: classic assignment + adjacency (shapes A/B).
- **PZL-0005** — relational fact + generative meta-rule (shape E).
- **PZL-0008** — implicit spatial/arithmetic constraints from a named problem type (shape F).
- **PZL-0011** — numeric threshold + derived variable + cross-referenced rule chain + non-binary
  outcome (shapes H/I) — likely the hardest case in the catalog, and a good test of whether a
  candidate tier can even represent the target concept, not just parse the sentence.
- **PZL-0013** — embedded markdown table + vocabulary-mapping preferences (shape K).

PZL-0007 (shape G, ASCII diagram) is deliberately excluded from the NLP/LLM sample set above —
it isn't a natural-language extraction problem at all, and would only measure something
irrelevant to those tiers.

**Possible new RFC-003 Open Question worth raising** (not added here — manual, per this spike's
scope guard): PZL-0011's rule-cross-referencing ("not denied by rules 1-2") and 3-valued
non-binary outcome push against the "classic CSP = find a satisfying assignment" framing RFC-002
established. Whoever updates RFC-003 next should decide whether this is in-scope as-is (MiniZinc
can express derived variables, thresholds, and multi-valued outcomes fine — it's still a finite
domain) or worth flagging explicitly as a boundary case.
