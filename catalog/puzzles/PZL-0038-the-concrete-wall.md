---
id: PZL-0038
title: The Concrete Wall
tier: unknown
variables: 5
domains: 1
constraints: 5
source: null
difficulty: unknown
created: 2026-08-23
groundTruth:
  entityAxisSize: 5
  # PZL-0038's real successful extraction modeled the INVERSE of this domain's most obvious
  # reading (entities = the 5 animals, one domain "pen" ranging 1..5) just as validly as the
  # reverse (entities = 5 pens, domain "animal") — an isomorphic pair of representations. Each is
  # its own `alternatives` entry, pairing ITS OWN name with ITS OWN values — never "pen" paired
  # with the animal names or "animal" paired with 1-5, which would be a scrambled, invalid
  # vocabulary a naive flat name-list x value-set-list match would wrongly accept (found live
  # 2026-09-16, fixed by requiring each alternative to match as one atomic pair).
  domains:
    - alternatives:
        - names: [pen]
          values: ["1", "2", "3", "4", "5"]
        - names: [animal]
          values: [tortoise, parrot, goat, rabbit, wolf]
---

A wildlife park is moving five animals — a wolf, a rabbit, a goat, a parrot, and a tortoise —
into five holding pens standing in a row, numbered 1 to 5, one animal per pen. Each pen is fully
enclosed on all sides by a solid concrete wall; no animal in any pen can see, smell, hear, or
reach any animal in another.

1. The tortoise is in pen 1.
2. The parrot is in pen 2.
3. The goat is in pen 3.
4. The rabbit is in a lower-numbered pen than the wolf.
5. The wolf preys on the rabbit.

Where is each animal?
