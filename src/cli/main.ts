#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  buildApplication,
  buildRouteMap,
  help,
  run,
  text_en,
  version,
  type StricliProcess,
} from "@stricli/core"
import { loadEnvFileIfPresent } from "./load-env.ts"
import { extractCommand } from "./subcommands/extract.ts"
import { solve } from "./subcommands/solve.ts"

// Auto-load .env (repo root, resolved from this file's own location — not CWD, since `zebra`
// may run from anywhere) so ZEBRA_MODEL/ZEBRA_FRONTIER_MODEL/OPENROUTER_API_KEY can live there
// instead of requiring a manual `export` every session. A real shell export still wins over
// .env (loadEnvFileIfPresent's own doc comment), matching ADR-003 §2.6's flag > env var >
// default precedence, with .env just providing that env var's value.
loadEnvFileIfPresent(fileURLToPath(new URL("../../.env", import.meta.url)))

const packageJsonPath = fileURLToPath(new URL("../../package.json", import.meta.url))
const { version: currentVersion } = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  readonly version: string
}

const routes = buildRouteMap({
  routes: { solve, extract: extractCommand },
  docs: { brief: "Tools for working with zebra puzzles" },
})

const formatting = {
  useAliasInUsageLine: false,
  onlyRequiredInUsageLine: false,
  caseStyle: "original" as const,
}

function listAvailableCommands(): string {
  return routes
    .getAllEntries()
    .map((entry) => entry.name.original)
    .join(", ")
}

const app = buildApplication(
  routes,
  {
    name: "zebra",
    localization: {
      text: {
        ...text_en,
        // FR-011: an unrecognized subcommand must list available subcommands — Stricli's
        // default only proposes near-miss corrections, which misses unrelated typos entirely.
        noCommandRegisteredForInput: (args) =>
          `${text_en.noCommandRegisteredForInput(args)}\nAvailable commands: ${listAvailableCommands()}`,
      },
    },
  },
  {
    // spec.md Edge Cases: no subcommand at all should behave like top-level --help, not a
    // silent no-op — Stricli's own default for a bare route map is to do nothing and exit 0.
    help: help({ brief: "Print help information and exit", formatting, defaultForRouteMap: true }),
    version: version({ brief: "Print version information and exit", info: { currentVersion } }),
  },
)

// Node's own `process.exitCode` type (`string | number | null | undefined`) is wider than
// Stricli's declared `StricliProcess.exitCode` (`string | number | null`) under
// exactOptionalPropertyTypes — the real process fully satisfies Stricli's runtime contract
// (it only ever reads/writes those three narrower values), so this is a type-only mismatch,
// not a behavioral one. Must stay the *real* `process` object, not a substitute — Stricli
// controls the actual exit code by writing to it.
await run(app, process.argv.slice(2), { process: process as StricliProcess })
