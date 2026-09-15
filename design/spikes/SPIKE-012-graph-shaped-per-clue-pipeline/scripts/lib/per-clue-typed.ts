// SPIKE-012 §2 step 6: two forced-tool calls per clue — classify (pick ONE of the small,
// closed template set) then fill (against ONLY that template's already-generated, entity-scoped
// tool(s)) — instead of SPIKE-008's single call offering all nine kinds at once with
// `tool_choice: "auto"`. This is the direct test of SPIKE-008's own diagnosed risk that a single
// call offering every tool isn't a hand-picked one; classify's schema is tiny (one enum field)
// regardless of vocabulary size, and fill's schema is only as large as the ONE chosen kind's
// (already entity/domain-scoped) alternatives.

import { requestClueTool, requestClueConstraints, type ParsedToolCall } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/tool-call.ts"
import { classifySystemPrompt, classifyJsonSchema, toolsForTemplate, generateToolsForVocabulary, TEMPLATE_IDS, type TemplateId } from "./clue-templates.ts"
import type { Vocabulary } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/clue-schema.ts"
import type { ExtractedConstraint } from "../../../../../src/extraction/types.ts"

export interface ClueTaggedConstraint {
  readonly clueIndex: number
  readonly constraint: ExtractedConstraint
}

export interface PerClueTypedLog {
  readonly clueIndex: number
  readonly clueText: string
  readonly template: TemplateId | undefined
  readonly toolCallsMade: number
  readonly kindsEmitted: readonly string[]
  readonly rejectedStructurally: readonly string[]
}

export interface PerClueTypedResult {
  readonly taggedConstraints: readonly ClueTaggedConstraint[]
  readonly perClue: readonly PerClueTypedLog[]
  readonly totalCalls: number
  readonly actualCostUsd: number | undefined
}

async function classifyClue(model: string, preamble: string, clueText: string): Promise<{ readonly template: TemplateId | undefined; readonly costUsd: number | undefined }> {
  const result = await requestClueTool({
    model,
    systemPrompt: classifySystemPrompt(preamble),
    userPrompt: `Clue:\n\n${clueText}`,
    schemaName: "classify_clue",
    jsonSchema: classifyJsonSchema(),
  })
  if (!result.ok) return { template: undefined, costUsd: result.costUsd }
  const value = result.value as { template?: string }
  const template = (TEMPLATE_IDS as readonly string[]).includes(value.template ?? "") ? (value.template as TemplateId) : undefined
  return { template, costUsd: result.costUsd }
}

/**
 * One clue, end to end: classify (1 call) then fill (1 call against only that template's
 * tools, plus at most one repair round on a structural miss — mirrors SPIKE-008's own
 * per-clue repair pattern, scoped identically). `noConstraint` short-circuits with zero fill
 * calls, a legitimate first-class outcome (not a fallback afterthought — SPIKE-008 PR #27's own
 * finding that `tool_choice: "required"` made a genuine setup-only clue structurally
 * impossible to represent correctly is designed around here from the start).
 */
