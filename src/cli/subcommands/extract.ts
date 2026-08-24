import { readFile } from "node:fs/promises"
import { buildCommand } from "@stricli/core"
import { Effect } from "effect"
import { compile } from "../../compiler/compile.ts"
import type { CompileError } from "../../compiler/types.ts"
import { extract } from "../../extraction/extract.ts"
import type { ExtractionError } from "../../extraction/types.ts"
import { UserFacingError } from "../user-facing-error.ts"

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
  // `||`, not `??`: an env var set to the empty string (e.g. `ZEBRA_MODEL=` left blank in .env)
  // must fall through to the built-in default, not override it with "".
  return flag || process.env[envVar] || undefined
}

/**
 * Every message here names what happened, why, and what the user can actually do about it —
 * these are the only diagnosis a CLI user gets (spec.md SC-003). The `SchemaRejected` case in
 * particular exists because SPIKE-005 found provider schema incompatibilities are real, silent,
 * and completely opaque from the raw upstream error text.
 */
function formatExtractionError(error: ExtractionError): string {
  switch (error._tag) {
    case "ProviderError":
      return `The extraction service could not be reached or failed unexpectedly: ${error.message}`
    case "SchemaRejected":
      return [
        `The model "${error.model}" rejected the extraction schema itself, so no extraction was attempted.`,
        "",
        "This is a provider compatibility problem, not a problem with your puzzle: the model's",
        "provider does not accept some part of the schema shape this tool sends. It is not fixed",
        "by retrying.",
        "",
        "What to try:",
        `  - Use a different model, e.g. --model openai/gpt-4o-mini (or set ZEBRA_MODEL).`,
        "  - If this model previously worked, its provider's schema support may have changed;",
        "    please report it, including the provider message below.",
        "",
        `Provider said: ${error.providerMessage.slice(0, 600)}`,
      ].join("\n")
    case "SchemaViolation":
      return [
        `The model "${error.model}" replied, but not in the required structure — ${error.detail}.`,
        "",
        "This usually means the model is too weak to follow the schema reliably rather than that",
        "anything is misconfigured. Retrying may succeed; a stronger model is more likely to.",
        "",
        "What to try:",
        "  - Re-run the command (responses vary between attempts).",
        `  - Use a stronger model, e.g. --model anthropic/claude-sonnet-4.5 (or set ZEBRA_MODEL).`,
        "",
        `Raw response: ${error.raw.slice(0, 600)}`,
      ].join("\n")
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
  let prose: string
  try {
    prose = await readFile(puzzlePath, "utf8")
  } catch (error) {
    throw new UserFacingError(`Could not read puzzle file "${puzzlePath}": ${(error as Error).message}`)
  }
  const model = resolveModel(flags.model, "ZEBRA_MODEL")
  const frontierModel = resolveModel(flags["frontier-model"], "ZEBRA_FRONTIER_MODEL")

  const result = await Effect.runPromise(
    extract(prose, { model, frontierModel }).pipe(
      Effect.mapError((error) => new UserFacingError(formatExtractionError(error))),
    ),
  )

  if (flags.json) {
    console.log(JSON.stringify({ extractedCsp: result.extractedCsp, model: result.model }))
    return
  }

  const mzn = await Effect.runPromise(
    compile(result.extractedCsp).pipe(Effect.mapError((error) => new UserFacingError(formatCompileError(error)))),
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
