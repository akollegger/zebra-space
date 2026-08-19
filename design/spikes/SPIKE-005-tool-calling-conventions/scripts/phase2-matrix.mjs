#!/usr/bin/env node
// SPIKE-005 Phase 2: what do models *actually* honor?
//
// Matrix of (schema shape) x (mechanism) x (model), issued as raw HTTP against OpenRouter's
// chat/completions endpoint — deliberately NOT via @openrouter/sdk, so the SDK's own translation
// layer isn't a confound. The prompt is held constant and trivial so the only variables are the
// ones under test.
//
// Usage: OPENROUTER_API_KEY=... node phase2-matrix.mjs [--mechanisms M1,M2] [--models a,b]

const API_URL = "https://openrouter.ai/api/v1/chat/completions"
const KEY = process.env.OPENROUTER_API_KEY
if (!KEY) {
  console.error("OPENROUTER_API_KEY is not set")
  process.exit(1)
}

// --- Schema ladder: increasing structural demand -------------------------------------------

const SCHEMAS = {
  S1: {
    label: "flat primitives",
    schema: {
      type: "object",
      properties: { name: { type: "string" }, count: { type: "number" } },
      required: ["name", "count"],
      additionalProperties: false,
    },
    validate: (o) => typeof o?.name === "string" && typeof o?.count === "number",
  },
  S2: {
    label: "nested + array of objects",
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" }, value: { type: "number" } },
            required: ["id", "value"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
    validate: (o) =>
      Array.isArray(o?.items) &&
      o.items.every((i) => typeof i?.id === "string" && typeof i?.value === "number"),
  },
  S3: {
    label: "discriminated union, inlined (no $ref)",
    schema: {
      type: "object",
      properties: {
        node: {
          anyOf: [
            {
              type: "object",
              properties: { kind: { type: "string", enum: ["leaf"] }, value: { type: "number" } },
              required: ["kind", "value"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: { kind: { type: "string", enum: ["named"] }, text: { type: "string" } },
              required: ["kind", "text"],
              additionalProperties: false,
            },
          ],
        },
      },
      required: ["node"],
      additionalProperties: false,
    },
    validate: (o) =>
      (o?.node?.kind === "leaf" && typeof o.node.value === "number") ||
      (o?.node?.kind === "named" && typeof o.node.text === "string"),
  },
  S4: {
    label: "shared $ref, NON-recursive",
    schema: {
      type: "object",
      properties: { a: { $ref: "#/$defs/Point" }, b: { $ref: "#/$defs/Point" } },
      required: ["a", "b"],
      additionalProperties: false,
      $defs: {
        Point: {
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" } },
          required: ["x", "y"],
          additionalProperties: false,
        },
      },
    },
    validate: (o) =>
      typeof o?.a?.x === "number" &&
      typeof o?.a?.y === "number" &&
      typeof o?.b?.x === "number" &&
      typeof o?.b?.y === "number",
  },
  S5: {
    label: "recursive $ref (the ExtractedCsp shape)",
    schema: {
      type: "object",
      properties: { root: { $ref: "#/$defs/Node" } },
      required: ["root"],
      additionalProperties: false,
      $defs: {
        Node: {
          type: "object",
          properties: {
            name: { type: "string" },
            child: { anyOf: [{ $ref: "#/$defs/Node" }, { type: "null" }] },
          },
          required: ["name", "child"],
          additionalProperties: false,
        },
      },
    },
    validate: (o) => {
      const ok = (n) =>
        n !== undefined &&
        typeof n?.name === "string" &&
        (n.child === null || ok(n.child))
      return ok(o?.root)
    },
  },
}

// S6 is the candidate *fix*, added after S1-S5 showed $ref is what Google chokes on: the same
// recursive shape as S5, but inlined to a bounded depth so no $ref/$defs appears at all.
// ExtractedCsp's real recursion (derivedRule.thenConstraints, arithmetic binaryOp) is shallow in
// practice, so bounding it is viable rather than merely expedient.
function inlinedNode(depth) {
  return {
    type: "object",
    properties: {
      name: { type: "string" },
      child:
        depth === 0
          ? { type: "null" }
          : { anyOf: [inlinedNode(depth - 1), { type: "null" }] },
    },
    required: ["name", "child"],
    additionalProperties: false,
  }
}
SCHEMAS.S6 = {
  label: "recursive, INLINED to depth 3 (no $ref)",
  schema: {
    type: "object",
    properties: { root: inlinedNode(3) },
    required: ["root"],
    additionalProperties: false,
  },
  validate: SCHEMAS.S5.validate,
}

// S7 is the second candidate fix. S6 showed inlining alone doesn't rescue Google: it emits a
// *string* wherever `anyOf: [<object>, null]` is required, i.e. nullable nested objects are what
// it actually mishandles (S3 proved anyOf-of-objects is fine). Google's own S5 rejection message
// named the escape hatch — "or a potentially-zero-length array items" — so S7 keeps $ref but
// routes the recursive edge through an array, where [] means "leaf" instead of null.
SCHEMAS.S7 = {
  label: "recursive via $ref, array-based edge ([] = leaf, no nullable object)",
  schema: {
    type: "object",
    properties: { root: { $ref: "#/$defs/Node" } },
    required: ["root"],
    additionalProperties: false,
    $defs: {
      Node: {
        type: "object",
        properties: {
          name: { type: "string" },
          children: { type: "array", items: { $ref: "#/$defs/Node" } },
        },
        required: ["name", "children"],
        additionalProperties: false,
      },
    },
  },
  validate: (o) => {
    const ok = (n) =>
      typeof n?.name === "string" && Array.isArray(n.children) && n.children.every(ok)
    return ok(o?.root)
  },
}

// S8 combines both fixes, since S6 and S7 each isolated one failure and neither alone rescued
// Google: no $ref anywhere (S6's lesson — under M2 Google renders any $ref as a bare string,
// recursive or not) AND no nullable nested object (S7/S6's lesson — `anyOf: [<object>, null]`
// also degrades to a string). The recursive edge is an array that may be empty, and the deepest
// level simply omits the edge.
function inlinedArrayNode(depth) {
  if (depth === 0) {
    return {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    }
  }
  return {
    type: "object",
    properties: {
      name: { type: "string" },
      children: { type: "array", items: inlinedArrayNode(depth - 1) },
    },
    required: ["name", "children"],
    additionalProperties: false,
  }
}
SCHEMAS.S8 = {
  label: "recursive, INLINED depth 3 + array edge (no $ref, no nullable object)",
  schema: {
    type: "object",
    properties: { root: inlinedArrayNode(3) },
    required: ["root"],
    additionalProperties: false,
  },
  validate: (o) => {
    const ok = (n) =>
      typeof n?.name === "string" &&
      (n.children === undefined || (Array.isArray(n.children) && n.children.every(ok)))
    return ok(o?.root)
  },
}

const MODELS = [
  "openai/gpt-5.1",
  "openai/gpt-4o-mini",
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-haiku-4.5",
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "meta-llama/llama-3.3-70b-instruct",
  "mistralai/mistral-small-3.2-24b-instruct",
  "qwen/qwen3-32b",
  "deepseek/deepseek-chat-v3.1",
  "z-ai/glm-4.6",
  "amazon/nova-lite-v1",
]

const PROMPT = "Produce a small example object conforming to the required structure."
const TOOL_NAME = "emit_example"
const REQUEST_TIMEOUT_MS = 90_000

// --- Mechanisms ------------------------------------------------------------------------------

function buildBody(mechanism, model, schema) {
  const base = {
    model,
    messages: [{ role: "user", content: PROMPT }],
    max_tokens: 500,
  }
  if (mechanism === "M1") {
    return {
      ...base,
      response_format: { type: "json_schema", json_schema: { name: "Example", strict: true, schema } },
    }
  }
  const withTools = {
    ...base,
    tools: [
      {
        type: "function",
        function: { name: TOOL_NAME, description: "Emit one example object.", parameters: schema },
      },
    ],
    tool_choice: { type: "function", function: { name: TOOL_NAME } },
  }
  if (mechanism === "M3") return { ...withTools, provider: { require_parameters: true } }
  return withTools
}

/** Recover JSON from a markdown fence or a prose-wrapped response. */
function unwrap(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence?.[1]) return fence[1].trim()
  const brace = text.indexOf("{")
  const close = text.lastIndexOf("}")
  if (brace !== -1 && close > brace) return text.slice(brace, close + 1)
  return null
}

async function probe(model, schemaId, mechanism) {
  const { schema, validate } = SCHEMAS[schemaId]
  const cell = { model, schemaId, mechanism }
  // A per-request deadline is mandatory, not defensive: without it a single hung connection
  // pins a worker slot forever and stalls the whole matrix (observed on the first S8 run).
  let response
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildBody(mechanism, model, schema)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError"
    return {
      ...cell,
      outcome: "TIMEOUT",
      detail: timedOut ? `no response within ${REQUEST_TIMEOUT_MS}ms` : `network: ${error.message}`,
    }
  }

  const raw = await response.text()
  if (!response.ok) {
    let detail = raw.slice(0, 400)
    try {
      const parsed = JSON.parse(raw)
      detail = parsed?.error?.metadata?.raw ?? parsed?.error?.message ?? detail
    } catch {}
    return { ...cell, outcome: "REJECT", status: response.status, detail: String(detail).slice(0, 400) }
  }

  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return { ...cell, outcome: "UNENFORCED", detail: "response body was not JSON" }
  }
  // An error can arrive with HTTP 200 in OpenRouter's envelope.
  if (body.error) {
    return { ...cell, outcome: "REJECT", status: 200, detail: String(body.error.message ?? "").slice(0, 400) }
  }

  const message = body.choices?.[0]?.message
  if (!message) return { ...cell, outcome: "UNENFORCED", detail: "no message in response" }

  if (mechanism === "M1") {
    const content = message.content
    if (typeof content !== "string" || content.trim() === "") {
      return { ...cell, outcome: "UNENFORCED", detail: "no text content" }
    }
    try {
      const obj = JSON.parse(content)
      return validate(obj)
        ? { ...cell, outcome: "OK" }
        : { ...cell, outcome: "UNENFORCED", detail: `parsed but non-conforming: ${content.slice(0, 150)}` }
    } catch {
      const recovered = unwrap(content)
      if (recovered) {
        try {
          const obj = JSON.parse(recovered)
          if (validate(obj)) return { ...cell, outcome: "WRAPPED", detail: "valid JSON inside prose/fence" }
        } catch {}
      }
      return { ...cell, outcome: "UNENFORCED", detail: `not JSON: ${content.slice(0, 150)}` }
    }
  }

  // M2 / M3: the structured payload should arrive as a tool call, not as content.
  const call = message.tool_calls?.[0]
  if (!call) {
    return {
      ...cell,
      outcome: "UNENFORCED",
      detail: `no tool_call; content: ${String(message.content ?? "").slice(0, 150)}`,
    }
  }
  try {
    const obj = JSON.parse(call.function.arguments)
    return validate(obj)
      ? { ...cell, outcome: "OK" }
      : {
          ...cell,
          outcome: "UNENFORCED",
          detail: `tool args non-conforming: ${call.function.arguments.slice(0, 150)}`,
        }
  } catch {
    return { ...cell, outcome: "UNENFORCED", detail: "tool args were not valid JSON" }
  }
}

