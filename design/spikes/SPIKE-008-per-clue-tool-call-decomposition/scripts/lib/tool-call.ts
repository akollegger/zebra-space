// SPIKE-008 spike-local forced-tool-call wrapper. Mirrors
// src/extraction/provider.ts's requestStructuredCompletion mechanics (same route resolution —
// reused directly, so this respects ZEBRA_OPENROUTER_BASE_URL_OVERRIDE/ZEBRA_LOCAL_BASE_URL the
// same as the real pipeline, letting this spike's harness be smoke-tested against the same
// zero-cost stub server tests/extraction/support/stub-server.ts already provides — but decodes
// the tool call's arguments with a small hand-rolled structural check instead of an effect
// Schema.Codec, since the per-clue schemas are generated per-vocabulary at runtime
// (clue-schema.ts) rather than declared as static Schema values. A spike-scoped simplification,
// not a claim that this validation approach should replace effect Schema in the real pipeline.

import { OpenRouter } from "@openrouter/sdk"
import { resolveProviderRoute } from "../../../../../src/extraction/provider.ts"

export interface ToolCallRequest {
  readonly model: string
  readonly systemPrompt: string
  readonly userPrompt: string
  readonly schemaName: string
  readonly jsonSchema: Record<string, unknown>
  readonly timeoutMs?: number
}

export type ToolCallResult =
  | { readonly ok: true; readonly value: unknown; readonly costUsd: number | undefined; readonly calls: 1 }
  | { readonly ok: false; readonly reason: "prose" | "invalid-json" | "structural"; readonly detail: string; readonly raw: string; readonly costUsd: number | undefined; readonly calls: 1 }

/** Cheap, deliberately shallow structural check: every generated schema (clue-schema.ts) is one
 * level of `type: "object"` with `required`/`enum`-typed leaves, plus at most one further level
 * for expression/attributes arrays — walk `required`/`enum`/`type` only, not a full JSON Schema
 * validator. Good enough to prove the point (does the model respect the enum, or does an
 * invented value slip through anyway) without pulling in a validation library for a spike. */
function checkStructural(value: unknown, schema: Record<string, unknown>, path = "$"): string | undefined {
  if (schema.anyOf !== undefined) {
    const alternatives = schema.anyOf as readonly Record<string, unknown>[]
    for (const alt of alternatives) {
      if (checkStructural(value, alt, path) === undefined) return undefined
    }
    return `${path}: matched none of ${alternatives.length} anyOf alternatives (got ${JSON.stringify(value)?.slice(0, 200)})`
  }
  if (schema.type === "null") return value === null ? undefined : `${path}: expected null, got ${JSON.stringify(value)}`
  if (schema.enum !== undefined) {
    const allowed = schema.enum as readonly unknown[]
    return allowed.includes(value) ? undefined : `${path}: "${String(value)}" is not one of the declared values [${allowed.join(", ")}]`
  }
  if (schema.type === "number") return typeof value === "number" ? undefined : `${path}: expected a number, got ${JSON.stringify(value)}`
  if (schema.type === "string") return typeof value === "string" ? undefined : `${path}: expected a string, got ${JSON.stringify(value)}`
  if (schema.type === "boolean") return typeof value === "boolean" ? undefined : `${path}: expected a boolean, got ${JSON.stringify(value)}`
  if (schema.type === "array") {
    if (!Array.isArray(value)) return `${path}: expected an array, got ${JSON.stringify(value)}`
    const items = schema.items as Record<string, unknown>
    for (let i = 0; i < value.length; i++) {
      const err = checkStructural(value[i], items, `${path}[${i}]`)
      if (err !== undefined) return err
    }
    return undefined
  }
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return `${path}: expected an object, got ${JSON.stringify(value)}`
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
    const required = (schema.required ?? []) as readonly string[]
    const obj = value as Record<string, unknown>
    for (const key of required) {
      if (!(key in obj)) return `${path}.${key}: missing required field`
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) return `${path}.${key}: unexpected field not declared in schema`
      }
    }
    for (const [key, propSchema] of Object.entries(props)) {
      if (!(key in obj)) continue
      const err = checkStructural(obj[key], propSchema, `${path}.${key}`)
      if (err !== undefined) return err
    }
    return undefined
  }
  return undefined
}

export interface MultiToolRequest {
  readonly model: string
  readonly systemPrompt: string
  readonly userPrompt: string
  /** kind name -> that kind's generated JSON Schema (clue-schema.ts's generateClueTools output). */
  readonly tools: Record<string, Record<string, unknown>>
  readonly timeoutMs?: number
}

export interface ParsedToolCall {
  readonly kind: string
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: string
  readonly raw: string
}

export type MultiToolResult =
  | { readonly ok: true; readonly calls: readonly ParsedToolCall[]; readonly costUsd: number | undefined }
  | { readonly ok: false; readonly reason: "prose" | "no-tool-call"; readonly detail: string; readonly raw: string; readonly costUsd: number | undefined }

