// SPIKE-013 §2 step 5 (added 2026-09-16): a 4th vocabulary-construction variant — instead of
// asking the model to construct vocabulary BLIND, before knowing the answer (llm-only/
// chunked-inventory/embedded-group all do this), let the model solve the puzzle freely in prose
// first (ADR-008's direct-solve, unconstrained — no schema, no forced tool call), then ask a
// SEPARATE, cheap call to describe the vocabulary that ALREADY-COMPLETED solution used. This is
// transcription of an existing structure, not discovery under uncertainty — the hypothesis this
// tests is that transcription should be far more reliable than blind guessing, and — more
// interestingly — that it should stay reliable even when the solve itself went wrong, since
// vocabulary shape is typically committed to in the first couple of reasoning steps, before the
// harder multi-step deduction that can go wrong later (see the PZL-0001 gpt-4o-mini MISMATCH
// trace: correct 5-entity/5-domain setup in "Step 1", vacuous filler and a wrong final answer in
// "Step 6" — the failure arrives well after the vocabulary was already fixed).
//
// Solving is NOT re-run here — it's read from the already-collected, already-paid-for
// direct-solve result JSON (eval/results/*.json), so this variant's only new spend is the
// transcription call itself.

import type { Entity, Domain } from "../../../../../src/extraction/types.ts"
import { requestClueTool } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/tool-call.ts"

const SCENARIO_ENTITY_TYPE = "scenario"
const SCENARIO_ENTITY_ID = "the_scenario"

const POST_HOC_SCHEMA = {
  type: "object",
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "A stable identifier for this individual thing (e.g. \"house_1\", \"suspect_scarlett\")." },
          type: { type: "string", description: "This entity's type/axis name (e.g. \"house\", \"suspect\")." },
        },
        required: ["id", "type"],
        additionalProperties: false,
      },
    },
    domains: {
      type: "array",
      items: {
        type: "object",
        properties: {
          variable: { type: "string", description: "The attribute category's name (e.g. \"color\", \"nationality\")." },
          entityType: { type: "string", description: "Which entity type (from `entities` above) this domain is assigned to." },
          values: { type: "array", items: { type: "string" }, description: "Every distinct value this domain takes, in the solution." },
        },
        required: ["variable", "entityType", "values"],
        additionalProperties: false,
      },
    },
  },
  required: ["entities", "domains"],
  additionalProperties: false,
} as const

function systemPrompt(): string {
  return (
    "You are given a logic puzzle and a worked solution that already attempted to solve it — " +
    "the solution may be fully correct, partially correct, or wrong; that does not matter here. " +
    "Your ONLY job is to describe the VOCABULARY that solution used while working: the ENTITIES " +
    "(individual things the puzzle tracks by identity — e.g. houses, suspects, days — each with " +
    "a stable id and a type) and the DOMAINS (attribute categories assigned to those entities — " +
    "e.g. color, nationality — each with its variable name, which entity type it belongs to, and " +
    "the full list of values it takes in that solution).\n\n" +
    "TRANSCRIBE the structure the solution already committed to — do not re-solve the puzzle, " +
    "second-guess the solution, or correct anything that looks wrong or incomplete. If the " +
    "solution never finished, describe the vocabulary it set up regardless.\n\n" +
    "If the puzzle narrows down a single unstated scenario with no distinct individual entities " +
    `(e.g. "there has been a murder — who did it, with what, where?"), use one synthesized ` +
    `entity ({ id: "${SCENARIO_ENTITY_ID}", type: "${SCENARIO_ENTITY_TYPE}" }) the same way a ` +
    "puzzle with a single implicit subject always does."
  )
}

function userPrompt(prose: string, trace: string): string {
  return `Puzzle:\n\n${prose}\n\nWorked solution:\n\n${trace}`
}

export interface PostHocResult {
  readonly entities: readonly Entity[]
  readonly domains: readonly Domain[]
  readonly costUsd: number | undefined
  readonly calls: number
  readonly ok: boolean
  readonly error?: string
}

/** One call: given the puzzle prose and an ALREADY-COMPLETED solve trace (from direct-solve,
 * read from disk — never re-solved here), transcribe the vocabulary that trace used. */
export async function extractPostHocVocabulary(model: string, prose: string, trace: string): Promise<PostHocResult> {
  const result = await requestClueTool({
    model,
    systemPrompt: systemPrompt(),
    userPrompt: userPrompt(prose, trace),
    schemaName: "describe_vocabulary",
    jsonSchema: POST_HOC_SCHEMA,
  })
  if (!result.ok) {
    return { entities: [], domains: [], costUsd: result.costUsd, calls: 1, ok: false, error: `${result.reason}: ${result.detail}` }
  }
  const value = result.value as { entities: readonly Entity[]; domains: readonly Domain[] }
  return { entities: value.entities, domains: value.domains, costUsd: result.costUsd, calls: 1, ok: true }
}
