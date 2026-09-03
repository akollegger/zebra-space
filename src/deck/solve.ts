import { Effect } from "effect"
import type { ExtractedCsp } from "../extraction/types.ts"
import { compile } from "../compiler/compile.ts"
import type { CompileError } from "../compiler/types.ts"
import { solve } from "../solver/solve.ts"
import type { Assignment, SolverError } from "../solver/types.ts"
import { classifyCards } from "./classify.ts"
import type { AnswerError, Deck, SolvedDeck } from "./types.ts"

/** ADR-006 §2.2: flattens `deck.csp.constraints`' map to the array `ExtractedCsp` uses — a
 * structural no-op, never fails, since every value already decoded as an `ExtractedConstraint`
 * (load.ts). `entities`/`domains` pass through unchanged. */
export function deckCsp(deck: Deck): ExtractedCsp {
  return {
    entities: deck.csp.entities,
    domains: deck.csp.domains,
    constraints: Object.values(deck.csp.constraints),
  }
}

/** research.md Finding 4: an enum-typed value comes back wrapped as `{ e: string }`
 * (tests/solver/catalog-examples.test.ts); anything else is compared by its own string form. */
function unwrapValue(value: unknown): string {
  if (value !== null && typeof value === "object" && "e" in value) {
    return String((value as { readonly e: unknown }).e)
  }
  return String(value)
}

/** research.md Finding 4: `compile.ts` declares a domain scalar (not entity-indexed) exactly
 * when its entityType has one entity or fewer — mirrored here so the assignment is read back the
 * same shape the compiler declared it in. */
function computeAnswer(deck: Deck, assignment: Assignment): string | AnswerError {
  const { entityType, variable, equals } = deck.closure.answer
  const entities = deck.csp.entities.filter((entity) => entity.type === entityType)
  const raw = assignment[variable]
  const values = entities.length <= 1 ? [raw] : (raw as readonly unknown[])

  const matches = entities.filter((_entity, index) => unwrapValue(values[index]) === equals)
  if (matches.length === 0) return "NoMatchingEntity"
  if (matches.length > 1) return "AmbiguousMatch"
  return matches[0]!.id
}

/** Compiles and solves a validated `Deck`'s `csp` via the project's existing capability
 * (ADR-002/ADR-005), and — only when it's uniquely solvable — computes the closure's answer
 * (FR-007, FR-008, FR-009). Introduces no deck-specific solving code (FR-006). */
export function solveDeck(deck: Deck): Effect.Effect<SolvedDeck, SolverError | CompileError> {
  return Effect.gen(function* () {
    const model = yield* compile(deckCsp(deck))
    const outcome = yield* solve({ model })
    const classifications = classifyCards(deck)

    if (outcome._tag !== "UniquelySolvable") {
      return { outcome, classifications }
    }

    return { outcome, classifications, answer: computeAnswer(deck, outcome.assignment) }
  })
}
