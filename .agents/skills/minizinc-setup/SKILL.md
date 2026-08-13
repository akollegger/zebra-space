---
name: "minizinc-setup"
description: "Check that the MiniZinc toolchain and a usable finite-domain (CP) solver are available; register one (e.g. Gecode) if it's installed but not wired up."
argument-hint: "Optional: a preferred solver name (defaults to Gecode)"
compatibility: "macOS/Linux with a shell; assumes MiniZinc is either already installed or installable via the platform's package manager"
metadata:
  author: "zebra-space"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

Treat `$ARGUMENTS` as an optional preferred solver id/name (e.g. `Chuffed`). Default to `Gecode`
if empty. Passed straight through to the script below as its one positional argument.

## Purpose

This project (per ADR-002) hands solving off to MiniZinc rather than implementing a solver.
That only works if `minizinc` is installed **and** a real finite-domain constraint solver is
registered with it — a gap that isn't automatic on at least some Homebrew-based installs
(Homebrew's `minizinc` formula depends on `gecode`, but hasn't always registered it as a
MiniZinc solver). This skill checks for both and fixes the second if possible.

Nothing here is specific to any particular coding agent or assistant — it's a plain
diagnose-and-fix routine over the `minizinc` CLI and the filesystem. The actual logic lives in
one place, `scripts/setup-minizinc-solver.sh` (in the repo this skill is used from), so it stays
usable directly by a human or CI with no agent involved, and this skill doesn't duplicate — and
risk drifting from — that implementation.

## Outline

1. Run `./scripts/setup-minizinc-solver.sh` (or `./scripts/setup-minizinc-solver.sh
   "$ARGUMENTS"` if a preferred solver was given). It:
   - Checks `minizinc` is on `PATH`; if not, reports platform-appropriate install instructions
     and stops without installing anything itself.
   - Checks `minizinc --solvers` for an already-usable finite-domain (CP) solver (tagged `cp` —
     MIP-only solvers like COIN-BC/CPLEX/Gurobi/HiGHS/SCIP/Xpress don't count, since they don't
     support the `-n <k>` multi-solution semantics this project needs). If one exists, it exits
     immediately — nothing to fix.
   - Otherwise looks for an installed-but-unregistered Gecode (via Homebrew's `fzn-gecode`), and
     if found, writes a `.msc` registration to MiniZinc's user-level solver config directory
     (never into a package-manager-owned directory, since those get wiped on upgrade).
   - Verifies the fix with a smoke-test model through `minizinc --output-mode json`.
   - Never installs packages — if nothing usable is found on disk, it reports the
     platform-appropriate install command and exits non-zero.
2. Relay the script's own output as the report — it already states what was found, what (if
   anything) was fixed, and what to do if blocked. Don't re-derive or re-explain the diagnostic
   steps in prose; the script is the source of truth for *how*, this skill is just a
   conversational entry point to *when to run it*.

## Constraints

- Never installs packages (MiniZinc, Gecode, or anything else) — matches the script's own rule.
- If `scripts/setup-minizinc-solver.sh` doesn't exist in the current repo, say so and stop rather
  than reimplementing its logic inline.

## Completion Report

Relay the script's own final output (found/fixed/blocked, and exit code) — see Outline step 2.
