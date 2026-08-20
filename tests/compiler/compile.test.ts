import { test } from "node:test"
import assert from "node:assert/strict"
import { Effect } from "effect"
import { compile } from "../../src/compiler/compile.ts"
import type { ExtractedCsp } from "../../src/extraction/types.ts"

function run(csp: ExtractedCsp): Promise<string> {
  return Effect.runPromise(compile(csp))
}

function runFails(csp: ExtractedCsp): Promise<string> {
  return Effect.runPromise(Effect.flip(compile(csp))).then((error) => error.reason)
}

test("ADR-005 §2.2/§2.3: assignment on a scalar (single-entity) domain compiles to a plain var equality", async () => {
  const csp: ExtractedCsp = {
    entities: [{ id: "Murder", type: "Event" }],
    domains: [{ variable: "culprit", entityType: "Event", values: ["Scarlett", "Mustard", "Plum"] }],
    constraints: [{ kind: "assignment", entity: "Murder", variable: "culprit", value: "Plum" }],
  }
  const mzn = await run(csp)
  assert.match(mzn, /var Values_Scarlett_Mustard_Plum: culprit;/)
  assert.match(mzn, /constraint culprit = Plum;/)
})

test('an entity id matching its own entityType name (e.g. entity "player" of type "player") disambiguates the enum, never emits a self-colliding `enum player = {player, ...};`', async () => {
  // Exactly the shape a live eval run produced (PZL-0003): two entities of type "player", one of
  // them also named "player" — `enum player = {player, opponent};` is rejected by `minizinc` as
  // "identifier `player' already defined" (the enum type and one of its own members).
  const csp: ExtractedCsp = {
    entities: [
      { id: "player", type: "player" },
      { id: "opponent", type: "player" },
    ],
    domains: [{ variable: "move", entityType: "player", values: ["Paper", "Rock", "Scissors"] }],
    constraints: [{ kind: "assignment", entity: "opponent", variable: "move", value: "Rock" }],
  }
  const mzn = await run(csp)
  assert.doesNotMatch(mzn, /enum player = /)
  assert.match(mzn, /enum player_Type = \{player, opponent\};/)
  assert.match(mzn, /array\[player_Type\] of var Values_Paper_Rock_Scissors: move;/)
  assert.match(mzn, /constraint move\[opponent\] = Rock;/)
})

test('a variable named identically to its own entityType (e.g. variable/entityType both "position") disambiguates the enum, never emits self-colliding `array[position] of var ...: position;`', async () => {
  const csp: ExtractedCsp = {
    entities: [
      { id: "A", type: "position" },
      { id: "B", type: "position" },
    ],
    domains: [{ variable: "position", entityType: "position", values: ["1", "2"] }],
    constraints: [{ kind: "assignment", entity: "A", variable: "position", value: "1" }],
  }
  const mzn = await run(csp)
  assert.doesNotMatch(mzn, /enum position = /)
  assert.match(mzn, /enum position_Type = \{A, B\};/)
  assert.match(mzn, /array\[position_Type\] of var 1\.\.2: position;/)
})

test("two domains sharing an entityType still resolve to the SAME (disambiguated) enum name, even if only one domain's variable collides", async () => {
  // "color" doesn't collide with entityType "house", but "house" (the second domain's own
  // variable) does — both domains share entityType "house", so both must end up pointing at the
  // SAME enum name, or the entity ids would be declared as members of two different enums (a
  // fresh collision of its own).
  const csp: ExtractedCsp = {
    entities: [
      { id: "H1", type: "house" },
      { id: "H2", type: "house" },
    ],
    domains: [
      { variable: "color", entityType: "house", values: ["Red", "Blue"] },
      { variable: "house", entityType: "house", values: ["Yes", "No"] },
    ],
    constraints: [{ kind: "assignment", entity: "H1", variable: "color", value: "Red" }],
  }
  const mzn = await run(csp)
  const enumDeclarations = mzn.match(/enum house\w* = /g) ?? []
  assert.equal(new Set(enumDeclarations).size, 1, `expected one consistent entity enum, got: ${enumDeclarations}`)
  assert.match(mzn, /array\[house_Type\] of var Values_Red_Blue: color;/)
  assert.match(mzn, /array\[house_Type\] of var Values_Yes_No: house;/)
})

