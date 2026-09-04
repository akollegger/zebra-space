import type { Card, CardClassification, Deck } from "./types.ts"

/** ADR-006 §2.3 / data-model.md's `CardClassification` derivation: no `role` field exists on a
 * `Card` — every card's standing is read off what it references and its position among cards
 * referencing the same thing, in `deck.cards`' own order. */
export function classifyCards(deck: Deck): Readonly<Record<string, CardClassification>> {
  const seenReveals = new Set<string>()
  const seenConstraints = new Set<string>()
  const result: Record<string, CardClassification> = {}

  for (const card of deck.cards) {
    result[card.id] = classifyCard(card, seenReveals, seenConstraints)
    for (const target of card.reveals ?? []) seenReveals.add(target)
    for (const target of card.constraints ?? []) seenConstraints.add(target)
  }

  return result
}

function classifyCard(
  card: Card,
  seenReveals: ReadonlySet<string>,
  seenConstraints: ReadonlySet<string>,
): CardClassification {
  const reveals = card.reveals ?? []
  const constraints = card.constraints ?? []
  const establishesDomain = reveals.length > 0
  const assertsConstraint = constraints.length > 0

  if (!establishesDomain && !assertsConstraint) return "noise"

  const isRedundant =
    reveals.every((target) => seenReveals.has(target)) &&
    constraints.every((target) => seenConstraints.has(target))

  if (establishesDomain && assertsConstraint) {
    return { establishesDomain, assertsConstraint, isRedundant }
  }
  if (establishesDomain) return isRedundant ? "redundant" : "domain"
  return isRedundant ? "redundant" : "constraint"
}
