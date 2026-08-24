import { OpenRouter } from "@openrouter/sdk"
import { OpenRouterError } from "@openrouter/sdk/models/errors"
import { Effect, Schedule, Schema } from "effect"
import { ProviderError, SchemaRejected, SchemaViolation } from "./types.ts"

const DEFAULT_TIMEOUT_MS = 60_000

// A transport failure (429, 5xx, a timeout) is often a single transient blip rather than a real
// outage — retry it up to twice with exponential backoff before giving up on this call. Schema
// rejections/violations are not retried here: they're about what the provider *understood*, not
// whether the request got through, and retrying the same model won't change that.
const PROVIDER_ERROR_RETRY_SCHEDULE = Schedule.max([Schedule.exponential("300 millis"), Schedule.recurs(2)])

const MISSING_API_KEY_MESSAGE = "OPENROUTER_API_KEY is missing or invalid (401 Unauthorized)."

export interface StructuredCompletionRequest<A> {
  readonly model: string
  readonly systemPrompt: string
  readonly userPrompt: string
  readonly schemaName: string
  readonly jsonSchema: Record<string, unknown>
  readonly schema: Schema.Codec<A>
  readonly timeoutMs?: number
}

/**
 * A 401 reaching this far means no usable credential was attached to the request at all (an
 * empty/unset OPENROUTER_API_KEY never gets an Authorization header in the first place — see
 * @openrouter/sdk's own lib/security.js) — the backend's own error text for that case ("No
 * cookie auth credentials found") is real but unhelpfully worded, so this replaces it with the
 * actual likely cause. Every generated HTTP error class extends OpenRouterError and sets
 * `statusCode`, regardless of whether the response body matches a specific error schema
 * (verified: a malformed 401 body still throws a `ResponseValidationError` that `instanceof
 * OpenRouterError` and carries `statusCode: 401`), so this check doesn't depend on OpenRouter's
 * exact response shape.
 */
function errorMessage(error: unknown): string {
  if (error instanceof OpenRouterError && error.statusCode === 401) {
    return MISSING_API_KEY_MESSAGE
  }
  return error instanceof Error ? error.message : String(error)
}

// Signatures of a provider refusing the *schema* rather than the prompt or the credential. Matched
// on the response body because OpenRouter forwards the upstream provider's message rather than
// classifying it — these are the phrasings SPIKE-005 actually observed from Google, plus the
// generic JSON-Schema vocabulary a different provider would most plausibly use.
const SCHEMA_REJECTION_SIGNATURES = [
  "ref loop",
  "reference to undefined schema",
  "invalid response_json_schema",
  "invalid json schema",
  "invalid schema",
  "$ref",
  "unsupported schema",
  "schema is invalid",
]

function looksLikeSchemaRejection(error: unknown): boolean {
  if (!(error instanceof OpenRouterError)) return false
  if (error.statusCode !== 400 && error.statusCode !== 422) return false
  const haystack = `${error.message} ${error.body ?? ""}`.toLowerCase()
  return SCHEMA_REJECTION_SIGNATURES.some((signature) => haystack.includes(signature))
}

/**
 * A fresh client per call, not a module-level singleton: `ZEBRA_OPENROUTER_BASE_URL_OVERRIDE`
 * (test-only, not part of ADR-003's public flag surface) must be read at call time so tests can
 * point requests at a local stub server without module-load-order concerns.
 */
function client(): OpenRouter {
  const serverURL = process.env.ZEBRA_OPENROUTER_BASE_URL_OVERRIDE
  return new OpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
    ...(serverURL !== undefined ? { serverURL } : {}),
  })
}

/**
 * A single schema-constrained, non-streaming completion delivered as a **forced tool call**
 * (ADR-004 §2.1): one request declaring exactly one function whose `parameters` is the schema,
 * with `tool_choice` naming it, and the payload read back from that call's arguments.
 *
 * This is a delivery mechanism, not an agentic loop — the model never chooses whether or which
 * tool to call, and never gets a second turn (ADR-004 §2.3). SPIKE-005 measured this convention
 * as far more reliably honored than `response_format`, which some providers accept and then
 * silently ignore.
 */
export function requestStructuredCompletion<A>(
  request: StructuredCompletionRequest<A>,
): Effect.Effect<A, ProviderError | SchemaRejected | SchemaViolation> {
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return Effect.tryPromise({
    try: () =>
      client().chat.send(
        {
          chatRequest: {
            model: request.model,
            messages: [
              { role: "system", content: request.systemPrompt },
              { role: "user", content: request.userPrompt },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: request.schemaName,
                  description: `Return the ${request.schemaName} for the given input.`,
                  parameters: request.jsonSchema,
                },
              },
            ],
            toolChoice: { type: "function", function: { name: request.schemaName } },
          },
        },
        // ADR-004 §2.3: retries/timeouts are this pipeline's own Effect.retry/Effect.timeout —
        // the SDK's own built-in retry loop is disabled so it can't silently keep retrying
        // underneath Effect.timeout below (verified hands-on: with the SDK's default retry
        // config left on, a request that fails immediately at the HTTP layer still took the
        // full external timeout to surface, because the SDK kept retrying in the background).
        { retries: { strategy: "none" }, timeoutMs },
      ),
    catch: (error) =>
      looksLikeSchemaRejection(error)
        ? new SchemaRejected({
            model: request.model,
            providerMessage: (error as OpenRouterError).body || errorMessage(error),
          })
        : new ProviderError({ message: errorMessage(error) }),
  }).pipe(
    Effect.timeout(timeoutMs),
    Effect.catchTag("TimeoutError", () =>
      Effect.fail(
        new ProviderError({ message: `Request to ${request.model} timed out after ${timeoutMs}ms` }),
      ),
    ),
    Effect.flatMap((response) => {
      if (!("choices" in response)) {
        return Effect.fail(
          new ProviderError({
            message: "Received a streamed response; this pipeline only sends non-streaming requests.",
          }),
        )
      }

      const message = response.choices[0]?.message
      const call = message?.toolCalls?.[0]
      if (call === undefined) {
        // The model answered in prose instead of calling the forced tool. SPIKE-005 saw this from
        // weaker models; it's a schema-conformance failure, not a transport failure, so it's
        // reported as one.
        return Effect.fail(
          new SchemaViolation({
            model: request.model,
            raw: String(message?.content ?? "").slice(0, 2000),
            detail: "the model replied in prose instead of calling the required tool",
          }),
        )
      }

      return Effect.try({
        try: () => JSON.parse(call.function.arguments) as unknown,
        catch: () =>
          new ProviderError({
            message: `Tool-call arguments were not valid JSON: ${call.function.arguments.slice(0, 500)}`,
          }),
      }).pipe(
        Effect.flatMap((json) =>
          Schema.decodeUnknownEffect(request.schema)(json).pipe(
            Effect.catchTag("SchemaError", (schemaError) =>
              Effect.fail(
                new SchemaViolation({
                  model: request.model,
                  raw: call.function.arguments,
                  detail: schemaError.message,
                }),
              ),
            ),
          ),
        ),
      )
    }),
    Effect.retry({
      // A missing/invalid API key will never succeed on retry — don't burn the retry budget on it.
      while: (error) => error._tag === "ProviderError" && error.message !== MISSING_API_KEY_MESSAGE,
      schedule: PROVIDER_ERROR_RETRY_SCHEDULE,
    }),
  )
}