test("ADR-005 §2.3: allDifferent renders all_different (with include \"globals.mzn\";), not the invalid bare `alldifferent`", async () => {
  const csp: ExtractedCsp = {
    entities: [
      { id: "H1", type: "House" },
      { id: "H2", type: "House" },
    ],
    domains: [{ variable: "color", entityType: "House", values: ["Red", "Blue"] }],
    constraints: [{ kind: "allDifferent", variable: "color" }],
  }
  const mzn = await run(csp)
  assert.match(mzn, /include "globals\.mzn";/)
  assert.match(mzn, /constraint all_different\(color\);/)
  assert.doesNotMatch(mzn, /\ball_different_dummy\b/)
})

test("ADR-005 §2.3: allDifferent on a scalar (single-entity) domain is a CompileError", async () => {
  const csp: ExtractedCsp = {
    entities: [{ id: "Only", type: "Thing" }],
    domains: [{ variable: "x", entityType: "Thing", values: ["A", "B"] }],
    constraints: [{ kind: "allDifferent", variable: "x" }],
  }
  const reason = await runFails(csp)
  assert.match(reason, /allDifferent requires an entity-indexed variable/)
})

test('sanitizeIdentifier: a digit-leading value (e.g. "9am") gets a LETTER prefix, never an invalid leading-underscore-digit like "_9am"', async () => {
  // Verified against a real `minizinc` install: a bare leading underscore parses fine ("_a" is
  // valid), but an underscore immediately followed by a digit is a syntax error ("unexpected _").
  const csp: ExtractedCsp = {
    entities: [{ id: "Only", type: "Slot" }],
    domains: [{ variable: "time", entityType: "Slot", values: ["9am", "10am", "11am"] }],
    constraints: [{ kind: "assignment", entity: "Only", variable: "time", value: "9am" }],
  }
  const mzn = await run(csp)
  assert.doesNotMatch(mzn, /_9am|_10am|_11am/)
  assert.match(mzn, /enum Values_v9am_v10am_v11am = \{v9am, v10am, v11am\};/)
  assert.match(mzn, /constraint time = v9am;/)
})

test("ADR-005 §2.3: adjacency compiles via the relation-name registry over a shared numeric domain", async () => {
  const csp: ExtractedCsp = {
    entities: [
      { id: "H1", type: "House" },
      { id: "H2", type: "House" },
      { id: "H3", type: "House" },
    ],
    domains: [{ variable: "position", entityType: "House", values: ["1", "2", "3"] }],
    constraints: [
      { kind: "allDifferent", variable: "position" },
      { kind: "assignment", entity: "H1", variable: "position", value: "1" },
      { kind: "adjacency", relation: "immediately right of", a: "H2", b: "H1" },
    ],
  }
  const mzn = await run(csp)
  assert.match(mzn, /array\[House\] of var 1\.\.3: position;/)
  assert.match(mzn, /constraint position\[H2\] = position\[H1\] \+ 1;/)
})

test('ADR-005 §2.3: adjacency works over an ordered-but-non-integer domain (e.g. time slots) via enum2int, when it is the ONLY domain shared', async () => {
  // Exactly the shape a live eval run produced (PZL-0009): "immediately before" over a
  // "9am"/"10am"/"11am" time-slot domain — ordered by declaration, not literal integers.
  const csp: ExtractedCsp = {
    entities: [
      { id: "Chen", type: "candidate" },
      { id: "Deepak", type: "candidate" },
      { id: "Aisha", type: "candidate" },
    ],
    domains: [{ variable: "time_slot", entityType: "candidate", values: ["9am", "10am", "11am"] }],
    constraints: [{ kind: "adjacency", relation: "immediately_before", a: "Chen", b: "Deepak" }],
  }
  const mzn = await run(csp)
  assert.match(mzn, /constraint enum2int\(time_slot\[Chen\]\) = enum2int\(time_slot\[Deepak\]\) - 1;/)
})

