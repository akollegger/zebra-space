enum Move = {Rock, Paper, Scissors};

var Move: my_play;
var Move: opponent_play;

% Clue 4: opponent plays rock.
constraint opponent_play = Rock;

% Clues 1-3 (paper beats rock, rock beats scissors, scissors beats paper) are encoded directly
% in the win condition below, rather than as separate constraints, since they only matter in
% service of "I want to win."
constraint (my_play = Paper /\ opponent_play = Rock) \/
           (my_play = Rock /\ opponent_play = Scissors) \/
           (my_play = Scissors /\ opponent_play = Paper);