/**
 * One clue, all nine generated tools offered at once, `tool_choice: "auto"` — not `"required"`,
 * and not a single forced function name — so the MODEL decides both WHETHER this clue asserts
 * any constraint at all (a pure scenario/setup clue legitimately calls nothing — the
 * clueSystemPrompt documents this path, and `"required"` would have made it structurally
 * impossible, forcing a hallucinated call on every clue instead) and, when it does, HOW MANY —
 * usually one, occasionally two for a compound clue ("X is red and lives in house 1" might be
 * one `linkedAttributes` OR two calls) — rather than this harness guessing the kind up front.
 * Each returned tool call is independently structurally validated against ITS OWN kind's schema
 * (clue-schema.ts), so one bad call among several doesn't invalidate the others.
 *
 * Found in review (2026-09-15, PR #27): every billed run so far used `"required"`, so those
 * results reflect the stricter (always-forces-a-call) behavior; this fix wasn't re-run against
 * the full sample since it's a downstream correctness fix, not the entity-scoping bug that
 * motivated the last billed re-run, and re-running again wasn't requested.
 */
export async function requestClueConstraints(request: MultiToolRequest): Promise<MultiToolResult> {
  const route = resolveProviderRoute("multi-tool")
  const client = new OpenRouter({ apiKey: route.apiKey, ...(route.serverURL !== undefined ? { serverURL: route.serverURL } : {}) })
  const timeoutMs = request.timeoutMs ?? 60_000

  const response = await client.chat.send(
    {
      chatRequest: {
        model: request.model,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt },
        ],
        tools: Object.entries(request.tools).map(([kind, schema]) => ({
          type: "function" as const,
          function: { name: kind, description: `Emit a "${kind}" constraint if — and only if — this clue asserts one.`, parameters: schema },
        })),
        toolChoice: "auto",
      },
    },
    { retries: { strategy: "none" }, timeoutMs },
  )

  if (!("choices" in response)) {
    return { ok: false, reason: "prose", detail: "streamed response, not supported here", raw: "", costUsd: undefined }
  }
  const costUsd = typeof response.usage?.cost === "number" ? response.usage.cost : undefined
  const message = response.choices[0]?.message
  const toolCalls = message?.toolCalls ?? []
  if (toolCalls.length === 0) {
    // Under "auto", zero tool calls is a legitimate outcome for a pure setup/scenario clue, not
    // a call-level failure — the clueSystemPrompt explicitly documents this path. A non-empty
    // `content` alongside it is still worth carrying (the model explaining itself, or drifting
    // into prose), but doesn't make this an error case the way it would under "required".
    return { ok: true, calls: [], costUsd }
  }
  const calls: ParsedToolCall[] = toolCalls.map((call) => {
    const kind = call.function.name
    const schema = request.tools[kind]
    if (schema === undefined) {
      return { kind, ok: false, error: `model called an undeclared tool "${kind}"`, raw: call.function.arguments }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(call.function.arguments)
    } catch {
      return { kind, ok: false, error: "tool arguments were not valid JSON", raw: call.function.arguments }
    }
    const structuralError = checkStructural(parsed, schema)
    if (structuralError !== undefined) {
      return { kind, ok: false, error: structuralError, raw: call.function.arguments }
    }
    return { kind, ok: true, value: parsed, raw: call.function.arguments }
  })
  return { ok: true, calls, costUsd }
}

export async function requestClueTool(request: ToolCallRequest): Promise<ToolCallResult> {
  const route = resolveProviderRoute(request.schemaName)
  const client = new OpenRouter({ apiKey: route.apiKey, ...(route.serverURL !== undefined ? { serverURL: route.serverURL } : {}) })
  const timeoutMs = request.timeoutMs ?? 60_000

  const response = await client.chat.send(
    {
      chatRequest: {
        model: request.model,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt },
        ],
        tools: [{ type: "function", function: { name: request.schemaName, description: `Emit the ${request.schemaName} constraint this clue implies.`, parameters: request.jsonSchema } }],
        toolChoice: route.toolChoice,
      },
    },
    { retries: { strategy: "none" }, timeoutMs },
  )

  if (!("choices" in response)) {
    return { ok: false, reason: "prose", detail: "streamed response, not supported here", raw: "", costUsd: undefined, calls: 1 }
  }
  const costUsd = typeof response.usage?.cost === "number" ? response.usage.cost : undefined
  const message = response.choices[0]?.message
  const call = message?.toolCalls?.[0]
  if (call === undefined) {
    return { ok: false, reason: "prose", detail: "the model replied in prose instead of calling the required tool", raw: String(message?.content ?? "").slice(0, 2000), costUsd, calls: 1 }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(call.function.arguments)
  } catch {
    return { ok: false, reason: "invalid-json", detail: "tool arguments were not valid JSON", raw: call.function.arguments.slice(0, 2000), costUsd, calls: 1 }
  }
  const structuralError = checkStructural(parsed, request.jsonSchema)
  if (structuralError !== undefined) {
    return { ok: false, reason: "structural", detail: structuralError, raw: call.function.arguments, costUsd, calls: 1 }
  }
  return { ok: true, value: parsed, costUsd, calls: 1 }
}