test("ADR-005 §2.3: adjacency over multiple shared (non-numeric) domains still fails as ambiguous, not a silent guess", async () => {
  // With more than one domain shared by both entities, numeric-ness is the only positional
  // signal available (no explicit "ordered" flag on Domain) — so this must still fail, not
  // silently pick one of two categorical domains (e.g. color vs. drink).
  const csp: ExtractedCsp = {
    entities: [
      { id: "H1", type: "House" },
      { id: "H2", type: "House" },
    ],
    domains: [
      { variable: "color", entityType: "House", values: ["Red", "Blue"] },
      { variable: "drink", entityType: "House", values: ["Tea", "Coffee"] },
    ],
    constraints: [{ kind: "adjacency", relation: "next to", a: "H1", b: "H2" }],
  }
  const reason = await runFails(csp)
  assert.match(reason, /Could not find a single positional domain/)
})

test("ADR-005 §2.3: an unrecognized adjacency relation name is a CompileError, never a silent guess", async () => {
  const csp: ExtractedCsp = {
    entities: [
      { id: "H1", type: "House" },
      { id: "H2", type: "House" },
    ],
    domains: [{ variable: "position", entityType: "House", values: ["1", "2"] }],
    constraints: [{ kind: "adjacency", relation: "somewhere near", a: "H1", b: "H2" }],
  }
  const reason = await runFails(csp)
  assert.match(reason, /Unrecognized adjacency relation/)
})

test("ADR-005 §2.4 mode 1 (fact-driven): relation facts expand derivedRule.then per matching pair", async () => {
  const csp: ExtractedCsp = {
    entities: [
      { id: "France", type: "Country" },
      { id: "Spain", type: "Country" },
      { id: "Germany", type: "Country" },
    ],
    domains: [{ variable: "color", entityType: "Country", values: ["Red", "Green", "Blue"] }],
    constraints: [
      { kind: "relation", name: "sharesBorder", a: "France", b: "Spain" },
      { kind: "relation", name: "sharesBorder", a: "France", b: "Germany" },
      {
        kind: "derivedRule",
        appliesTo: "color",
        condition: { kind: "relation", name: "sharesBorder" },
        thenConstraints: [
          {
            kind: "arithmetic",
            expression: { kind: "variableRef", variable: "color", entity: "$a" },
            comparator: "!=",
            target: { kind: "variableRef", variable: "color", entity: "$b" },
          },
        ],
      },
    ],
  }
  const mzn = await run(csp)
  assert.match(mzn, /constraint color\[France\] != color\[Spain\];/)
  assert.match(mzn, /constraint color\[France\] != color\[Germany\];/)
  // The relation fact itself produces no direct constraint output.
  assert.doesNotMatch(mzn, /constraint sharesBorder/)
})

test('a leaked, unresolved entity placeholder (e.g. "$outer" misused in a mode-1 fact-driven rule) is a loud CompileError, never a silently-sanitized identifier', async () => {
  // A live eval run produced this exact confusion (PZL-0005): the model applied mode 2's
  // "$this"/"$outer" convention inside a mode-1 (fact-driven, condition.kind "relation") rule,
  // where only "$a"/"$b" resolve. Before this fix, this compiled to the invalid MiniZinc
  // identifier `_outer` and only failed later, cryptically, at the `minizinc` CLI.
  const csp: ExtractedCsp = {
    entities: [
      { id: "France", type: "Country" },
      { id: "Spain", type: "Country" },
    ],
    domains: [{ variable: "color", entityType: "Country", values: ["Red", "Green"] }],
    constraints: [
      { kind: "relation", name: "sharesBorder", a: "France", b: "Spain" },
      {
        kind: "derivedRule",
        appliesTo: "color",
        condition: { kind: "relation", name: "sharesBorder" },
        thenConstraints: [
          {
            kind: "arithmetic",
            expression: { kind: "variableRef", variable: "color", entity: "$a" },
            comparator: "!=",
            target: { kind: "variableRef", variable: "color", entity: "$outer" },
          },
        ],
      },
    ],
  }
  const reason = await runFails(csp)
  assert.match(reason, /Entity placeholder "\$outer".*never substituted/)
  assert.doesNotMatch(reason, /_outer/)
})

