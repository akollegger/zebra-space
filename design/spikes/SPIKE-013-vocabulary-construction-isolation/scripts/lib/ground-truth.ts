// SPIKE-013 §2 step 1: expected vocabulary shape for the determinate subset of SPIKE-008's
// 14-puzzle sample (9 of 14 — PZL-0022 is a COP, PZL-0028 ambiguous, PZL-0033 subjective,
// PZL-0015/0018 non-problem; "correct" has no single meaning for those five, so this spike
// scores only the nine where it does).
//
// Originally hand-derived and hardcoded here directly; now read from each puzzle's own
// `groundTruth` frontmatter field (catalog/README.md's "groundTruth (optional)" section) —
// preserving the same hand-verification (against SPIKE-011's real, known-successful
// full-critic extractions) durably in the catalog itself, so any future spike/eval can reuse it
// without re-deriving it or re-reading this spike-local file. `GroundTruthEntry`/`groundTruthFor`
// keep their original shape so run-comparison.ts needed zero changes; `ExpectedDomain` itself was
// reshaped (see `DomainAlternative` below) after a real scoring bug was found live (2026-09-16).
//
// Two puzzles need an explicit note on why the shape isn't a single obvious answer (kept on the
// frontmatter itself now, not just here):
// - PZL-0010's real successful extraction ALSO declared a second domain ("arrivalTime") beyond
//   what the answer key's own "order" key requires — a legitimate, even more complete
//   vocabulary. Scoring is a COVERAGE check (every expected domain must be found), never an
//   exact-count match, so an extraction with MORE domains than listed here is never penalized —
//   mirrors ADR-007 §2.2's own "subset, not exact match" lesson for the real grader.
// - PZL-0038's real successful extraction modeled the INVERSE of the answer key's own shape
//   (entities = the 5 animals, one domain "pen" ranging 1..5 — rather than entities = 5 pens,
//   domain "animal") — an equally valid isomorphic representation, encoded as two separate
//   `alternatives`, each pairing its own name with its own values (never crossed).

import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"

/** One atomic, self-consistent (name, values) pairing — checked as a PAIR, never a name from one
 * alternative crossed with another alternative's values (see score.ts's `outer` loop comment).
 * `names` may still list more than one acceptable spelling for the SAME value set (PZL-0001's
 * "cigarette"/"smoke", PZL-0011's "outcome"/"decision") — that's safe because every name in the
 * list maps to the identical `values`, so there's no cross-pairing to confuse. What's NOT safe is
 * letting two alternatives that each have their OWN distinct values share one flat name/valueSet
 * list, which is exactly the bug this shape replaces (found live 2026-09-16: a domain named
 * "pen" holding PZL-0038's animal names scored `structurallyCorrect: true` under the old flat
 * `{names, valueSets}` shape, which matched names and value-sets independently). */
export interface DomainAlternative {
  readonly names: readonly string[]
  readonly values: readonly string[]
}

export interface ExpectedDomain {
  /** One or more mutually exclusive valid (name, values) pairings — a produced domain matches if
   * it matches ANY ONE alternative in full (subset/coverage on that alternative's own values,
   * not exact-count — extra values are fine). PZL-0038 has two alternatives because either of an
   * isomorphic pair of representations is correct; every other puzzle here has exactly one. */
  readonly alternatives: readonly DomainAlternative[]
}

export interface GroundTruthEntry {
  readonly puzzleId: string
  /** Size of the puzzle's primary entity axis — the row count clues actually reference by
   * identity. Not the domain-value count (a domain's own values are listed in `domains`
   * separately). */
  readonly expectedEntityAxisSize: number
  /** Every domain listed here must be found among the produced domains (coverage, not exact
   * match) for the puzzle to score as structurally correct — see score.ts. */
  readonly domains: readonly ExpectedDomain[]
}

const PUZZLES_DIR = new URL("../../../../../catalog/puzzles/", import.meta.url)

interface RawGroundTruth {
  readonly entityAxisSize: number
  // Named `expectedDomains` in frontmatter, not `domains` — tests/catalog/catalog.test.ts reads
  // frontmatter with a deliberately naive flat line-scanner (ADR-001's format is flat scalars),
  // so a nested key reusing the top-level `domains` count field's name silently overwrote it with
  // an empty string (found live 2026-09-16, CI failure on PR #31 for exactly this puzzle-catalog
  // reason). `GroundTruthEntry.domains` (the parsed, in-memory shape) keeps its name — only the
  // YAML key changed.
  readonly expectedDomains: readonly { readonly alternatives: readonly DomainAlternative[] }[]
}

function loadGroundTruth(): ReadonlyMap<string, GroundTruthEntry> {
  const dir = fileURLToPath(PUZZLES_DIR)
  const map = new Map<string, GroundTruthEntry>()
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue
    const raw = readFileSync(new URL(file, PUZZLES_DIR), "utf8")
    const match = raw.match(/^---\n([\s\S]*?)\n---\n/)
    if (match === null) continue
    const frontmatter = parse(match[1]!) as { id?: string; groundTruth?: RawGroundTruth }
    if (frontmatter.id === undefined || frontmatter.groundTruth === undefined) continue
    map.set(frontmatter.id, {
      puzzleId: frontmatter.id,
      expectedEntityAxisSize: frontmatter.groundTruth.entityAxisSize,
      domains: frontmatter.groundTruth.expectedDomains,
    })
  }
  return map
}

// Read once, at module load — the catalog is static within a single spike run.
const GROUND_TRUTH = loadGroundTruth()

export function groundTruthFor(puzzleId: string): GroundTruthEntry | undefined {
  return GROUND_TRUTH.get(puzzleId)
}
