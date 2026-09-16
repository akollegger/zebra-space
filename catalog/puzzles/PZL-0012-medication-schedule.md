---
id: PZL-0012
title: Medication Schedule
tier: unknown
variables: 3
domains: 1
constraints: 3
source: null
difficulty: unknown
created: 2026-08-12
groundTruth:
  entityAxisSize: 3  # the three drugs
  domains:
    - alternatives:
        - names: [time]
          values: ["9am", "11am", "4pm"]
---

A patient takes three medications — Drug A, Drug B, and Drug C — once each today, at 9am,
11am, or 4pm. The patient's meals are at 8am and 1pm.

1. Drug B must be taken at least 4 hours after Drug A.
2. Drug C must be taken at least 2 hours away from any meal.

At what time is each drug taken?