test('ADR-004 §2.2/eval gap: ruleTable + ruleTableConstraint model a static, entity-independent rule (rock-paper-scissors)', async () => {
  const csp: ExtractedCsp = {
    entities: [{ id: "You", type: "Player" }],
    domains: [{ variable: "move", entityType: "Player", values: ["Paper", "Rock", "Scissors"] }],
    constraints: [
      { kind: "ruleTable", name: "beats", a: "Paper", b: "Rock" },
      { kind: "ruleTable", name: "beats", a: "Rock", b: "Scissors" },
      { kind: "ruleTable", name: "beats", a: "Scissors", b: "Paper" },
      {
        kind: "ruleTableConstraint",
        table: "beats",
        a: { kind: "variableRef", variable: "move", entity: null },
        b: { kind: "literal", value: "Rock" },
      },
    ],
  }
  const mzn = await run(csp)
  assert.ok(
    mzn.includes(
      "constraint (move = Paper /\\ Rock = Rock) \\/ (move = Rock /\\ Rock = Scissors) \\/ (move = Scissors /\\ Rock = Paper);",
    ),
  )
  // The rule table's own facts produce no direct constraint output.
  assert.doesNotMatch(mzn, /constraint beats/)
})

test("ADR-004 §2.2/eval gap: ruleTableConstraint referencing an undeclared table is a CompileError", async () => {
  const csp: ExtractedCsp = {
    entities: [{ id: "You", type: "Player" }],
    domains: [{ variable: "move", entityType: "Player", values: ["Paper", "Rock", "Scissors"] }],
    constraints: [
      {
        kind: "ruleTableConstraint",
        table: "beats",
        a: { kind: "variableRef", variable: "move", entity: null },
        b: { kind: "literal", value: "Rock" },
      },
    ],
  }
  const reason = await runFails(csp)
  assert.match(reason, /Unknown rule table "beats"/)
})

test('ADR-004 §2.2/eval gap: ruleTable values not belonging to any declared Domain (e.g. a boolean "Yes"/"No" fact) get their own synthetic enum', async () => {
  // Exactly the shape a live eval run produced (PZL-0013, Picking a Restaurant): a ruleTable
  // attaching a boolean fact to existing domain values ("Wheat & Co is vegan-friendly: Yes") —
  // "Wheat & Co" is the restaurant domain's own value, but "Yes" is never declared anywhere,
  // and multiple ruleTables reuse it. Before this fix, "Yes" compiled to an undeclared MiniZinc
  // identifier.
  const csp: ExtractedCsp = {
    entities: [{ id: "Group", type: "group" }],
    domains: [
      { variable: "restaurant", entityType: "group", values: ["Thai Palace", "Wheat & Co", "Garden Table"] },
    ],
    constraints: [
      { kind: "ruleTable", name: "vegan_friendly", a: "Wheat & Co", b: "Yes" },
      { kind: "ruleTable", name: "vegan_friendly", a: "Garden Table", b: "Yes" },
      { kind: "ruleTable", name: "gluten_free", a: "Thai Palace", b: "Yes" },
      {
        kind: "ruleTableConstraint",
        table: "vegan_friendly",
        a: { kind: "variableRef", variable: "restaurant", entity: "Group" },
        b: { kind: "literal", value: "Yes" },
      },
    ],
  }
  const mzn = await run(csp)
  assert.match(mzn, /enum RuleTableValues_Yes = \{Yes\};/)
  // Only ONE enum declares "Yes", shared across both ruleTables that use it — not redeclared.
  assert.equal((mzn.match(/enum RuleTableValues_Yes/g) ?? []).length, 1)
  assert.match(
    mzn,
    /constraint \(restaurant = Wheat___Co \/\\ Yes = Yes\) \\\/ \(restaurant = Garden_Table \/\\ Yes = Yes\);/,
  )
})

