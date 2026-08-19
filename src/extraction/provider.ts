import { OpenRouter } from "@openrouter/sdk"
import { OpenRouterError } from "@openrouter/sdk/models/errors"
import { Effect, Schema } from "effect"
import { ProviderError, SchemaViolation } from "./types.ts"

const DEFAULT_TIMEOUT_MS = 60_000

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
    return "OPENROUTER_API_KEY is missing or invalid (401 Unauthorized)."
  }
  return error instanceof Error ? error.message : String(error)
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
 * A single schema-constrained, non-streaming chat completion (ADR-004 §2.1/§2.3): one request,
 * one response, the whole payload decoded and validated against `request.schema` in that same
 * turn — not an agentic tool-calling loop (§2.3's MVP scoping note).
 */
export function requestStructuredCompletion<A>(
  request: StructuredCompletionRequest<A>,
): Effect.Effect<A, ProviderError | SchemaViolation> {
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
            responseFormat: {
              type: "json_schema",
              jsonSchema: { name: request.schemaName, schema: request.jsonSchema, strict: true },
            },
          },
        },
        // ADR-004 §2.3: retries/timeouts are this pipeline's own Effect.retry/Effect.timeout —
        // the SDK's own built-in retry loop is disabled so it can't silently keep retrying
        // underneath Effect.timeout below (verified hands-on: with the SDK's default retry
        // config left on, a request that fails immediately at the HTTP layer still took the
        // full external timeout to surface, because the SDK kept retrying in the background).
        { retries: { strategy: "none" }, timeoutMs },
      ),
    catch: (error) => new ProviderError({ message: errorMessage(error) }),
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

      const content = response.choices[0]?.message.content
      if (typeof content !== "string") {
        return Effect.fail(new ProviderError({ message: "Response contained no text content to decode." }))
      }

      return Effect.try({
        try: () => JSON.parse(content) as unknown,
        catch: () => new ProviderError({ message: `Response content was not valid JSON: ${content}` }),
      }).pipe(
        Effect.flatMap((json) =>
          Schema.decodeUnknownEffect(request.schema)(json).pipe(
            Effect.catchTag("SchemaError", (schemaError) =>
              Effect.fail(new SchemaViolation({ raw: content, schemaError })),
            ),
          ),
        ),
      )
    }),
  )
}
