// A representative subset of src/extraction/types.ts's ExtractedCsp — entities, domains, and
// five non-recursive constraint kinds (assignment, linkedAttributes, allDifferent, adjacency,
// arithmetic-with-!=), skipping the depth-bounded recursive kinds (derivedRule/ruleTable) since
// those test the compiler's edge cases more than they test structured-output decode reliability.
import { Schema } from "effect"

export const Entity = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
})

export const Domain = Schema.Struct({
  variable: Schema.String.annotate({
    description: "The decision-variable name this domain constrains, e.g. house-color.",
  }),
  entityType: Schema.String,
  values: Schema.Array(Schema.String),
})

export const Constraint = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("assignment"),
    entity: Schema.String,
    variable: Schema.String,
    value: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("linkedAttributes"),
    entityType: Schema.String,
    attributes: Schema.Array(Schema.Struct({ variable: Schema.String, value: Schema.String })),
  }),
  Schema.Struct({
    kind: Schema.Literal("allDifferent"),
    variable: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("adjacency"),
    relation: Schema.String,
    a: Schema.String,
    b: Schema.String,
    variable: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("notEqual"),
    variable: Schema.String,
    entity: Schema.String,
    value: Schema.String,
  }).annotate({ description: 'Negation clue, e.g. "the culprit is not Colonel Mustard."' }),
])

export const SpikeExtractedCsp = Schema.Struct({
  entities: Schema.Array(Entity),
  domains: Schema.Array(Domain),
  constraints: Schema.Array(Constraint),
}).annotate({
  description:
    "A solver-agnostic constraint satisfaction problem extracted from a natural-language puzzle.",
})
export type SpikeExtractedCsp = Schema.Schema.Type<typeof SpikeExtractedCsp>