test("ADR-005 §2.4 mode 2 (variable-conditioned): a comparison condition compiles to a reified implication", async () => {
  const csp: ExtractedCsp = {
    entities: [{ id: "App1", type: "Application" }],
    domains: [
      { variable: "score", entityType: "Application", values: ["0", "1000"] },
      { variable: "outcome", entityType: "Application", values: ["Denied", "Approved"] },
    ],
    constraints: [
      { kind: "assignment", entity: "App1", variable: "score", value: "450" },
      {
        kind: "derivedRule",
        appliesTo: "outcome",
        condition: { kind: "comparison", variable: "score", operator: "<", value: 600 },
        thenConstraints: [{ kind: "assignment", entity: "App1", variable: "outcome", value: "Denied" }],
      },
    ],
  }
  const mzn = await run(csp)
  assert.match(mzn, /constraint \(score < 600\) -> \(outcome = Denied\);/)
})

test('ADR-005 §2.4 mode 2, expressionComparison: a computed quantity (e.g. a debt-to-income ratio) can gate a derivedRule condition', async () => {
  // Mirrors PZL-0011 (Loan Review): "if their debt-to-income ratio exceeds 43%, Denied" needs a
  // COMPUTED expression (debt / income) as the condition, not a single declared variable —
  // `comparison`'s condition can only test a plain declared variable directly.
  const csp: ExtractedCsp = {
    entities: [{ id: "App1", type: "Application" }],
    domains: [
      { variable: "debt", entityType: "Application", values: ["0", "10000"] },
      { variable: "income", entityType: "Application", values: ["0", "20000"] },
      { variable: "outcome", entityType: "Application", values: ["Denied", "Approved"] },
    ],
    constraints: [
      { kind: "assignment", entity: "App1", variable: "debt", value: "3200" },
      { kind: "assignment", entity: "App1", variable: "income", value: "9000" },
      {
        kind: "derivedRule",
        appliesTo: "outcome",
        condition: {
          kind: "expressionComparison",
          expression: {
            kind: "binaryOp",
            op: "/",
            operands: [
              { kind: "variableRef", variable: "debt", entity: null },
              { kind: "variableRef", variable: "income", entity: null },
            ],
          },
          operator: ">",
          value: 0.43,
        },
        thenConstraints: [{ kind: "assignment", entity: "App1", variable: "outcome", value: "Denied" }],
      },
    ],
  }
  const mzn = await run(csp)
  assert.match(mzn, /constraint \(\(debt \/ income\) > 0\.43\) -> \(outcome = Denied\);/)
})

test('ADR-005 §2.4 mode 2, entity-indexed condition: "$this" reifies per entity (self-referential zebra clue)', async () => {
  const csp: ExtractedCsp = {
    entities: [
      { id: "H1", type: "House" },
      { id: "H2", type: "House" },
      { id: "H3", type: "House" },
    ],
    domains: [
      { variable: "color", entityType: "House", values: ["red", "green", "ivory"] },
      { variable: "position", entityType: "House", values: ["1", "2", "3"] },
    ],
    constraints: [
      {
        kind: "derivedRule",
        appliesTo: "House",
        condition: { kind: "comparison", variable: "color", operator: "==", value: "green" },
        thenConstraints: [
          {
            kind: "arithmetic",
            expression: { kind: "variableRef", variable: "position", entity: "$this" },
            comparator: "=",
            target: {
              kind: "binaryOp",
              op: "+",
              operands: [
                { kind: "variableRef", variable: "position", entity: "H1" },
                { kind: "literal", value: 1 },
              ],
            },
          },
        ],
      },
    ],
  }
  const mzn = await run(csp)
  assert.match(mzn, /constraint \(color\[H1\] == green\) -> \(position\[H1\] = \(position\[H1\] \+ 1\)\);/)
  assert.match(mzn, /constraint \(color\[H2\] == green\) -> \(position\[H2\] = \(position\[H1\] \+ 1\)\);/)
  assert.match(mzn, /constraint \(color\[H3\] == green\) -> \(position\[H3\] = \(position\[H1\] \+ 1\)\);/)
  assert.doesNotMatch(mzn, /\$this/)
})

