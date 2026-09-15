// Zero-cost offline proof of group.ts/shape.ts's deterministic vocabulary construction — the
// genuinely novel, riskiest new code in this spike (inventory.ts/per-clue-typed.ts/oracle-
// repair.ts mostly reuse SPIKE-008's already-proven call plumbing). Reproduces two shapes by
// hand (as if inventory+group+shape's LLM calls had already returned these exact answers) and
// confirms the resulting `entities`/`domains` compile and solve via the REAL `compile()`/
// `solve()` — no network, no stub server needed for this part since it's pure deterministic code.
//
// Run: node --env-file-if-exists=.env design/spikes/SPIKE-012-graph-shaped-per-clue-pipeline/scripts/lib/smoke-test-shape.ts

import { Effect } from "effect"
import { compile } from "../../../../../src/compiler/compile.ts"
import { solve } from "../../../../../src/solver/solve.ts"
import { assignCanonicalIds, type InventoryGroup } from "./group.ts"
import { buildVocabulary } from "./shape.ts"

let failures = 0
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok: ${label}`)
  } else {
    failures += 1
    console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

async function testZebraShape() {
  console.log("\n=== PZL-0002-shaped: 3 houses (entity axis) x color/animal (domain values), no ordering ===")
  // As if inventory returned: 0:"1" 1:"2" 2:"3" 3:"Blue" 4:"Red" 5:"Green" 6:"Dog" 7:"Cat" 8:"Zebra"
  const inventory = ["1", "2", "3", "Blue", "Red", "Green", "Dog", "Cat", "Zebra"]
  const groups: readonly InventoryGroup[] = [
    { label: "house", memberIndices: [0, 1, 2] },
    { label: "color", memberIndices: [3, 4, 5] },
    { label: "animal", memberIndices: [6, 7, 8] },
  ]
  const canonical = assignCanonicalIds(inventory, groups)
  check("3 canonical groups", canonical.length === 3)

  const built = buildVocabulary(
    canonical,
    [
      { group_index: 0, role: "entityAxis", entity_axis_group_index: null },
      { group_index: 1, role: "domainValues", entity_axis_group_index: 0 },
      { group_index: 2, role: "domainValues", entity_axis_group_index: 0 },
    ],
    [], // no ordering flagged — this shape's "1"/"2"/"3" labels are just house names, not a stated left-to-right order
  )
  check("3 house entities", built.entities.length === 3, JSON.stringify(built.entities))
  check("2 domains (color, animal), both entityType house", built.domains.every((d) => d.entityType === "house") && built.domains.length === 2, JSON.stringify(built.domains))

  const colorDomain = built.domains.find((d) => d.variable === "color")!
  const animalDomain = built.domains.find((d) => d.variable === "animal")!
  const [h1, h2, h3] = built.entities.map((e) => e.id)

  const csp = {
    entities: built.entities,
    domains: built.domains,
    constraints: [
      { kind: "assignment" as const, entity: h1!, variable: colorDomain.variable, value: "Blue" },
      { kind: "assignment" as const, entity: h2!, variable: colorDomain.variable, value: "Red" },
      { kind: "assignment" as const, entity: h3!, variable: colorDomain.variable, value: "Green" },
      { kind: "assignment" as const, entity: h1!, variable: animalDomain.variable, value: "Dog" },
      { kind: "assignment" as const, entity: h2!, variable: animalDomain.variable, value: "Cat" },
      { kind: "assignment" as const, entity: h3!, variable: animalDomain.variable, value: "Zebra" },
    ],
  }
  const mzn = await Effect.runPromise(compile(csp))
  check("compiles", mzn.length > 0)
  const result = await Effect.runPromise(solve({ model: mzn }))
  check("solves uniquely", result._tag === "UniquelySolvable", result._tag)
}

async function testOrderingSynthesis() {
  console.log("\n=== PZL-0001-shaped: 5 houses with an IMPLIED ordering, no explicit position group ===")
  const inventory = ["1", "2", "3", "4", "5", "Yellow", "Blue", "Red", "Ivory", "Green"]
  const groups: readonly InventoryGroup[] = [
    { label: "house", memberIndices: [0, 1, 2, 3, 4] },
    { label: "color", memberIndices: [5, 6, 7, 8, 9] },
  ]
  const canonical = assignCanonicalIds(inventory, groups)
  const built = buildVocabulary(
    canonical,
    [
      { group_index: 0, role: "entityAxis", entity_axis_group_index: null },
      { group_index: 1, role: "domainValues", entity_axis_group_index: 0 },
    ],
    [0], // flagged: house axis has an implied ordering with no explicit position group
  )
  const positionDomain = built.domains.find((d) => d.variable === "house_position")
  check("synthesized a house_position domain, scoped to the house axis", positionDomain !== undefined, JSON.stringify(built.domains))
  check("position domain has 5 values (1..5)", positionDomain?.values.length === 5, JSON.stringify(positionDomain?.values))
  check("position domain's entityType is house (matches its own axis, not a bare unscoped name)", positionDomain?.entityType === "house")

  // Confirm this compiles with a real adjacency constraint referencing the synthesized domain.
  const colorDomain = built.domains.find((d) => d.variable === "color")!
  const [h1, h2, h3, h4, h5] = built.entities.map((e) => e.id)
  const csp = {
    entities: built.entities,
    domains: built.domains,
    constraints: [
      { kind: "assignment" as const, entity: h1!, variable: positionDomain!.variable, value: "1" },
      { kind: "assignment" as const, entity: h2!, variable: positionDomain!.variable, value: "2" },
      { kind: "assignment" as const, entity: h3!, variable: positionDomain!.variable, value: "3" },
      { kind: "assignment" as const, entity: h4!, variable: positionDomain!.variable, value: "4" },
      { kind: "assignment" as const, entity: h5!, variable: positionDomain!.variable, value: "5" },
      { kind: "adjacency" as const, relation: "directly left of", a: h1!, b: h2!, variable: null },
      { kind: "assignment" as const, entity: h1!, variable: colorDomain.variable, value: "Yellow" },
    ],
  }
  const mzn = await Effect.runPromise(compile(csp))
  check("adjacency over the synthesized position domain compiles", mzn.includes("house_position"))
}

async function testScenarioFallback() {
  console.log("\n=== PZL-0004-shaped (Whodunit): no entity axis at all, 3 scalar domains fall back to one synthesized scenario entity ===")
  const inventory = ["Miss Scarlett", "Colonel Mustard", "Professor Plum", "Candlestick", "Revolver", "Rope", "Kitchen", "Library", "Conservatory"]
  const groups: readonly InventoryGroup[] = [
    { label: "suspect", memberIndices: [0, 1, 2] },
    { label: "weapon", memberIndices: [3, 4, 5] },
    { label: "room", memberIndices: [6, 7, 8] },
  ]
  const canonical = assignCanonicalIds(inventory, groups)
  const built = buildVocabulary(
    canonical,
    [
      { group_index: 0, role: "domainValues", entity_axis_group_index: null },
      { group_index: 1, role: "domainValues", entity_axis_group_index: null },
      { group_index: 2, role: "domainValues", entity_axis_group_index: null },
    ],
    [],
  )
  check("exactly ONE synthesized scenario entity (shared, not one per domain)", built.entities.length === 1, JSON.stringify(built.entities))
  check("3 domains, all entityType scenario", built.domains.length === 3 && built.domains.every((d) => d.entityType === "scenario"))

  const csp = {
    entities: built.entities,
    domains: built.domains,
    constraints: [
      { kind: "arithmetic" as const, expression: { kind: "variableRef" as const, variable: "suspect", entity: null }, comparator: "!=", target: "Colonel_Mustard" },
      { kind: "arithmetic" as const, expression: { kind: "variableRef" as const, variable: "weapon", entity: null }, comparator: "!=", target: "Revolver" },
      { kind: "arithmetic" as const, expression: { kind: "variableRef" as const, variable: "room", entity: null }, comparator: "!=", target: "Kitchen" },
    ],
  }
  const mzn = await Effect.runPromise(compile(csp))
  check("compiles as plain scalar vars (no array/entity-indexing)", !mzn.includes("array["))
  const result = await Effect.runPromise(solve({ model: mzn }))
  check("solves (multiply-satisfiable is fine here — this fixture is deliberately under-constrained)", result._tag === "MultiplySatisfiable" || result._tag === "UniquelySolvable", result._tag)
}

async function main() {
  await testZebraShape()
  await testOrderingSynthesis()
  await testScenarioFallback()
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
