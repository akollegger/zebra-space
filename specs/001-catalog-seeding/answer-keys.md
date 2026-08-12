# Answer Keys — Puzzle Catalog Seeding

Private verification record (FR-009). Not part of the public catalog schema — not linked from
`catalog/README.md`, not referenced by any puzzle's frontmatter. Used only to confirm FR-008/
SC-004 (each seed puzzle has exactly one valid solution).

## PZL-0001 — Life International 1962

| House | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Color | Yellow | Blue | Red | Ivory | Green |
| Nationality | Norwegian | Ukrainian | Englishman | Spaniard | Japanese |
| Pet | Fox | Horse | Snails | Dog | Zebra |
| Drink | Water | Tea | Milk | Orange Juice | Coffee |
| Cigarette | Kools | Chesterfields | Old Gold | Lucky Strike | Parliaments |

Answer: the **Norwegian** drinks water; the **Japanese** owns the zebra. Matches the published
25 March 1963 *Life International* solution (research.md).

## PZL-0002 — Three Houses (Context Graphs Example)

| House | 1 | 2 | 3 |
|---|---|---|---|
| Color | Blue | Red | Green |
| Animal | Dog | Cat | Zebra |

Answer: the **Zebra** lives in **House 3**. Matches the source article's stated solution.

## PZL-0003 — Rock Paper Scissors

Opponent plays Rock. Paper beats Rock (clue 1); Rock beats Scissors (clue 2, irrelevant here);
Scissors beats Paper (clue 3, irrelevant here). Only **Paper** beats the opponent's Rock.

Answer: **Paper**.

## PZL-0004 — Whodunit

- Suspect: clues 1-2 eliminate Mustard and Scarlett → **Professor Plum**.
- Weapon: clues 3-4 eliminate Revolver and Rope → **Candlestick**.
- Room: clues 5-6 eliminate Kitchen and Library → **Conservatory**.

Answer: **Professor Plum**, with the **Candlestick**, in the **Conservatory**.

## PZL-0005 — Four Countries

Avalon=Red (clue 6). Borealis and Cascadia both border Avalon (clues 1-2), so neither is Red;
they also border each other (clue 3), so they're different colors → Green/Blue in some order.
Clue 7 fixes Borealis=Green, so Cascadia=Blue (only color left that satisfies clues 2-3). Delmar
borders Borealis (Green) and Cascadia (Blue) but not Avalon, so Delmar must avoid Green and Blue
→ Delmar=Red.

Answer: **Cascadia = Blue**, **Delmar = Red**.

## PZL-0006 — Four Queens

Row 1 = column 2 (given). Testing the two known 4-queens solutions
(col-per-row: (2,4,1,3) and (3,1,4,2)) against row 1 = column 2 selects the first.

Answer: Row 1 → column 2, Row 2 → column 4, Row 3 → column 1, Row 4 → column 3.

## PZL-0007 — SEND + MORE = MONEY

The classic unique solution: S=9, E=5, N=6, D=7, M=1, O=0, R=8, Y=2.
Check: 9567 + 1085 = 10652 = MONEY (M=1,O=0,N=6,E=5,Y=2). ✓

Answer: **S=9, E=5, N=6, D=7, M=1, O=0, R=8, Y=2**.

## PZL-0008 — Lo Shu Square

Given top-left=4, top-middle=9, center=5: row 1 sums to 15 → top-right=2. Diagonal
(top-left, center, bottom-right) sums to 15 → 4+5+bottom-right=15 → bottom-right=6. Column 3
sums to 15 → top-right(2)+middle-right+bottom-right(6)=15 → middle-right=7. Row 2 sums to 15 →
middle-left+5+7=15 → middle-left=3. Column 1 sums to 15 → 4+3+bottom-left=15 → bottom-left=8.
Column 2 sums to 15 → 9+5+bottom-middle=15 → bottom-middle=1. All nine digits 1-9 used exactly
once; other diagonal (top-right, center, bottom-left) = 2+5+8=15 ✓.

Answer:
```
4 9 2
3 5 7
8 1 6
```

## PZL-0009 — Interview Slots

Clue 2 (Chen immediately before Deepak) allows only Chen=9/Deepak=10 or Chen=10/Deepak=11.
Clue 3 rules out Deepak=11, leaving Chen=9, Deepak=10. Amara takes the remaining slot, 11am,
consistent with clue 1 (Amara ≠ 9am).

Answer: **Chen = 9am, Deepak = 10am, Amara = 11am**.

## PZL-0010 — Four-Way Stop

South arrives strictly earliest (clue 6), no conflict, so South goes first (rule 2). Pedestrian
and East tie in arrival (clue 5), but the pedestrian is crossing the eastern crosswalk (clue 4),
so rule 1 gives the pedestrian priority over the East car specifically — Pedestrian then East.
North and West tie, arriving after Pedestrian/East (clue 7); rule 3's clockwise order
(North, East, South, West) puts North ahead of West in that tie.

Answer: **South → Pedestrian → East → North → West**.

## PZL-0011 — Loan Review

Lower credit score = min(680, 750) = 680 ≥ 600, so rule 1 does not deny. Combined DTI =
3,200 / 9,000 ≈ 35.6% ≤ 43%, so rule 2 does not deny. Clue 7 says the requested amount exceeds
the policy limit, so rule 4 applies (not rule 3).

Answer: **Counter-Offer**.

## PZL-0012 — Medication Schedule

Candidate slots for Drug C: 9am is 1 hour from the 8am meal (too close, rule 2 excludes it);
11am is exactly 2 hours from the 1pm meal (allowed); 4pm is 3 hours from the 1pm meal (allowed).
So C ∈ {11am, 4pm}.
- If C = 4pm: A and B split {9am, 11am}. Neither ordering gives a 4-hour gap (9am→11am is only
  2 hours; 11am→9am is negative) — rule 1 fails either way. Invalid.
- If C = 11am: A and B split {9am, 4pm}. A=9am, B=4pm gives a 7-hour gap, satisfying rule 1.
  A=4pm, B=9am is negative — invalid. So A=9am, B=4pm.

Answer: **Drug A = 9am, Drug B = 4pm, Drug C = 11am**.

## PZL-0013 — Picking a Restaurant

The real constraints are only vegan-friendly (Amara), nut-free kitchen (Ben), and gluten-free
options (Cora) — Price is never mentioned by anyone, so it's a red herring. Checking each
restaurant against those three columns only: Thai Palace and Pizzeria Roma both fail
vegan-friendly; Wheat & Co fails gluten-free options; Garden Table is "Yes" on all three.

Answer: **Garden Table**.

## PZL-0014 — Packing the Box

Of the 32 possible item subsets, exactly two sum to 10 kg: {rice, toolbox} (4+6) and
{book set, skillet, first-aid kit} (3+5+2). Only the second includes the first-aid kit, which
the puzzle requires.

Answer: **hardcover book set + cast-iron skillet + first-aid kit**.
