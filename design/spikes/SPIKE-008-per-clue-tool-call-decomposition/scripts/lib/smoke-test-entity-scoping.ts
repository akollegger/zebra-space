// Zero-cost regression test for the entity-scoping fix (SPIKE-008 §6 Conclusion / SPIKE.md
// Notes 2026-09-15): reproduces the exact shape of the live PZL-0002 bug — a model referencing
// a DIFFERENT domain's entity id while indexing this domain's variable — and confirms the
// generator now rejects it structurally, where the pre-fix generator's global entity/value
// enums would have accepted it.
import { generateClueTools } from "./clue-schema.ts"

const vocab = {
  entities: [
    { id: "house_1", type: "house" },
    { id: "house_2", type: "house" },
    { id: "animal_cat", type: "animal" },
    { id: "animal_dog", type: "animal" },
  ],
  domains: [
    { variable: "house_color", entityType: "house", values: ["Red", "Blue"] },
    { variable: "house_animal", entityType: "house", values: ["Cat", "Dog"] },
  ],
}
const tools = generateClueTools(vocab)

function checkStructuralExported() {
  // tool-call.ts's checkStructural isn't exported; reuse requestClueTool's own validation by
  // importing it would need a live call, so instead re-derive the same check inline here via a
  // tiny local matcher mirroring tool-call.ts's anyOf/enum logic — good enough to prove the
  // GENERATED SCHEMA itself now excludes the bad case, independent of any network call.
  function matches(value: unknown, schema: Record<string, unknown>): boolean {
    if (schema.anyOf !== undefined) return (schema.anyOf as Record<string, unknown>[]).some((alt) => matches(value, alt))
    if (schema.type === "null") return value === null
    if (schema.enum !== undefined) return (schema.enum as unknown[]).includes(value)
    if (schema.type === "object") {
      if (typeof value !== "object" || value === null) return false
      const obj = value as Record<string, unknown>
      const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
      const required = (schema.required ?? []) as string[]
      for (const key of required) if (!(key in obj)) return false
      for (const [key, propSchema] of Object.entries(props)) {
        if (key in obj && !matches(obj[key], propSchema)) return false
      }
      return true
    }
    return true
  }

  // The exact live bug: assignment on "house_color" (a house-typed domain) naming
  // "animal_cat" — a DIFFERENT domain's entity — as the entity.
  const badAssignment = { kind: "assignment", entity: "animal_cat", variable: "house_color", value: "Red" }
  const goodAssignment = { kind: "assignment", entity: "house_1", variable: "house_color", value: "Red" }

  console.log("bad (cross-domain) assignment matches schema:", matches(badAssignment, tools["assignment__house_color"]))
  console.log("good (same-domain) assignment matches schema:", matches(goodAssignment, tools["assignment__house_color"]))

  if (matches(badAssignment, tools["assignment__house_color"])) throw new Error("REGRESSION: cross-domain entity still accepted")
  if (!matches(goodAssignment, tools["assignment__house_color"])) throw new Error("same-domain entity incorrectly rejected")
}

checkStructuralExported()
console.log("ENTITY-SCOPING FIX SMOKE TEST PASSED")