// --- Runner ----------------------------------------------------------------------------------

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1].split(",") : fallback
}

const mechanisms = arg("--mechanisms", ["M1", "M2"])
const models = arg("--models", MODELS)
const schemaIds = arg("--schemas", Object.keys(SCHEMAS))

const jobs = []
for (const model of models) {
  for (const schemaId of schemaIds) {
    for (const mechanism of mechanisms) jobs.push({ model, schemaId, mechanism })
  }
}

console.error(`Running ${jobs.length} probes (${models.length} models x ${schemaIds.length} schemas x ${mechanisms.length} mechanisms)...`)

const CONCURRENCY = 6
const results = []
let cursor = 0
let done = 0
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++]
      const result = await probe(job.model, job.schemaId, job.mechanism)
      results.push(result)
      done += 1
      if (done % 10 === 0) console.error(`  ${done}/${jobs.length}`)
    }
  }),
)

// --- Report ----------------------------------------------------------------------------------

const SYMBOL = { OK: "OK  ", REJECT: "REJ ", UNENFORCED: "UNEN", WRAPPED: "WRAP", TIMEOUT: "TIME" }

for (const mechanism of mechanisms) {
  console.log(`\n=== ${mechanism} ${mechanism === "M1" ? "(response_format json_schema, strict)" : mechanism === "M2" ? "(tools + forced tool_choice)" : "(tools + require_parameters)"} ===`)
  console.log(`${"model".padEnd(42)}${schemaIds.map((s) => s.padEnd(6)).join("")}`)
  for (const model of models) {
    const row = schemaIds
      .map((s) => {
        const r = results.find((x) => x.model === model && x.schemaId === s && x.mechanism === mechanism)
        return (SYMBOL[r?.outcome] ?? "??  ").padEnd(6)
      })
      .join("")
    console.log(`${model.padEnd(42)}${row}`)
  }
}

