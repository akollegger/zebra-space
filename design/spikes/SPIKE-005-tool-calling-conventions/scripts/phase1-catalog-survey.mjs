#!/usr/bin/env node
// SPIKE-005 Phase 1: what do models *declare* they support?
//
// Queries OpenRouter's public models catalog and tabulates `supported_parameters`. Deliberately
// uses raw fetch rather than @openrouter/sdk: this spike is about provider/wire conventions, so
// the SDK's own translation layer would be a confound. No node_modules needed.
//
// Declared support is NOT evidence of working support — SPIKE.md's baseline observation 2 is
// exactly a declared-vs-actual mismatch. Phase 1 only narrows what Phase 2 verifies empirically.

const CATALOG_URL = "https://openrouter.ai/api/v1/models"

const PARAMS_OF_INTEREST = ["tools", "tool_choice", "response_format", "structured_outputs"]

function priceTier(model) {
  const prompt = Number.parseFloat(model.pricing?.prompt ?? "0")
  if (!Number.isFinite(prompt)) return "unknown"
  if (prompt === 0) return "free"
  const perMillion = prompt * 1_000_000
  if (perMillion < 0.5) return "cheap (<$0.50/M)"
  if (perMillion < 3) return "mid ($0.50-3/M)"
  return "frontier (>=$3/M)"
}

function family(id) {
  return id.split("/")[0] ?? "unknown"
}

const response = await fetch(CATALOG_URL)
if (!response.ok) {
  console.error(`Catalog request failed: ${response.status} ${response.statusText}`)
  process.exit(1)
}
const { data: models } = await response.json()

console.log(`Total models in catalog: ${models.length}\n`)

// --- Declared support, overall ---
const supports = (m, p) => (m.supported_parameters ?? []).includes(p)

console.log("Declared support, overall:")
for (const param of PARAMS_OF_INTEREST) {
  const n = models.filter((m) => supports(m, param)).length
  const pct = ((n / models.length) * 100).toFixed(1)
  console.log(`  ${param.padEnd(20)} ${String(n).padStart(4)} / ${models.length}  (${pct}%)`)
}

// --- Cross-tab: tools vs structured_outputs ---
const bothCount = models.filter((m) => supports(m, "tools") && supports(m, "structured_outputs")).length
const toolsOnly = models.filter((m) => supports(m, "tools") && !supports(m, "structured_outputs")).length
const soOnly = models.filter((m) => !supports(m, "tools") && supports(m, "structured_outputs")).length
const neither = models.filter((m) => !supports(m, "tools") && !supports(m, "structured_outputs")).length

console.log("\nCross-tab (tools x structured_outputs):")
console.log(`  both                 ${String(bothCount).padStart(4)}`)
console.log(`  tools only           ${String(toolsOnly).padStart(4)}`)
console.log(`  structured_outputs only ${String(soOnly).padStart(4)}`)
console.log(`  neither              ${String(neither).padStart(4)}`)

// --- By price tier (proxy for model size) ---
console.log("\nDeclared support by price tier (proxy for model size):")
const tiers = ["free", "cheap (<$0.50/M)", "mid ($0.50-3/M)", "frontier (>=$3/M)", "unknown"]
console.log(`  ${"tier".padEnd(20)} ${"n".padStart(4)} ${"tools".padStart(8)} ${"struct_out".padStart(11)}`)
for (const tier of tiers) {
  const inTier = models.filter((m) => priceTier(m) === tier)
  if (inTier.length === 0) continue
  const t = inTier.filter((m) => supports(m, "tools")).length
  const s = inTier.filter((m) => supports(m, "structured_outputs")).length
  const pctT = ((t / inTier.length) * 100).toFixed(0)
  const pctS = ((s / inTier.length) * 100).toFixed(0)
  console.log(
    `  ${tier.padEnd(20)} ${String(inTier.length).padStart(4)} ${`${t} (${pctT}%)`.padStart(8)} ${`${s} (${pctS}%)`.padStart(11)}`,
  )
}

// --- By provider family, for the families this project might route to ---
console.log("\nDeclared support by provider family (families with >=5 models):")
const families = [...new Set(models.map((m) => family(m.id)))].sort()
console.log(`  ${"family".padEnd(16)} ${"n".padStart(4)} ${"tools".padStart(9)} ${"struct_out".padStart(11)}`)
for (const fam of families) {
  const inFam = models.filter((m) => family(m.id) === fam)
  if (inFam.length < 5) continue
  const t = inFam.filter((m) => supports(m, "tools")).length
  const s = inFam.filter((m) => supports(m, "structured_outputs")).length
  console.log(
    `  ${fam.padEnd(16)} ${String(inFam.length).padStart(4)} ${`${t}/${inFam.length}`.padStart(9)} ${`${s}/${inFam.length}`.padStart(11)}`,
  )
}

// --- The two models ADR-004 §2.5 currently defaults to ---
console.log("\nADR-004 §2.5's current default tiers:")
for (const id of ["google/gemini-2.5-flash-lite", "anthropic/claude-sonnet-4.5"]) {
  const m = models.find((x) => x.id === id)
  if (!m) {
    console.log(`  ${id}: NOT FOUND in catalog`)
    continue
  }
  const declared = PARAMS_OF_INTEREST.filter((p) => supports(m, p))
  console.log(`  ${id}`)
  console.log(`      declares: ${declared.length > 0 ? declared.join(", ") : "(none of interest)"}`)
}
