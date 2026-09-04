import { Data, Schema } from "effect"
import { Domain, Entity, ExtractedConstraint } from "../extraction/types.ts"

// ADR-006 §2.1/§2.2/§2.3, specs/005-deck-yaml-format/data-model.md.

export const Brief = Schema.Struct({
  question: Schema.String,
  problem: Schema.String,
  clue: Schema.String,
  instruction: Schema.String,
})
export type Brief = Schema.Schema.Type<typeof Brief>

// ADR-006 §2.2: the deck's constraint vocabulary is deliberately the same one
// `ExtractedConstraint` already defines, so `csp.constraints`' values are decoded with it
// directly rather than a redefined, structurally-identical union.
export const Csp = Schema.Struct({
  entities: Schema.Array(Entity),
  domains: Schema.Array(Domain),
  constraints: Schema.Record(Schema.String, ExtractedConstraint),
})
export type Csp = Schema.Schema.Type<typeof Csp>

// ADR-006 §2.1: only "strict" is accepted in v1 — decoded as a plain string here (not
// `Schema.Literal("strict")`) so an unsupported value reaches load.ts's own check (T012) as a
// named `UnsupportedTier`, rather than a generic schema-decode failure that can't distinguish
// "wrong tier" from "malformed document" (data-model.md's `DeckError` union keeps those apart).
export const Card = Schema.Struct({
  id: Schema.String,
  tier: Schema.String,
  dependsOn: Schema.optional(Schema.Array(Schema.String)),
  title: Schema.String,
  text: Schema.String,
  reveals: Schema.optional(Schema.Array(Schema.String)),
  constraints: Schema.optional(Schema.Array(Schema.String)),
})
export type Card = Schema.Schema.Type<typeof Card>

export const ClosureAnswer = Schema.Struct({
  entityType: Schema.String,
  variable: Schema.String,
  equals: Schema.String,
  reveal: Schema.String,
})
export type ClosureAnswer = Schema.Schema.Type<typeof ClosureAnswer>

export const Closure = Schema.Struct({
  question: Schema.String,
  answer: ClosureAnswer,
})
export type Closure = Schema.Schema.Type<typeof Closure>

export const Deck = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  created: Schema.String,
  brief: Brief,
  csp: Csp,
  cards: Schema.Array(Card),
  closure: Closure,
})
export type Deck = Schema.Schema.Type<typeof Deck>

// data-model.md's `CardClassification`: the common case is one of the four labels; a card
// naming targets in both `reveals` and `constraints` (permitted by the schema, unscored by
// ADR-006 §4) has no single label, so it's represented structurally instead.
export type CardClassification =
  | "noise"
  | "domain"
  | "constraint"
  | "redundant"
  | { readonly establishesDomain: boolean; readonly assertsConstraint: boolean; readonly isRedundant: boolean }

export type AnswerError = "NoMatchingEntity" | "AmbiguousMatch"

export interface SolvedDeck {
  readonly outcome: import("../solver/types.ts").SolveResult
  readonly answer?: string | AnswerError
  readonly classifications: Readonly<Record<string, CardClassification>>
}

export class MalformedDocument extends Data.TaggedError("MalformedDocument")<{
  readonly message: string
}> {}

export class DanglingReference extends Data.TaggedError("DanglingReference")<{
  readonly card: string
  readonly field: "dependsOn" | "reveals" | "constraints"
  readonly target: string
}> {}

// Two cards sharing an id would silently collide in classifyCards' result map (one card's
// classification overwriting the other's) and make dependsOn/reveals/constraints references
// ambiguous about which card they actually name — caught before any of that can happen.
export class DuplicateCardId extends Data.TaggedError("DuplicateCardId")<{
  readonly id: string
}> {}

export class DependencyCycle extends Data.TaggedError("DependencyCycle")<{
  readonly cards: readonly string[]
}> {}

export class UnsupportedTier extends Data.TaggedError("UnsupportedTier")<{
  readonly card: string
  readonly tier: string
}> {}

export class UnsupportedConstraintKind extends Data.TaggedError("UnsupportedConstraintKind")<{
  readonly constraintId: string
  readonly kind: string
}> {}

// `closure.answer.variable` must name a declared domain, and that domain's `entityType` must
// match `closure.answer.entityType` — otherwise `computeAnswer` (solve.ts) has no principled way
// to know whether the solved assignment for `variable` is scalar or entity-indexed (that shape
// is keyed on the *domain's* entityType, per compile.ts's `isScalar`, not on whatever entityType
// the closure happens to name).
export class InvalidClosure extends Data.TaggedError("InvalidClosure")<{
  readonly reason: string
}> {}

export type DeckError =
  | MalformedDocument
  | DanglingReference
  | DuplicateCardId
  | DependencyCycle
  | UnsupportedTier
  | UnsupportedConstraintKind
  | InvalidClosure
