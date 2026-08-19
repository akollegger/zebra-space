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
  assert.match(mzn, /var culpritValues: culprit;/)
  assert.match(mzn, /constraint culprit = Plum;/)
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
            expression: { kind: "variableRef", variable: "color" },
            comparator: "!=",
            target: "$b",
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
                { kind: "variableRef", variable: "position" },
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
