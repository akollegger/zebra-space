// SPIKE-012 §2 step 3: given the numbered inventory (inventory.ts), ask which entries denote the
// same category. Membership is ALWAYS expressed as INDICES into the inventory, never as
// re-typed strings — this is the direct, constructive fix for SPIKE-009's entire identifier-
// collision failure surface (SPIKE-011 SPIKE.md §1 secondary question): a model that only ever
// points at an existing span cannot introduce a casing/punctuation/hyphen-vs-underscore variant
// of it, because it never gets the chance to type it again. Canonical, MiniZinc-safe identifiers
// are assigned entirely by CODE (assignCanonicalIds below), never by the model.

import { requestClueTool } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/tool-call.ts"
import { sanitizeIdentifier } from "../../../../../src/compiler/compile.ts"

const GROUP_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "A short, human-readable category name for this group (e.g. \"house\", \"color\", \"suspect\") — for readability only; never used as the final identifier." },
          member_indices: { type: "array", items: { type: "integer" }, description: "Indices (0-based) into the numbered inventory list of every mention belonging to this category." },
        },
        required: ["label", "member_indices"],
        additionalProperties: false,
      },
    },
  },
  required: ["groups"],
  additionalProperties: false,
} as const

function systemPrompt(inventory: readonly string[]): string {
  const numbered = inventory.map((m, i) => `${i}: ${m}`).join("\n")
  return (
    "You are grouping a numbered list of things mentioned in a puzzle into categories — e.g. " +
    'all the house numbers into one "house" group, all the colors into one "color" group, all ' +
    'the suspects into one "suspect" group. Every group you name must reference its members ' +
    "ONLY by their index number in this list — never by retyping their text:\n\n" +
    `${numbered}\n\n` +
    "Some entries may not belong to any category (stray words, the puzzle's own framing text) " +
    "— it's fine to leave those out of every group. An entry belongs to at most one group."
  )
}

export interface InventoryGroup {
  readonly label: string
  readonly memberIndices: readonly number[]
}

export interface GroupResult {
  readonly groups: readonly InventoryGroup[]
  readonly costUsd: number | undefined
  readonly calls: number
}

/** Validates the model's raw group proposals against the inventory's own bounds — drops any
 * group referencing an out-of-range index, and drops any index from a LATER group once it's
 * already claimed by an earlier one (an inventory item belongs to at most one group; the first
 * group to claim it wins, rather than silently duplicating that item into two categories). */
function validateGroups(raw: readonly { label: string; member_indices: readonly number[] }[], inventorySize: number): readonly InventoryGroup[] {
  const claimed = new Set<number>()
  const groups: InventoryGroup[] = []
  for (const g of raw) {
    const memberIndices = g.member_indices.filter((i) => Number.isInteger(i) && i >= 0 && i < inventorySize && !claimed.has(i))
    for (const i of memberIndices) claimed.add(i)
    if (memberIndices.length > 0) groups.push({ label: g.label, memberIndices })
  }
  return groups
}

export async function extractGroups(model: string, inventory: readonly string[]): Promise<GroupResult> {
  const result = await requestClueTool({
    model,
    systemPrompt: systemPrompt(inventory),
    userPrompt: "Group the numbered list above into categories, referencing members by index only.",
    schemaName: "group_mentions",
    jsonSchema: GROUP_SCHEMA,
  })
  if (!result.ok) return { groups: [], costUsd: result.costUsd, calls: 1 }
  const value = result.value as { groups?: readonly { label: string; member_indices: readonly number[] }[] }
  const groups = validateGroups(value.groups ?? [], inventory.length)
  return { groups, costUsd: result.costUsd, calls: 1 }
}

/**
 * Canonical id assignment — CODE's job, never the model's (SPIKE-011 §5.3's central design
 * principle, restated for this exact seam). One entity id per group member, derived from that
 * member's own inventory text (sanitized); collisions (two members sanitizing to the same
 * identifier, or a member colliding with the group's own type name) are disambiguated by an
 * incrementing suffix, mirroring compile.ts's own `computeEntityTypeEnumNames` disambiguation
 * loop — reused in spirit, not imported, since that function's `taken` set is CSP-shaped
 * (entities + domain variables) and this one needs to run before either exists yet.
 */
export interface CanonicalGroup {
  readonly label: string
  readonly typeId: string
  readonly members: readonly { readonly index: number; readonly text: string; readonly id: string }[]
}

export function assignCanonicalIds(inventory: readonly string[], groups: readonly InventoryGroup[]): readonly CanonicalGroup[] {
  const taken = new Set<string>()
  const canonical: CanonicalGroup[] = []
  for (const g of groups) {
    let typeId = sanitizeIdentifier(g.label)
    for (let suffix = 2; taken.has(typeId); suffix++) typeId = `${sanitizeIdentifier(g.label)}${suffix}`
    taken.add(typeId)
    const members = g.memberIndices.map((index) => {
      const text = inventory[index]!
      let id = sanitizeIdentifier(text)
      for (let suffix = 2; taken.has(id); suffix++) id = `${sanitizeIdentifier(text)}_${suffix}`
      taken.add(id)
      return { index, text, id }
    })
    canonical.push({ label: g.label, typeId, members })
  }
  return canonical
}
