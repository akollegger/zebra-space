% Hand-translated from catalog/puzzles/PZL-0011-loan-review.md (ADR-002 §2.6 example catalog).
% Not an attribute-grid puzzle — a single decision variable determined by a small chain of
% if/then policy rules over given (compile-time) facts, encoded as reified implications rather
% than alldifferent-style permutation constraints. See research.md's PZL-0004 note on the same
% "direct elimination, not a grid" pattern.

enum Decision = {Denied, Approved, CounterOffer};
var Decision: outcome;

int: priyaScore = 680;
int: samScore = 750;
int: lowerCreditScore = min(priyaScore, samScore);
int: combinedIncome = 9000;
int: combinedDebt = 3200;
bool: requestedExceedsLimit = true; % clue 7

bool: deniedByScore = lowerCreditScore < 600;                      % rule 1
bool: deniedByDti = combinedDebt * 100 > combinedIncome * 43;      % rule 2 (DTI > 43%, integer-safe)
bool: denied = deniedByScore \/ deniedByDti;

constraint denied -> outcome = Denied;
constraint (not denied /\ not requestedExceedsLimit) -> outcome = Approved; % rule 3
constraint (not denied /\ requestedExceedsLimit) -> outcome = CounterOffer; % rule 4

solve satisfy;
