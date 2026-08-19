import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadEnvFileIfPresent } from "../../src/cli/load-env.ts"

// Deliberately never touches the real repo-root .env — every case here uses its own temp file,
// since a mistake in that file's path resolution could otherwise clobber a real credential.

function tempEnvPath(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "zebra-load-env-test-"))
  const path = join(dir, ".env")
  writeFileSync(path, content, "utf8")
  return path
}

test("loads a variable from the given .env file into process.env", () => {
  const path = tempEnvPath("ZEBRA_LOAD_ENV_TEST_VAR=from-dotenv\n")
  delete process.env.ZEBRA_LOAD_ENV_TEST_VAR
  loadEnvFileIfPresent(path)
  assert.equal(process.env.ZEBRA_LOAD_ENV_TEST_VAR, "from-dotenv")
  delete process.env.ZEBRA_LOAD_ENV_TEST_VAR
})

test("does not overwrite an already-set process.env value", () => {
  const path = tempEnvPath("ZEBRA_LOAD_ENV_TEST_VAR=from-dotenv\n")
  process.env.ZEBRA_LOAD_ENV_TEST_VAR = "from-shell"
  loadEnvFileIfPresent(path)
  assert.equal(process.env.ZEBRA_LOAD_ENV_TEST_VAR, "from-shell")
  delete process.env.ZEBRA_LOAD_ENV_TEST_VAR
})

test("does nothing, without throwing, when the file doesn't exist", () => {
  assert.doesNotThrow(() => {
    loadEnvFileIfPresent(join(tmpdir(), "zebra-load-env-test-does-not-exist", ".env"))
  })
})

test("propagates a non-ENOENT failure instead of swallowing it", () => {
  // A directory can never be loaded as a .env file — Node's loadEnvFile reliably rejects it
  // (with a TypeError, not a filesystem error, per Node 24) — a portable non-ENOENT failure,
  // unlike a chmod-based permissions test, which isn't guaranteed to be enforced the same way
  // in every sandboxed environment. Asserted generically by code, not by exact message text.
  const dirPath = mkdtempSync(join(tmpdir(), "zebra-load-env-test-"))
  assert.throws(() => loadEnvFileIfPresent(dirPath), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.notEqual((error as NodeJS.ErrnoException).code, "ENOENT")
    return true
  })
})
