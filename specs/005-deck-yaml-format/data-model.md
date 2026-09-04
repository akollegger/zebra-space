# Data Model: Deck YAML Format Library Support

Field shapes follow ADR-006 §2.1–§2.3 exactly; this document adds validation rules, derived
relationships, and error shapes needed to implement it.

## `Deck`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Free-form, not validated against a naming pattern by this feature (ADR-006 §2.4's `catalog/decks/` naming convention is a documentation/authoring convention, not a runtime check). |
| `title` | `string` | |
| `created` | `string` (ISO date) | Not semantically validated (no future-date or format-strictness check) — a reasonable default given nothing in ADR-006 or the spec calls for one. |
| `brief` | `Brief` | |
| `csp` | `Csp` | |
| `cards` | `readonly Card[]` | Order is significant — it is the deal order (ADR-006 §2.1) and the tie-break for derived redundancy (ADR-006 §2.3). |
| `closure` | `Closure` | |

## `Brief`

| Field | Type |
|---|---|
| `question` | `string` |
| `problem` | `string` |
| `clue` | `string` |
| `instruction` | `string` |

Free text, not validated beyond being present — this feature has no rule to check narrative
content.

## `Csp`

| Field | Type | Notes |
|---|---|---|
| `entities` | `readonly Entity[]` | `{id: string, type: string}`, matching `src/extraction/types.ts`'s `Entity` exactly. |
| `domains` | `readonly Domain[]` | `{variable: string, entityType: string, values: readonly string[]}`, matching `Domain` exactly. |
| `constraints` | `Readonly<Record<string, Constraint>>` | Keyed by a deck-local constraint id (ADR-006 §2.2); each value is one of the nine `Constraint` shapes below. |

**Validation rules** (FR-002, FR-004):
- Every `entities[].id` is unique within the deck.
- Every `domains[].variable` is unique within the deck.
- Every `domains[].entityType` matches at least one `entities[].type` (a domain over an
  entity type nothing declares is a dangling reference in spirit, even though ADR-006 §2.5 lists
  it under card-level references — this feature extends that same resolves-to-something-real
  rule to the `csp` block itself, since a card's `reveals`/`constraints` entries are only
  meaningful if the things they point at are themselves well-formed).
- Every `Constraint`'s `kind` is one of the nine shapes ADR-006 §2.2 lists; anything else is
  rejected (FR-004).

## `Constraint` (discriminated union, `kind`)

Exactly the nine shapes in ADR-006 §2.2, reproduced here as the concrete type this feature
implements — this is a 1:1 mirror of `ExtractedConstraint` (`src/extraction/types.ts`), because
ADR-006 §1 deliberately aligned the deck vocabulary with it:

```ts
type Constraint =
  | { kind: "assignment"; entity: string; variable: string; value: string }
  | { kind: "linkedAttributes"; entityType: string; attributes: readonly { variable: string; value: string }[] }
  | { kind: "allDifferent"; variable: string }
  | { kind: "adjacency"; relation: string; a: string; b: string; variable: string | null }
  | { kind: "relation"; name: string; a: string; b: string }
  | { kind: "arithmetic"; expression: ArithmeticExpression; comparator: string; target: string | number | ArithmeticExpression }
  | { kind: "ruleTable"; name: string; a: string; b: string }
  | { kind: "ruleTableConstraint"; table: string; a: RuleTableOperand; b: RuleTableOperand }
  | { kind: "derivedRule"; appliesTo: string; condition: DerivedCondition; thenConstraints: readonly Constraint[] }
```

`ArithmeticExpression`, `DerivedCondition`, and `RuleTableOperand` are the same shapes
`src/extraction/types.ts` already defines and exports — reused directly rather than redefined, to
guarantee the deck-to-`ExtractedCsp` conversion (below) is a structural no-op.

## `Card`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Unique within the deck. |
| `tier` | `string` | Only `"strict"` accepted in v1 (ADR-006 §4) — any other value is rejected (FR-004). |
| `dependsOn` | `readonly string[]` | Card ids. Defaults to `[]` when absent. |
| `title` | `string` | Shown before the card is opened. |
| `text` | `string` | Shown after the card is opened. |
| `reveals` | `readonly string[]` | Zero or more targets: a `domains[].variable`, or the literal `"entities"`. Defaults to `[]`. |
| `constraints` | `readonly string[]` | Zero or more `csp.constraints` keys. Defaults to `[]`. |

