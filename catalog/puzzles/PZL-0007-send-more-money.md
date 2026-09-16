---
id: PZL-0007
title: SEND + MORE = MONEY
tier: unknown
variables: 8
domains: 1
constraints: 4
source: https://en.wikipedia.org/wiki/Verbal_arithmetic
difficulty: unknown
created: 2026-08-12
groundTruth:
  entityAxisSize: 8  # the letters S,E,N,D,M,O,R,Y
  expectedDomains:
    - alternatives:
        - names: [digit]
          values: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]
---

Each letter below stands for a unique digit from 0 to 9. The same letter always stands for the
same digit, and no two letters stand for the same digit.

    S E N D
  + M O R E
  ---------
  M O N E Y

Neither S nor M may be 0 (no number starts with a leading zero).

What digit does each letter stand for?
