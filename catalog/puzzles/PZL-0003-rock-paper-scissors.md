---
id: PZL-0003
title: Rock Paper Scissors
tier: unknown
variables: 1
domains: 1
constraints: 4
source: null
difficulty: unknown
created: 2026-08-11
groundTruth:
  entityAxisSize: 2  # player + opponent
  domains:
    - alternatives:
        - names: [move]
          values: [Paper, Rock, Scissors]
---

You're playing paper-rock-scissors.

1. Paper beats rock.
2. Rock beats scissors.
3. Scissors beats paper.
4. Your opponent plays rock.

What should you play?
