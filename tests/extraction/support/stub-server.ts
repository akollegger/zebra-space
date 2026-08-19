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
}

export interface StubExchange {
  readonly request: StubRequest
  respondWithJson(payload: unknown): void
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
  readonly response_format?: {
    readonly json_schema?: {
      readonly name?: string
    }
  }
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function chatCompletionResponse(model: string, content: string): unknown {
  return {
    id: "stub-completion",
    object: "chat.completion",
    created: 0,
    model,
    system_fingerprint: null,
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content },
      },
    ],
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
          const request: StubRequest = {
            model: body.model ?? "",
            schemaName: body.response_format?.json_schema?.name ?? "",
            systemPrompt: systemMessage?.content ?? "",
            userPrompt: userMessage?.content ?? "",
          }
          requests.push(request)

          const exchange: StubExchange = {
            request,
            respondWithJson(payload) {
              const responseBody = chatCompletionResponse(request.model, JSON.stringify(payload))
              res.writeHead(200, { "content-type": "application/json" })
              res.end(JSON.stringify(responseBody))
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
