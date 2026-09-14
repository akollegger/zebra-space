// Zero-cost regression test for the linkedAttributes entityType/domain-scoping fix (PR #27
// review): confirms a cross-type attribute pairing and a scalar-domain pairing are both
// rejected structurally, and a valid same-type, non-scalar pairing is accepted.
import { generateClueTools } from "./clue-schema.ts"

const vocab = {
  entities: [
    { id: "house_1", type: "house" },
    { id: "house_2", type: "house" },
    { id: "solo_event", type: "event" }, // scalar: only one entity of type "event"
  ],
  domains: [
    { variable: "house-color", entityType: "house", values: ["Red", "Blue"] },
    { variable: "house-animal", entityType: "house", values: ["Cat", "Dog"] },
    { variable: "event-outcome", entityType: "event", values: ["Win", "Loss"] },
  ],
}
const tools = generateClueTools(vocab)

function matches(value: unknown, schema: Record<string, unknown>): boolean {
  if (schema.anyOf !== undefined) return (schema.anyOf as Record<string, unknown>[]).some((alt) => matches(value, alt))
  if (schema.type === "null") return value === null
  if (schema.enum !== undefined) return (schema.enum as unknown[]).includes(value)
  if (schema.type === "array") return Array.isArray(value) && value.every((v) => matches(v, schema.items as Record<string, unknown>)) && value.length >= ((schema.minItems as number) ?? 0)
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

if (tools["linkedAttributes__house"] === undefined) throw new Error("expected a linkedAttributes__house tool (2 qualifying non-scalar house domains)")
if (tools["linkedAttributes__event"] !== undefined) throw new Error("expected NO linkedAttributes__event tool (only 1 domain, and it's scalar)")

const houseTool = tools["linkedAttributes__house"]!

const validSameType = { kind: "linkedAttributes", entityType: "house", attributes: [{ variable: "house-color", value: "Red" }, { variable: "house-animal", value: "Cat" }] }
const crossType = { kind: "linkedAttributes", entityType: "house", attributes: [{ variable: "house-color", value: "Red" }, { variable: "event-outcome", value: "Win" }] }

console.log("valid same-type pairing matches:", matches(validSameType, houseTool))
console.log("cross-type pairing matches:", matches(crossType, houseTool))

if (!matches(validSameType, houseTool)) throw new Error("valid same-type linkedAttributes incorrectly rejected")
if (matches(crossType, houseTool)) throw new Error("REGRESSION: cross-type linkedAttributes still accepted")

console.log("LINKEDATTRIBUTES SCOPING FIX SMOKE TEST PASSED")