**Validation rules** (FR-002, FR-003):
- Every `dependsOn` entry names another card's `id` that exists in the deck; a card MUST NOT
  depend on itself.
- Every `reveals` entry is either the literal `"entities"` or a `domains[].variable` that exists.
- Every `constraints` entry is a key that exists in `csp.constraints`.
- The graph formed by `dependsOn` edges (card → each card it depends on) is acyclic.
- `tier` is `"strict"`.

## `CardClassification` (derived, not stored)

One of `"noise"`, `"domain"`, `"constraint"`, `"redundant"` (FR-005), computed per card as:

1. If `reveals` and `constraints` are both empty → `"noise"`.
2. Otherwise, for each target the card names (in `reveals` and in `constraints` combined),
   determine whether an earlier card (lower index in `cards`) already names the same target.
3. If every target the card names is being named for the first time → `"domain"` when the card's
   own non-empty list is `reveals` only, `"constraint"` when it's `constraints` only. A card
   naming targets in both lists, at least one of which is first-named, has no single label in
   this scheme (see Assumptions below) — represent it as the pair of labels that apply,
   `{establishesDomain: boolean, assertsConstraint: boolean, isRedundant: boolean}`, rather than
   forcing one of the four single-word labels ADR-006 §2.3 names informally. The four-way label
   is the common case (a card naming exactly one list); the struct is the general case the
   schema actually allows.
4. If every target the card names was already named by an earlier card → `"redundant"`.

**Note carried from ADR-006 §4**: this classification's *scoring* (what a keep/ignore judgment
is worth per classification) is explicitly out of scope for this feature — it belongs to the
game/session layer RFC-005 §5.3 describes, not to this library.

## `Closure`

| Field | Type |
|---|---|
| `question` | `string` |
| `answer.entityType` | `string` — must match at least one `entities[].type`. |
| `answer.variable` | `string` — must be a `domains[].variable` whose `entityType` equals `answer.entityType`. |
| `answer.equals` | `string` |
| `answer.reveal` | `string` — only `"id"` is supported in v1 (ADR-006 §2.1 defines no other value yet). |

## `SolvedDeck` (feature output, not authored)

The result of solving a validated `Deck`'s `csp`:

| Field | Type |
|---|---|
| `outcome` | The project's existing `SolveResult` (`Unsatisfiable` / `UniquelySolvable` / `MultiplySatisfiable`, `src/solver/types.ts`) — reused as-is. |
| `answer` | `string \| AnswerError`, present only when `outcome._tag === "UniquelySolvable"` (FR-008, FR-009). |
| `classifications` | `Readonly<Record<CardId, CardClassification>>` |

`AnswerError` is one of `"NoMatchingEntity"` or `"AmbiguousMatch"` (FR-009) — a closure whose
condition matches zero or more than one entity in an otherwise-uniquely-solved grid is a defect
in the deck's closing question, reported rather than silently defaulting to a guess (Constitution
Principle VI).

## `DeckError` (validation/loading failure)

A tagged union, following `src/solver/types.ts`'s `SolverError` convention:

- `MalformedDocument` — the input isn't parseable data at all (edge case in spec.md).
- `DanglingReference` — `{card: string, field: "dependsOn" | "reveals" | "constraints" | ...; target: string}`.
- `DependencyCycle` — `{cards: readonly string[]}`, naming at least one card in the cycle.
- `UnsupportedTier` — `{card: string, tier: string}`.
- `UnsupportedConstraintKind` — `{constraintId: string, kind: string}`.

## Relationships

```
Deck 1 ── 1 Brief
Deck 1 ── 1 Csp
Deck 1 ── * Card
Deck 1 ── 1 Closure
Csp   1 ── * Entity
Csp   1 ── * Domain
Csp   1 ── * Constraint (keyed)
Card  * ── * Card       (dependsOn)
Card  * ── * Domain     (reveals, by variable name)
Card  * ── * Constraint (constraints, by key)
```

## Assumptions carried from spec.md, made concrete here

- A card naming targets in both `reveals` and `constraints` is permitted by the schema (ADR-006
  §2.3 doesn't forbid it) but has no scoring definition yet (ADR-006 §4's "composite case"
  consequence) — this feature represents its classification structurally (the three-boolean
  struct above) rather than inventing a scoring-relevant single label that ADR-006 never defined.