console.log("\n=== Failure details (first 2 per model/mechanism) ===")
for (const mechanism of mechanisms) {
  for (const model of models) {
    const fails = results.filter(
      (r) => r.model === model && r.mechanism === mechanism && r.outcome !== "OK",
    )
    for (const f of fails.slice(0, 2)) {
      console.log(`${mechanism} ${model} ${f.schemaId} [${f.outcome}] ${String(f.detail ?? "").replace(/\s+/g, " ").slice(0, 200)}`)
    }
  }
}

const summary = {}
for (const mechanism of mechanisms) {
  summary[mechanism] = {}
  for (const outcome of ["OK", "WRAPPED", "UNENFORCED", "REJECT", "TIMEOUT"]) {
    summary[mechanism][outcome] = results.filter((r) => r.mechanism === mechanism && r.outcome === outcome).length
  }
}
console.log("\n=== Totals ===")
console.log(JSON.stringify(summary, null, 2))

await import("node:fs/promises").then((fs) =>
  fs.writeFile(
    new URL("../results/phase2-raw.json", import.meta.url),
    JSON.stringify({ generatedFrom: "phase2-matrix.mjs", models, schemaIds, mechanisms, results }, null, 2),
  ),
)
console.error("\nRaw results written to results/phase2-raw.json")
