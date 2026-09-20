% Hand-translated from catalog/puzzles/PZL-0001-life-international-1962.md — the classic
% "Einstein's riddle" / Life International 1962 zebra puzzle (ADR-002 §2.6 example catalog).
% Each same-house clue ("the Englishman lives in the red house") is encoded as a bidirectional
% forall over house indices, not a one-way implication: since every array is a permutation of
% houses, the clue asserts the SAME house satisfies both sides, which <-> captures directly.

include "globals.mzn";

enum Color = {Yellow, Blue, Red, Ivory, Green};
enum Nationality = {Norwegian, Ukrainian, Englishman, Spaniard, Japanese};
enum Pet = {Fox, Horse, Snails, Dog, Zebra};
enum Drink = {Water, Tea, Milk, OrangeJuice, Coffee};
enum Cigarette = {Kools, Chesterfields, OldGold, LuckyStrike, Parliaments};

array[1..5] of var Color: color;
array[1..5] of var Nationality: nationality;
array[1..5] of var Pet: pet;
array[1..5] of var Drink: drink;
array[1..5] of var Cigarette: cigarette;

constraint alldifferent(color);
constraint alldifferent(nationality);
constraint alldifferent(pet);
constraint alldifferent(drink);
constraint alldifferent(cigarette);

predicate next_to(int: i, int: j) = abs(i - j) = 1;

% 1. The Englishman lives in the red house.
constraint forall(h in 1..5)(nationality[h] = Englishman <-> color[h] = Red);
% 2. The Spaniard owns the dog.
constraint forall(h in 1..5)(nationality[h] = Spaniard <-> pet[h] = Dog);
% 3. Coffee is drunk in the green house.
constraint forall(h in 1..5)(drink[h] = Coffee <-> color[h] = Green);
% 4. The Ukrainian drinks tea.
constraint forall(h in 1..5)(nationality[h] = Ukrainian <-> drink[h] = Tea);
% 5. The green house is immediately to the right of the ivory house.
constraint exists(h in 1..4)(color[h] = Ivory /\ color[h + 1] = Green);
% 6. The Old Gold smoker owns snails.
constraint forall(h in 1..5)(cigarette[h] = OldGold <-> pet[h] = Snails);
% 7. Kools are smoked in the yellow house.
constraint forall(h in 1..5)(cigarette[h] = Kools <-> color[h] = Yellow);
% 8. Milk is drunk in the middle house.
constraint drink[3] = Milk;
% 9. The Norwegian lives in the first house.
constraint nationality[1] = Norwegian;
% 10. The man who smokes Chesterfields lives in the house next to the man with the fox.
constraint exists(h1, h2 in 1..5)(next_to(h1, h2) /\ cigarette[h1] = Chesterfields /\ pet[h2] = Fox);
% 11. Kools are smoked in the house next to the house where the horse is kept.
constraint exists(h1, h2 in 1..5)(next_to(h1, h2) /\ cigarette[h1] = Kools /\ pet[h2] = Horse);
% 12. The Lucky Strike smoker drinks orange juice.
constraint forall(h in 1..5)(cigarette[h] = LuckyStrike <-> drink[h] = OrangeJuice);
% 13. The Japanese smokes Parliaments.
constraint forall(h in 1..5)(nationality[h] = Japanese <-> cigarette[h] = Parliaments);
% 14. The Norwegian lives next to the blue house.
constraint exists(h1, h2 in 1..5)(next_to(h1, h2) /\ nationality[h1] = Norwegian /\ color[h2] = Blue);

solve satisfy;