async function extractOneClue(
  model: string,
  vocabulary: Vocabulary,
  preamble: string,
  clueText: string,
  clueIndex: number,
): Promise<{ readonly constraints: readonly ExtractedConstraint[]; readonly log: PerClueTypedLog; readonly costUsd: number | undefined; readonly calls: number }> {
  let cost = 0
  let anyCost = false
  const add = (c: number | undefined) => {
    if (c !== undefined) {
      cost += c
      anyCost = true
    }
  }
  let calls = 0

  const classified = await classifyClue(model, preamble, clueText)
  add(classified.costUsd)
  calls += 1

  if (classified.template === undefined) {
    return {
      constraints: [],
      log: { clueIndex, clueText, template: undefined, toolCallsMade: 0, kindsEmitted: [], rejectedStructurally: ["classify call failed or returned an unrecognized template"] },
      costUsd: anyCost ? cost : undefined,
      calls,
    }
  }
  if (classified.template === "noConstraint") {
    return {
      constraints: [],
      log: { clueIndex, clueText, template: "noConstraint", toolCallsMade: 0, kindsEmitted: [], rejectedStructurally: [] },
      costUsd: anyCost ? cost : undefined,
      calls,
    }
  }

  const allTools = generateToolsForVocabulary(vocabulary)
  const tools = toolsForTemplate(classified.template, allTools)
  const systemPrompt =
    `You are extracting the constraint a single clue asserts, already classified as "${classified.template}". ` +
    `Call one of the declared tools to emit it (usually one call; two only for a genuinely compound clue).\n\n` +
    `Scenario: ${preamble}`

  const fill = await requestClueConstraints({ model, systemPrompt, userPrompt: `Clue:\n\n${clueText}`, tools })
  add(fill.costUsd)
  calls += 1

  let toolCalls: readonly ParsedToolCall[] = fill.ok ? fill.calls : []
  const rejected: string[] = fill.ok ? [] : [`(call-level) ${fill.reason}: ${fill.detail}`]
  const failing = toolCalls.filter((c) => !c.ok)

  if (fill.ok && (failing.length > 0 || toolCalls.length === 0)) {
    const repairPrompt =
      toolCalls.length === 0
        ? `Clue:\n\n${clueText}\n\nYou were classified as "${classified.template}" but called nothing. Call one of the declared tools.`
        : `Clue:\n\n${clueText}\n\nYour previous call(s) had structural problems:\n${failing.map((f) => `- ${f.kind}: ${f.error}`).join("\n")}\n\nCall the tool(s) again, corrected.`
    const retry = await requestClueConstraints({ model, systemPrompt, userPrompt: repairPrompt, tools })
    add(retry.costUsd)
    calls += 1
    if (retry.ok) {
      const stillFailing = retry.calls.filter((c) => !c.ok)
      toolCalls = [...toolCalls.filter((c) => c.ok), ...retry.calls.filter((c) => c.ok)]
      rejected.push(...stillFailing.map((f) => `${f.kind}: ${f.error}`))
    } else {
      rejected.push(`(repair call-level) ${retry.reason}: ${retry.detail}`)
    }
  }

  const constraints = toolCalls.filter((c) => c.ok).map((c) => c.value as ExtractedConstraint)
  return {
    constraints,
    log: { clueIndex, clueText, template: classified.template, toolCallsMade: toolCalls.length, kindsEmitted: toolCalls.filter((c) => c.ok).map((c) => c.kind), rejectedStructurally: rejected },
    costUsd: anyCost ? cost : undefined,
    calls,
  }
}

export async function extractAllClues(model: string, vocabulary: Vocabulary, preamble: string, clues: readonly string[]): Promise<PerClueTypedResult> {
  let totalCost = 0
  let anyCost = false
  let totalCalls = 0
  const perClue: PerClueTypedLog[] = []
  const taggedConstraints: ClueTaggedConstraint[] = []

  for (let i = 0; i < clues.length; i++) {
    const result = await extractOneClue(model, vocabulary, preamble, clues[i]!, i)
    if (result.costUsd !== undefined) {
      totalCost += result.costUsd
      anyCost = true
    }
    totalCalls += result.calls
    perClue.push(result.log)
    for (const constraint of result.constraints) taggedConstraints.push({ clueIndex: i, constraint })
  }

  return { taggedConstraints, perClue, totalCalls, actualCostUsd: anyCost ? totalCost : undefined }
}

/** Re-runs ONE clue's fill call with an extra hint (a targeted oracle-repair finding, or a
 * back-translation judge's issue) appended — used by oracle-repair.ts for a single, scoped
 * revision round. Reuses the SAME template the clue was originally classified as (re-classifying
 * would risk drifting away from an otherwise-correct kind choice over a slot-level error). */
export async function reviseOneClue(
  model: string,
  vocabulary: Vocabulary,
  preamble: string,
  clueText: string,
  template: TemplateId,
  hint: string,
): Promise<{ readonly constraints: readonly ExtractedConstraint[]; readonly costUsd: number | undefined; readonly calls: number }> {
  if (template === "noConstraint") return { constraints: [], costUsd: undefined, calls: 0 }
  const allTools = generateToolsForVocabulary(vocabulary)
  const tools = toolsForTemplate(template, allTools)
  const systemPrompt = `You are extracting the constraint a single clue asserts, already classified as "${template}". Call one of the declared tools to emit it, corrected per the hint below.\n\nScenario: ${preamble}`
  const userPrompt = `Clue:\n\n${clueText}\n\n${hint}\n\nCall the tool(s) again, corrected.`
  const result = await requestClueConstraints({ model, systemPrompt, userPrompt, tools })
  if (!result.ok) return { constraints: [], costUsd: result.costUsd, calls: 1 }
  const ok = result.calls.filter((c) => c.ok)
  return { constraints: ok.map((c) => c.value as ExtractedConstraint), costUsd: result.costUsd, calls: 1 }
}