test('ADR-004 §2.2/eval gap: a nested derivedRule chains two anonymous entities via "$outer"/"$this" and forall', async () => {
  // "Whoever smokes Chesterfields lives next to whoever owns the fox" — neither house is ever
  // named, each is only identified by its own attribute (the classic zebra-puzzle shape this
  // gap blocked, per ADR-004 §2.2/eval/README.md's "relational chaining" limitation).
  const csp: ExtractedCsp = {
    entities: [
      { id: "H1", type: "House" },
      { id: "H2", type: "House" },
      { id: "H3", type: "House" },
    ],
    domains: [
      { variable: "cigarette", entityType: "House", values: ["Chesterfields", "Kools", "OldGold"] },
      { variable: "pet", entityType: "House", values: ["fox", "horse", "dog"] },
      { variable: "position", entityType: "House", values: ["1", "2", "3"] },
    ],
    constraints: [
      {
        kind: "derivedRule",
        appliesTo: "House",
        condition: { kind: "comparison", variable: "cigarette", operator: "==", value: "Chesterfields" },
        thenConstraints: [
          {
            kind: "derivedRule",
            appliesTo: "House",
            condition: { kind: "comparison", variable: "pet", operator: "==", value: "fox" },
            thenConstraints: [
              {
                kind: "arithmetic",
                expression: {
                  kind: "binaryOp",
                  op: "abs",
                  operands: [
                    {
                      kind: "binaryOp",
                      op: "-",
                      operands: [
                        { kind: "variableRef", variable: "position", entity: "$outer" },
                        { kind: "variableRef", variable: "position", entity: "$this" },
                      ],
                    },
                  ],
                },
                comparator: "=",
                target: 1,
              },
            ],
          },
        ],
      },
    ],
  }
  const mzn = await run(csp)
  assert.match(
    mzn,
    /constraint \(cigarette\[H1\] == Chesterfields\) -> \(forall\(House_e in House\)\(\(pet\[House_e\] == fox\) -> \(abs\(\(position\[H1\] - position\[House_e\]\)\) = 1\)\)\);/,
  )
  assert.match(mzn, /cigarette\[H2\]/)
  assert.match(mzn, /cigarette\[H3\]/)
  assert.doesNotMatch(mzn, /\$this/)
  assert.doesNotMatch(mzn, /\$outer/)
})

test("ADR-005 §2.5: arithmetic expressions render structured binary operations, not interpolated strings", async () => {
  const csp: ExtractedCsp = {
    entities: [
      { id: "H1", type: "House" },
      { id: "H2", type: "House" },
    ],
    domains: [{ variable: "position", entityType: "House", values: ["1", "2"] }],
    constraints: [
      {
        kind: "arithmetic",
        expression: {
          kind: "binaryOp",
          op: "abs",
          operands: [
            {
              kind: "binaryOp",
              op: "-",
              operands: [
                { kind: "variableRef", variable: "position", entity: null },
                { kind: "literal", value: 1 },
              ],
            },
          ],
        },
        comparator: "=",
        target: 0,
      },
    ],
  }
  const reason = await runFails(csp)
  // `position` is entity-indexed with no entity given at the top level — a deliberate
  // CompileError (arithmetic on a non-scalar domain must say which entity), exercising the
  // structured-expression renderer's recursive abs(binaryOp(...)) path along the way.
  assert.match(reason, /entity-indexed but no entity was given/)
})

test("ADR-005 §2.1: output is one self-contained model ending in `solve satisfy;`", async () => {
  const csp: ExtractedCsp = {
    entities: [{ id: "Murder", type: "Event" }],
    domains: [{ variable: "culprit", entityType: "Event", values: ["Scarlett", "Plum"] }],
    constraints: [],
  }
  const mzn = await run(csp)
  assert.match(mzn.trim(), /solve satisfy;$/)
})

