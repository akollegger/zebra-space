# Contract: `zebra extract`'s deck support

Extends [`specs/003-cli-interface/contracts/cli-contract.md`](../../003-cli-interface/contracts/cli-contract.md),
which remains the source of truth for the shared invocation shape (bare-`zebra` help, top-level
`--help`/`-h`/`--version` dispatch rule, unknown-subcommand handling, per-subcommand `--help`).
This file documents what's new: `extract`'s second recognized input format. There is no `deck`
subcommand — see "Why no `deck` subcommand" below for why that's a deliberate omission, not a
gap.

## `extract` on a deck YAML document

A deck's `csp` block already IS an `ExtractedCsp` (ADR-006 §2.2) — `zebra extract` accepts a
deck document as an alternative to a natural-language puzzle file, with no CLI flag needed to
opt in. Detection is by **document shape**, not file extension: a top-level `csp`/`cards`/
`closure` structure ([`looksLikeDeckDocument`](../../../src/deck/load.ts)) routes the input to
`loadDeck` + `deckCsp` instead of the LLM; anything else (including a parse failure) falls
through to the existing prose path unchanged. Extension-sniffing (e.g. a `.deck.yaml` suffix)
was considered and rejected as the *primary* signal: `catalog/decks/DECK-NNNN-*.yaml` (ADR-006
§2.4) carries no such suffix, so relying on it would silently miss the catalog's own decks.
`.deck.yaml` remains a reasonable naming convention for new, non-catalog decks (mirroring
`.spec.ts`/`.test.ts`/`.d.ts`'s "infix before the real extension" pattern) — but it's cosmetic,
never load-bearing for detection.

- The structural check a deck.yaml passes through (`loadDeck`'s dangling-reference/cycle/
  tier/kind validation) plays the same role here that the fidelity critic (ADR-004) plays for
  prose: the trust check every source must pass before its `ExtractedCsp` is handed onward. A
  `DeckError` is reported the same way a `CriticRejected` is — a `UserFacingError`, exit 1.
- `--model`/`--frontier-model` are silently inapplicable for a deck source (no LLM is called);
  they're simply unused, not rejected as invalid flags.
- `--json` output gains no new field for a deck source — `model` is just absent, since
  `ExtractionSource.model` is optional. The default (human) output's provenance line reads
  `... (deck YAML, no LLM)` instead of `... using <model>`.
- This makes `zebra extract deck.yaml | zebra solve -` (or via a temp file, matching the
  existing prose-path pattern) work with **zero new solving logic** — `solve` is completely
  unaware a deck was ever involved.

## Why no `deck` subcommand

An earlier draft of this feature added a `zebra deck <deck.yaml>` command that loaded, validated,
compiled, solved, classified, and answered a deck all in one step. Once `extract` gained deck
support (above), that command's compile/solve half became pure duplication of
`extract | solve` — the same work, run a second time through a separate code path.

What was left — card classification and the closure answer — doesn't belong in a CLI verb at
all, for a reason more specific than "it wasn't split out yet": **a CLI subcommand should be a
verb that operates on whatever input is viable for it and produces whatever output is viable**,
the way `extract` now takes either a puzzle or a deck, and `solve` takes any compiled model
regardless of what produced it. Classification and the closure answer fail that test at the
concept level, not just the implementation level — both depend on *cards*, a presentation unit
that only the deck format has. A natural-language puzzle has no card boundaries until (and
unless) something extracts structure from it; a compiled `.mzn` model has already erased any
card-level grouping the source might have had. There is no version of "classify" or "the closing
answer" that would do anything meaningful given a prose file or a model file — so unlike
`extract`/`solve`, it was never a general verb narrowly implemented; it was deck-internal
structure inspection wearing a command's clothes.

`classifyCards` and `solveDeck` (library-contract.md) remain exactly where they already lived —
ordinary library functions, called directly by tests today and, per RFC-005, by the eventual
game/session engine, which is the real consumer these outputs were designed for in the first
place. Neither needs a terminal-facing verb to be useful there.
