# Deck Catalog

A catalog of decks — puzzles staged for the progressive card-loop session (RFC-005), per
[ADR-006](../../design/adr/ADR-006-deck-yaml-format.md). Each entry is one YAML document,
separating the underlying constraint satisfaction problem from how it's revealed to a player
through cards.

## Format

- File: `DECK-NNNN-short-name.yaml`, `NNNN` zero-padded, sequential.
- Structure: `brief` (task framing), `csp` (entities/domains/constraints), `cards` (deal order,
  dependencies, and each card's claims), `closure` (the closing question and its answer) — see
  ADR-006 §2.1–§2.3 for the complete schema.

## Index

| Deck | Title |
|---|---|
| [DECK-0001](DECK-0001-maple-street.yaml) | Maple Street — Unregistered Animal |
