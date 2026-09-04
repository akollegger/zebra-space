import type { DeckError } from "./types.ts"

/** One human-readable rendering of every `DeckError` variant — used by `zebra extract` when it
 * routes a deck.yaml through `loadDeck` (src/cli/subcommands/extract.ts). */
export function formatDeckError(error: DeckError): string {
  switch (error._tag) {
    case "MalformedDocument":
      return `The deck could not be read as a valid document: ${error.message}`
    case "DanglingReference":
      return formatDanglingReference(error)
    case "DuplicateCardId":
      return `More than one card uses the id "${error.id}" — card ids must be unique.`
    case "DependencyCycle":
      return `These cards depend on each other in a cycle: ${error.cards.join(" -> ")}.`
    case "UnsupportedTier":
      return `Card "${error.card}" declares tier "${error.tier}", but only "strict" is supported.`
    case "UnsupportedConstraintKind":
      return `Constraint "${error.constraintId}" uses kind "${error.kind}", which this format does not define.`
    case "InvalidClosure":
      return `This deck's closure is invalid: ${error.reason}.`
  }
}

function formatDanglingReference(error: DeckError & { readonly _tag: "DanglingReference" }): string {
  // `reveals` has a specific expected shape (the literal "entities", or a domain variable) — say
  // so directly rather than the generic message, which reads like an ordinary typo'd id when the
  // more likely mistake here is not knowing the field only accepts those two forms.
  if (error.field === "reveals") {
    return (
      `Card "${error.card}" has a "reveals" entry naming "${error.target}", which is neither ` +
      `"entities" nor a declared domain variable.`
    )
  }
  return `Card "${error.card}" has a "${error.field}" entry naming "${error.target}", which does not exist in this deck.`
}