test("ADR-004 §2.2: linkedAttributes binds an unnamed entity via an existential forall/iff", async () => {
  const csp: ExtractedCsp = {
    entities: [
      { id: "H1", type: "House" },
      { id: "H2", type: "House" },
      { id: "H3", type: "House" },
    ],
    domains: [
      { variable: "nationality", entityType: "House", values: ["A", "B", "C"] },
      { variable: "color", entityType: "House", values: ["Red", "Green", "Blue"] },
    ],
    constraints: [
      { kind: "allDifferent", variable: "nationality" },
      { kind: "allDifferent", variable: "color" },
      {
        kind: "linkedAttributes",
        entityType: "House",
        attributes: [
          { variable: "nationality", value: "A" },
          { variable: "color", value: "Red" },
        ],
      },
    ],
  }
  const mzn = await run(csp)
  assert.match(mzn, /constraint forall\(e in House\)\(nationality\[e\] = A <-> color\[e\] = Red\);/)
})

test("ADR-004 §2.2: linkedAttributes with 3+ attributes links the first to a conjunction of the rest", async () => {
  const csp: ExtractedCsp = {
    entities: [
      { id: "H1", type: "House" },
      { id: "H2", type: "House" },
    ],
    domains: [
      { variable: "nationality", entityType: "House", values: ["A"] },
      { variable: "color", entityType: "House", values: ["Red"] },
      { variable: "drink", entityType: "House", values: ["Tea"] },
    ],
    constraints: [
      {
        kind: "linkedAttributes",
        entityType: "House",
        attributes: [
          { variable: "nationality", value: "A" },
          { variable: "color", value: "Red" },
          { variable: "drink", value: "Tea" },
        ],
      },
    ],
  }
  const mzn = await run(csp)
  assert.match(mzn, /nationality\[e\] = A <-> \(color\[e\] = Red \/\\ drink\[e\] = Tea\)/)
})

test("ADR-004 §2.2: linkedAttributes needs at least 2 attributes", async () => {
  const csp: ExtractedCsp = {
    entities: [{ id: "H1", type: "House" }],
    domains: [{ variable: "color", entityType: "House", values: ["Red"] }],
    constraints: [
      { kind: "linkedAttributes", entityType: "House", attributes: [{ variable: "color", value: "Red" }] },
    ],
  }
  const reason = await runFails(csp)
  assert.match(reason, /needs at least 2 attributes/)
})

test("ADR-004 §2.2: linkedAttributes rejects a variable from a mismatched entityType", async () => {
  const csp: ExtractedCsp = {
    entities: [
      { id: "H1", type: "House" },
      { id: "H2", type: "House" },
      { id: "W1", type: "Weapon" },
    ],
    domains: [
      { variable: "color", entityType: "House", values: ["Red"] },
      { variable: "material", entityType: "Weapon", values: ["Metal"] },
    ],
    constraints: [
      {
        kind: "linkedAttributes",
        entityType: "House",
        attributes: [
          { variable: "color", value: "Red" },
          { variable: "material", value: "Metal" },
        ],
      },
    ],
  }
  const reason = await runFails(csp)
  assert.match(reason, /doesn't match variable "material"/)
})

test("ADR-004 §2.2: linkedAttributes rejects a scalar (single-entity) domain", async () => {
  const csp: ExtractedCsp = {
    entities: [{ id: "Murder", type: "Event" }],
    domains: [
      { variable: "culprit", entityType: "Event", values: ["Plum"] },
      { variable: "weapon", entityType: "Event", values: ["Rope"] },
    ],
    constraints: [
      {
        kind: "linkedAttributes",
        entityType: "Event",
        attributes: [
          { variable: "culprit", value: "Plum" },
          { variable: "weapon", value: "Rope" },
        ],
      },
    ],
  }
  const reason = await runFails(csp)
  assert.match(reason, /requires entity-indexed variables/)
})
