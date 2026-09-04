import { readFileSync } from "node:fs"
import { Effect, Schema } from "effect"
import { parse } from "yaml"
import {
  Deck,
  type DeckError,
  DanglingReference,
  DependencyCycle,
  DuplicateCardId,
  InvalidClosure,
  MalformedDocument,
  UnsupportedConstraintKind,
  UnsupportedTier,
} from "./types.ts"

// The nine `kind` discriminators ADR-006 §2.2 defines — checked against the raw parsed document
// BEFORE the strict `Deck` schema decode, so an unrecognized kind is reported as its own
// `UnsupportedConstraintKind` (naming the offending constraint id) rather than surfacing as an
// undifferentiated schema-decode failure.
const SUPPORTED_CONSTRAINT_KINDS = new Set([
  "assignment",
  "linkedAttributes",
  "allDifferent",
  "adjacency",
  "relation",
  "arithmetic",
  "ruleTable",
  "ruleTableConstraint",
  "derivedRule",
])

const SUPPORTED_TIERS = new Set(["strict"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Detects a deck document by shape (ADR-006 §2.1's top-level keys), not by file extension —
 * `catalog/decks/DECK-NNNN-*.yaml` carries no distinguishing suffix. Used by `extract`
 * (src/cli/subcommands/extract.ts) to route a deck.yaml around LLM translation entirely, since
 * `csp.constraints` already IS an `ExtractedCsp`-shaped structure (ADR-006 §2.2) rather than
 * prose that needs inferring. A parse failure or any other shape falls through to the normal
 * prose path — this is a routing decision, not a validation one; `loadDeck` still does the real
 * validation once a document is routed here.
 */
export function looksLikeDeckDocument(parsed: unknown): boolean {
  return isRecord(parsed) && "csp" in parsed && "cards" in parsed && "closure" in parsed
}

/** Parses `text` as YAML, returning `undefined` (never throwing) on any failure — used only for
 * `extract`'s deck-vs-prose routing sniff, where a parse failure just means "not a deck". */
export function tryParseYaml(text: string): unknown {
  try {
    return parse(text)
  } catch {
    return undefined
  }
}

/** T012's constraint-kind half: checked against the raw parsed value, not the decoded `Deck`,
 * so a bad `kind` is caught before the strict schema decode would otherwise reject the whole
 * document with a generic parse error. */
function findUnsupportedConstraintKind(parsed: unknown): UnsupportedConstraintKind | undefined {
  const csp = isRecord(parsed) ? parsed.csp : undefined
  const constraints = isRecord(csp) ? csp.constraints : undefined
  if (!isRecord(constraints)) return undefined

  for (const [constraintId, value] of Object.entries(constraints)) {
    const kind = isRecord(value) ? value.kind : undefined
    if (typeof kind === "string" && !SUPPORTED_CONSTRAINT_KINDS.has(kind)) {
      return new UnsupportedConstraintKind({ constraintId, kind })
    }
  }
  return undefined
}

/** T012's tier half, and T010/T011's reference/cycle checks — all operate on the already
 * schema-decoded `Deck`, since by this point every field has the right shape to inspect
 * directly. */
function validateCards(deck: Deck): DeckError | undefined {
  const seenCardIds = new Set<string>()
  for (const card of deck.cards) {
    if (seenCardIds.has(card.id)) {
      return new DuplicateCardId({ id: card.id })
    }
    seenCardIds.add(card.id)

    if (!SUPPORTED_TIERS.has(card.tier)) {
      return new UnsupportedTier({ card: card.id, tier: card.tier })
    }
  }

  const cardIds = seenCardIds
  const domainVariables = new Set(deck.csp.domains.map((domain) => domain.variable))
  const constraintKeys = new Set(Object.keys(deck.csp.constraints))

  for (const card of deck.cards) {
    for (const target of card.dependsOn ?? []) {
      if (!cardIds.has(target)) {
        return new DanglingReference({ card: card.id, field: "dependsOn", target })
      }
    }
    for (const target of card.reveals ?? []) {
      if (target !== "entities" && !domainVariables.has(target)) {
        return new DanglingReference({ card: card.id, field: "reveals", target })
      }
    }
    for (const target of card.constraints ?? []) {
      if (!constraintKeys.has(target)) {
        return new DanglingReference({ card: card.id, field: "constraints", target })
      }
    }
  }

  return findDependencyCycle(deck) ?? validateClosure(deck)
}

/** `computeAnswer` (solve.ts) reads the solved assignment's shape (scalar vs. entity-indexed)
 * from the domain that owns `closure.answer.variable`, per compile.ts's own `isScalar` rule —
 * that's only meaningful when the domain actually exists and its `entityType` agrees with
 * `closure.answer.entityType`, so both are checked here rather than trusted at solve time. */
function validateClosure(deck: Deck): InvalidClosure | undefined {
  const { variable, entityType, reveal } = deck.closure.answer

  if (reveal !== "id") {
    return new InvalidClosure({ reason: `closure.answer.reveal "${reveal}" — only "id" is supported` })
  }
  if (!deck.csp.entities.some((entity) => entity.type === entityType)) {
    return new InvalidClosure({
      reason: `closure.answer.entityType "${entityType}" names no entity in csp.entities`,
    })
  }

  const domain = deck.csp.domains.find((d) => d.variable === variable)
  if (domain === undefined) {
    return new InvalidClosure({ reason: `closure.answer.variable "${variable}" names no declared domain` })
  }
  if (domain.entityType !== entityType) {
    return new InvalidClosure({
      reason:
        `closure.answer.entityType "${entityType}" does not match domain "${variable}"'s ` +
        `entityType "${domain.entityType}"`,
    })
  }
  return undefined
}

/** Depth-first cycle detection over the `dependsOn` graph (card -> each card it depends on). */
function findDependencyCycle(deck: Deck): DependencyCycle | undefined {
  const byId = new Map(deck.cards.map((card) => [card.id, card] as const))
  const visiting = new Set<string>()
  const visited = new Set<string>()

  function visit(cardId: string, path: readonly string[]): DependencyCycle | undefined {
    if (visiting.has(cardId)) {
      const cycleStart = path.indexOf(cardId)
      return new DependencyCycle({ cards: path.slice(cycleStart) })
    }
    if (visited.has(cardId)) return undefined

    visiting.add(cardId)
    const card = byId.get(cardId)
    for (const dependency of card?.dependsOn ?? []) {
      const found = visit(dependency, [...path, cardId])
      if (found) return found
    }
    visiting.delete(cardId)
    visited.add(cardId)
    return undefined
  }

  for (const card of deck.cards) {
    const found = visit(card.id, [])
    if (found) return found
  }
  return undefined
}

export function loadDeck(yamlText: string): Effect.Effect<Deck, DeckError> {
  return Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => parse(yamlText),
      catch: (error) => new MalformedDocument({ message: (error as Error).message }),
    })

    const unsupportedKind = findUnsupportedConstraintKind(parsed)
    if (unsupportedKind) return yield* Effect.fail(unsupportedKind)

    const deck = yield* Schema.decodeUnknownEffect(Deck)(parsed).pipe(
      Effect.mapError((error) => new MalformedDocument({ message: error.message })),
    )

    const validationError = validateCards(deck)
    if (validationError) return yield* Effect.fail(validationError)

    return deck
  })
}

export function loadDeckFile(path: string): Effect.Effect<Deck, DeckError> {
  return Effect.gen(function* () {
    const text = yield* Effect.try({
      try: () => readFileSync(path, "utf8"),
      catch: (error) => new MalformedDocument({ message: (error as Error).message }),
    })
    return yield* loadDeck(text)
  })
}
