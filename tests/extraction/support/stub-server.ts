import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

// research.md Finding 2: the default test suite stubs the OpenRouter provider boundary at the
// HTTP layer (not just the module boundary) so both unit-level extraction tests and CLI-level
// subprocess tests (via ZEBRA_OPENROUTER_BASE_URL_OVERRIDE) share the exact same fake, with no
// live network call anywhere in the default `pnpm test` run.

export interface StubRequest {
  readonly model: string
  readonly schemaName: string
  readonly systemPrompt: string
  readonly userPrompt: string
  /** The JSON Schema actually sent as the forced tool's `parameters` (ADR-004 §2.1/§2.7). */
  readonly toolParameters: unknown
}

export interface StubExchange {
  readonly request: StubRequest
  /** Reply as the model calling the forced tool with `payload` as its arguments. */
  respondWithJson(payload: unknown): void
  /** Reply with prose and no tool call at all — the SchemaViolation path SPIKE-005 observed. */
  respondWithProse(text: string): void
  respondWithError(statusCode: number, message: string): void
}

export type StubHandler = (exchange: StubExchange, callIndex: number) => void

export interface StubServer {
  readonly baseUrl: string
  readonly requests: readonly StubRequest[]
  close(): Promise<void>
}

interface RawChatBody {
  readonly model?: string
  readonly messages?: ReadonlyArray<{ readonly role: string; readonly content: string }>
  readonly tools?: ReadonlyArray<{
    readonly function?: { readonly name?: string; readonly parameters?: unknown }
  }>
  readonly tool_choice?: { readonly function?: { readonly name?: string } }
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function toolCallResponse(model: string, toolName: string, args: string): unknown {
  return {
    id: "stub-completion",
    object: "chat.completion",
    created: 0,
    model,
    system_fingerprint: null,
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_stub", type: "function", function: { name: toolName, arguments: args } },
          ],
        },
      },
    ],
  }
}

function proseResponse(model: string, content: string): unknown {
  return {
    id: "stub-completion",
    object: "chat.completion",
    created: 0,
    model,
    system_fingerprint: null,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
  }
}

/** Starts a local stand-in for OpenRouter's `/chat/completions` endpoint on an ephemeral port. */
export function startStubServer(handler: StubHandler): Promise<StubServer> {
  const requests: StubRequest[] = []
  let callIndex = 0

  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      readBody(req)
        .then((raw) => {
          const body = JSON.parse(raw) as RawChatBody
          const systemMessage = body.messages?.find((m) => m.role === "system")
          const userMessage = body.messages?.find((m) => m.role === "user")
          const tool = body.tools?.[0]?.function
          const request: StubRequest = {
            model: body.model ?? "",
            // The forced tool's name carries what response_format's json_schema.name used to
            // (ADR-004 §2.1) — tests still discriminate extraction vs. critique by this.
            schemaName: body.tool_choice?.function?.name ?? tool?.name ?? "",
            systemPrompt: systemMessage?.content ?? "",
            userPrompt: userMessage?.content ?? "",
            toolParameters: tool?.parameters,
          }
          requests.push(request)

          const exchange: StubExchange = {
            request,
            respondWithJson(payload) {
              const responseBody = toolCallResponse(
                request.model,
                request.schemaName,
                JSON.stringify(payload),
              )
              res.writeHead(200, { "content-type": "application/json" })
              res.end(JSON.stringify(responseBody))
            },
            respondWithProse(text) {
              res.writeHead(200, { "content-type": "application/json" })
              res.end(JSON.stringify(proseResponse(request.model, text)))
            },
            respondWithError(statusCode, message) {
              res.writeHead(statusCode, { "content-type": "application/json" })
              res.end(JSON.stringify({ error: { message } }))
            },
          }

          handler(exchange, callIndex)
          callIndex += 1
        })
        .catch((error: unknown) => {
          res.writeHead(500, { "content-type": "application/json" })
          res.end(JSON.stringify({ error: { message: String(error) } }))
        })
    })

    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise((res) => server.close(() => res())),
      })
    })
  })
}
