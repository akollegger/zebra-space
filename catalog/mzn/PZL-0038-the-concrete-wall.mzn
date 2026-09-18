% Hand-translated from catalog/puzzles/PZL-0038-the-concrete-wall.md (ADR-002 §2.6 example
% catalog). Clue 5 ("The wolf preys on the rabbit") is intentionally NOT encoded as a
% non-adjacency constraint — per the puzzle's own answer-key notes, the concrete walls make
% predator/prey proximity irrelevant, so this clue is a defeated premise contributing no
% constraint, not an omission.

include "globals.mzn";

enum Animal = {Tortoise, Parrot, Goat, Rabbit, Wolf};

array[1..5] of var Animal: pen;

constraint alldifferent(pen);

% 1. The tortoise is in pen 1.
constraint pen[1] = Tortoise;
% 2. The parrot is in pen 2.
constraint pen[2] = Parrot;
% 3. The goat is in pen 3.
constraint pen[3] = Goat;
% 4. The rabbit is in a lower-numbered pen than the wolf.
constraint forall(i, j in 1..5)(pen[i] = Rabbit /\ pen[j] = Wolf -> i < j);

solve satisfy;
