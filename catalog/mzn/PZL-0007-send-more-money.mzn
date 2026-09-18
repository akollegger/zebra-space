include "globals.mzn";

% Decision variables: each letter is a digit 0-9.
var 0..9: S;
var 0..9: E;
var 0..9: N;
var 0..9: D;
var 0..9: M;
var 0..9: O;
var 0..9: R;
var 0..9: Y;

constraint alldifferent([S, E, N, D, M, O, R, Y]);

% No leading zeros.
constraint S != 0;
constraint M != 0;

% Carry variables (0 or 1) for the classic SEND+MORE=MONEY column-by-column addition.
var 0..1: c1;
var 0..1: c2;
var 0..1: c3;
var 0..1: c4;

% Column 1 (rightmost): D + E = Y + 10*c1
constraint D + E = Y + 10 * c1;

% Column 2: N + R + c1 = E + 10*c2
constraint N + R + c1 = E + 10 * c2;

% Column 3: E + O + c2 = N + 10*c3
constraint E + O + c2 = N + 10 * c3;

% Column 4: S + M + c3 = O + 10*c4
constraint S + M + c3 = O + 10 * c4;

% Column 5 (leftmost): the final carry becomes MONEY's leading digit.
constraint c4 = M;
