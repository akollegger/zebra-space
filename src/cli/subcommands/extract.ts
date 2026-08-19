import { readFile } from "node:fs/promises"
import { buildCommand } from "@stricli/core"
import { Effect } from "effect"
import { compile } from "../../compiler/compile.ts"
import type { CompileError } from "../../compiler/types.ts"
import { extract } from "../../extraction/extract.ts"
import type { ExtractionError } from "../../extraction/types.ts"

// Stricli's default caseStyle ("original") does not auto-convert camelCase flag keys to
// kebab-case CLI tokens — the flag key IS the CLI flag name. ADR-003 §2.6 commits to
// `--frontier-model` specifically, so that flag is keyed with a literal hyphen rather than
// camelCase, scoped to just this command (not a change to main.ts's shared run() config).
interface ExtractFlags {
  readonly json: boolean
  readonly model?: string
  readonly "frontier-model"?: string
}

function resolveModel(flag: string | undefined, envVar: string): string | undefined {
  return flag ?? process.env[envVar]
}

function formatExtractionError(error: ExtractionError): string {
  switch (error._tag) {
    case "ProviderError":
      return `The extraction service could not be reached or failed unexpectedly: ${error.message}`
    case "SchemaViolation":
      return (
        `The model's response did not match the expected structure: ${error.schemaError.message}\n` +
        `Raw response: ${error.raw}`
      )
    case "CriticRejected":
      return [
        "The extraction could not be validated as a faithful translation after every attempt:",
        ...error.attempts.map((attempt, index) => {
          const issues = attempt.critique.issues.map((issue) => `    - ${issue}`).join("\n")
          return `  Attempt ${index + 1} (${attempt.model}):\n${issues}`
        }),
      ].join("\n")
  }
}

function formatCompileError(error: CompileError): string {
  return `The extraction was faithful, but could not be compiled to MiniZinc: ${error.reason}`
}

async function extractCommandFunc(flags: ExtractFlags, puzzlePath: string): Promise<void> {
  const prose = await readFile(puzzlePath, "utf8")
  const model = resolveModel(flags.model, "ZEBRA_MODEL")
  const frontierModel = resolveModel(flags["frontier-model"], "ZEBRA_FRONTIER_MODEL")

  const result = await Effect.runPromise(
    extract(prose, { model, frontierModel }).pipe(
      Effect.mapError((error) => new Error(formatExtractionError(error))),
    ),
  )

  if (flags.json) {
    console.log(JSON.stringify({ extractedCsp: result.extractedCsp, model: result.model }))
    return
  }

  const mzn = await Effect.runPromise(
    compile(result.extractedCsp).pipe(Effect.mapError((error) => new Error(formatCompileError(error)))),
  )

  console.log(`% Extracted from ${puzzlePath} using ${result.model}\n${mzn}`)
}

export const extractCommand = buildCommand({
  func: extractCommandFunc,
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        { brief: "Path to a natural-language puzzle file", parse: String, placeholder: "puzzle.md" },
      ],
    },
    flags: {
      json: {
        kind: "boolean",
        brief: "Print the raw extracted structure instead of a compiled MiniZinc model",
      },
      model: {
        kind: "parsed",
        brief: "Model id for the default (cheap) tier (env: ZEBRA_MODEL)",
        parse: String,
        optional: true,
      },
      "frontier-model": {
        kind: "parsed",
        brief: "Model id for the escalation tier (env: ZEBRA_FRONTIER_MODEL)",
        parse: String,
        optional: true,
      },
    },
  },
  docs: {
    brief: "Extract a solvable constraint model from a natural-language puzzle",
  },
})
