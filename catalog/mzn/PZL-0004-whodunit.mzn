% Hand-translated from catalog/puzzles/PZL-0004-whodunit.md (ADR-002 §2.6 example catalog).
% No all_different needed — see research.md Finding 4: this puzzle is direct elimination
% across three independent categories, not an attribute-grid puzzle.

enum Suspect = {Scarlett, Mustard, Plum};
enum Weapon = {Candlestick, Revolver, Rope};
enum Room = {Kitchen, Library, Conservatory};

var Suspect: culprit;
var Weapon: weapon;
var Room: room;

constraint culprit != Mustard;
constraint culprit != Scarlett;
constraint weapon != Revolver;
constraint weapon != Rope;
constraint room != Kitchen;
constraint room != Library;

solve satisfy;
