import type { DeckError } from "./types.ts"

/** Shared between `zebra deck` and `zebra extract` (once it routes a deck.yaml here instead of
 * to the LLM) — one human-readable rendering of every `DeckError` variant. */
export function formatDeckError(error: DeckError): string {
  switch (error._tag) {
    case "MalformedDocument":
      return `The deck could not be read as a valid document: ${error.message}`
    case "DanglingReference":
      return `Card "${error.card}" has a "${error.field}" entry naming "${error.target}", which does not exist in this deck.`
    case "DependencyCycle":
      return `These cards depend on each other in a cycle: ${error.cards.join(" -> ")}.`
    case "UnsupportedTier":
      return `Card "${error.card}" declares tier "${error.tier}", but only "strict" is supported.`
    case "UnsupportedConstraintKind":
      return `Constraint "${error.constraintId}" uses kind "${error.kind}", which this format does not define.`
  }
}
