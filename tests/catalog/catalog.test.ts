import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const CATALOG_DIR = join(HERE, "..", "..", "catalog")
const PUZZLES_DIR = join(CATALOG_DIR, "puzzles")
const README_PATH = join(CATALOG_DIR, "README.md")
const PUZZLE_FILENAME = /^PZL-\d{4}-.+\.md$/

const REQUIRED_FRONTMATTER_FIELDS = [
  "id",
  "title",
  "tier",
  "variables",
  "domains",
  "constraints",
  "source",
  "difficulty",
  "created",
]

function listPuzzleFiles(): string[] {
  if (!existsSync(PUZZLES_DIR)) return []
  return readdirSync(PUZZLES_DIR).filter((name) => PUZZLE_FILENAME.test(name))
}

function readFrontmatter(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, "utf8")
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  assert.ok(match, `${filePath} has no YAML frontmatter block`)
  const frontmatter = match[1]
  assert.ok(frontmatter !== undefined, `${filePath} has an empty frontmatter block`)
  const fields: Record<string, string> = {}
  for (const line of frontmatter.split("\n")) {
    const stripped = line.trim()
    if (stripped === "" || stripped.startsWith("#")) continue
    const separator = line.indexOf(":")
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    fields[key] = value
  }
  return fields
}

function countIndexRows(): number {
  if (!existsSync(README_PATH)) return -1
  const content = readFileSync(README_PATH, "utf8")
  return content
    .split("\n")
    .filter((line) => /^\s*\|\s*PZL-\d{4}\s*\|/.test(line) || /^\s*\|\s*\[PZL-\d{4}\]/.test(line))
    .length
}

test("SC-001: catalog/puzzles/ contains at least 3 puzzle files", () => {
  const files = listPuzzleFiles()
  assert.ok(
    files.length >= 3,
    `expected at least 3 files matching ${PUZZLE_FILENAME}, found ${files.length}`,
  )
})

test("SC-002: every puzzle file has complete frontmatter", () => {
  const files = listPuzzleFiles()
  assert.ok(files.length > 0, "no puzzle files found to check")

  const seenIds = new Set<string>()

  for (const file of files) {
    const fields = readFrontmatter(join(PUZZLES_DIR, file))

    for (const field of REQUIRED_FRONTMATTER_FIELDS) {
      assert.ok(
        field in fields && fields[field] !== "",
        `${file} is missing a non-empty "${field}" frontmatter field`,
      )
    }

    const expectedId = file.match(/^PZL-\d{4}/)?.[0]
    assert.ok(expectedId, `${file} filename does not start with a PZL-#### id`)
    assert.equal(fields.id, expectedId, `${file} frontmatter id must match filename id (${expectedId})`)
    assert.ok(!seenIds.has(fields.id), `duplicate puzzle id found: ${fields.id}`)
    seenIds.add(fields.id)
  }
})

test("SC-003: catalog/README.md has exactly one row per puzzle file", () => {
  const files = listPuzzleFiles()
  const rowCount = countIndexRows()
  assert.equal(
    rowCount,
    files.length,
    `catalog/README.md has ${rowCount} puzzle rows, but catalog/puzzles/ has ${files.length} files`,
  )
})
