// SPIKE-009: deterministic cross-clue reconciliation — turns a list of per-clue local
// VocabularyProposals into one canonical ExtractedVocabulary. Pure, offline-testable, no LLM
// call (an explicit scope decision for this pass — see SPIKE.md §2/§4: near-duplicate/fuzzy
// merging is deferred, not built here).

import { entitiesOfDomain, type Vocabulary } from "../../../SPIKE-008-per-clue-tool-call-decomposition/scripts/lib/clue-schema.ts"
import { sanitizeIdentifier } from "../../../../../src/compiler/compile.ts"
import type { VocabularyProposal } from "./propose-vocabulary.ts"

function normalize(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * Turns free-text model output into a safe identifier: OpenAI's real function-calling validator
 * requires tool NAMES to match `^[a-zA-Z0-9_-]+$` (found live, PR review pass —
 * "assignment__<domain.variable>"/"linkedAttributes__<type>" tool names, unchanged from
 * SPIKE-008, are built directly from whatever this module emits as domain.variable/entity.type,
 * so those fields must already be safe identifiers, not raw model text).
 *
 * Reuses `compile.ts`'s own `sanitizeIdentifier` directly rather than a hand-rolled equivalent
 * — found in review (PR #28): an earlier version of this function collapsed disallowed
 * characters into a HYPHEN and kept it as a distinct allowed character, but `sanitizeIdentifier`
 * converts every disallowed character (hyphens included) to `_` one at a time. Two proposal
 * strings differing only in hyphen-vs-underscore punctuation (`"a-b"` / `"a_b"`) therefore
 * stayed distinct under the old hand-rolled version, passing this module's own collision checks,
 * only to BOTH sanitize to the identical MiniZinc identifier once `compile.ts` processed them
 * for real — reproducing the exact class of bug this function exists to prevent. Calling the
 * real compiler's transform directly makes that impossible by construction, and additionally
 * inherits its leading-character and MiniZinc-reserved-word handling for free (guarantees this
 * hand-rolled version never had). `normalize()`'s lowercase-fold is applied FIRST and is a
 * deliberate additional layer on top — bucketing/collision-detection should treat case
 * differences as the same concept (the project's own explicit choice), which is strictly safe
 * to add on top of the compiler's own (case-sensitive) transform: it only ever merges MORE
 * aggressively than compile.ts's own collision behavior requires, never less.
 */
function sanitizeToken(s: string): string {
  return sanitizeIdentifier(normalize(s))
}

export interface ReconciledEntity {
  readonly id: string
  readonly type: string
  /** Every (normalized) surface form / canonicalIdGuess that merged into this entity. */
  readonly mergedFrom: readonly string[]
  readonly clueIndices: readonly number[]
}

export interface ReconciledDomain {
  readonly variable: string
  readonly entityType: string
  readonly values: readonly string[]
  readonly clueIndices: readonly number[]
  /** True when this domain was synthesized by step 5 (an ordering hint with no backing domain)
   * rather than proposed directly by any clue — kept for diagnostics/Findings, not used by
   * assembly. */
  readonly synthesized: boolean
}

export interface ReconciliationResult {
  readonly vocabulary: Vocabulary
  readonly entities: readonly ReconciledEntity[]
  readonly domains: readonly ReconciledDomain[]
  /** clueIndex -> ids of entities/domains(variable names) that clue contributed to something
   * that survived reconciliation — used by filter.ts to drop constraints from clues whose only
   * contribution never survived. */
  readonly survivingClueIndices: ReadonlySet<number>
}

/**
 * Steps 2-3 (SPIKE.md §2): exact-match merge of entity mentions within a normalized-typeGuess
 * bucket, on normalized canonicalIdGuess OR normalized surfaceForm.
 */
function mergeEntities(proposals: readonly VocabularyProposal[]): ReconciledEntity[] {
  const byType = new Map<string, { readonly key: string; readonly typeGuess: string; readonly clueIndices: number[]; readonly mergedFrom: Set<string> }[]>()

  for (const proposal of proposals) {
    for (const mention of proposal.entityMentions) {
      // Bucket by the SANITIZED type (not just normalize()'s lowercase+trim) — found live
      // (PZL-0002, second full run): two typeGuess variants that only become identical AFTER
      // stripping punctuation (e.g. differing only in trailing punctuation) previously bucketed
      // separately under normalize()'s coarser key, then both independently generated the same
      // id ("house1") once sanitizeToken() was applied at emission — bucketing and emission
      // must use the same granularity, or a collision this normalize()-only key can't see slips
      // through to duplicate ids.
      const type = sanitizeToken(mention.typeGuess)
      const key = normalize(mention.canonicalIdGuess ?? mention.surfaceForm)
      const bucket = byType.get(type) ?? []
      byType.set(type, bucket)
      const existing = bucket.find((e) => e.key === key)
      if (existing !== undefined) {
        existing.clueIndices.push(proposal.clueIndex)
        existing.mergedFrom.add(normalize(mention.surfaceForm))
        if (mention.canonicalIdGuess !== undefined) existing.mergedFrom.add(normalize(mention.canonicalIdGuess))
        continue
      }
      const mergedFrom = new Set([normalize(mention.surfaceForm)])
      if (mention.canonicalIdGuess !== undefined) mergedFrom.add(normalize(mention.canonicalIdGuess))
      bucket.push({ key, typeGuess: mention.typeGuess, clueIndices: [proposal.clueIndex], mergedFrom })
    }
  }

  const result: ReconciledEntity[] = []
  for (const [type, bucket] of byType) {
    const safeType = sanitizeToken(type)
    bucket.forEach((entry, i) => {
      result.push({
        id: `${safeType}${i + 1}`,
        type: safeType,
        mergedFrom: [...entry.mergedFrom],
        clueIndices: entry.clueIndices,
      })
    })
  }
  return result
}

interface DomainCandidate {
  readonly attributeNameGuess: string
  readonly entityTypeGuess: string
  readonly values: Set<string>
  readonly clueIndices: number[]
  readonly anyOrderingHint: boolean
}

/** Step 3: exact-match merge of domain mentions on (normalized attributeNameGuess, normalized
 * entityTypeGuess). Values accumulate as a union; anyOrderingHint is true if ANY merged mention
 * flagged it. */
function mergeDomainMentions(proposals: readonly VocabularyProposal[]): DomainCandidate[] {
  const byKey = new Map<string, DomainCandidate & { readonly values: Set<string>; readonly clueIndices: number[] }>()
  for (const proposal of proposals) {
    for (const mention of proposal.domainMentions) {
      const safeAttribute = sanitizeToken(mention.attributeNameGuess)
      const safeType = sanitizeToken(mention.entityTypeGuess)
      const key = `${safeAttribute}::${safeType}`
      const existing = byKey.get(key)
      if (existing !== undefined) {
        existing.values.add(mention.valueMentioned)
        existing.clueIndices.push(proposal.clueIndex)
        if (mention.isOrderingHint) (existing as { anyOrderingHint: boolean }).anyOrderingHint = true
        continue
      }
      byKey.set(key, {
        attributeNameGuess: safeAttribute,
        entityTypeGuess: safeType,
        values: new Set([mention.valueMentioned]),
        clueIndices: [proposal.clueIndex],
        anyOrderingHint: mention.isOrderingHint,
      })
    }
  }
  return [...byKey.values()]
}

/** Whether an existing domain candidate already looks like an ordered/numeric domain over this
 * entity type — a plain heuristic (every value parses as an integer) good enough to decide
 * "does an ordering domain already exist" without needing a dedicated "isOrdered" proposal
 * field. */
function looksOrdered(values: ReadonlySet<string>): boolean {
  return [...values].every((v) => /^\d+$/.test(v))
}

/**
 * Step 4 (entity-indexed vs. scalar, decided AFTER merging) + step 5 (synthesize a positional
 * domain for an ordering hint with no backing ordered domain — the PZL-0001 fix). Returns final
 * ReconciledDomain[] plus updated ReconciledEntity[] (step 5 may need to synthesize entities
 * when no independent entity set exists for the ordering hint's type — see inline comment).
 */
function resolveDomains(candidates: readonly DomainCandidate[], entities: readonly ReconciledEntity[]): { readonly domains: ReconciledDomain[]; readonly entities: ReconciledEntity[] } {
  const domains: ReconciledDomain[] = []
  let workingEntities = [...entities]

  // Genuinely reuses clue-schema.ts's exported entitiesOfDomain (not a parallel
  // reimplementation — found in review, PR #28: an earlier version had its own local
  // normalize()-based filter here that only claimed, in prose, to reuse the shared predicate).
  // entitiesOfDomain's signature expects a full Vocabulary + Domain; workingEntities is a plain
  // ReconciledEntity[] mid-construction, so this wraps it in a minimal Vocabulary-shaped value
  // (empty domains — entitiesOfDomain only ever reads .entities) and a Domain-shaped value
  // carrying just the entityType being queried, then maps the returned ids back to full
  // ReconciledEntity objects so every existing caller's shape (.length, iteration) is unchanged.
  const entitiesOfType = (type: string): readonly ReconciledEntity[] => {
    const ids = new Set(
      entitiesOfDomain(
        { entities: workingEntities.map((e) => ({ id: e.id, type: e.type })), domains: [] },
        { variable: "", entityType: type, values: [] },
      ),
    )
    return workingEntities.filter((e) => ids.has(e.id))
  }

  // Found live (PZL-0010, 2026-09-15): mergeDomainMentions buckets by (attributeName,
  // entityType), so the SAME attribute name proposed across DIFFERENT entity types (a model
  // calling several genuinely different things "arrival-order" — for "vehicle", "car",
  // "person", "pedestrian" in the same puzzle) produces multiple domain candidates that would
  // otherwise all get the identical `variable` string — MiniZinc rejects two array
  // declarations sharing one identifier ("identifier 'arrival_order' already defined"). Detect
  // any attributeName used by more than one distinct entityType and disambiguate ALL of that
  // name's candidates by suffixing the entity type, rather than only the second occurrence
  // onward (stable regardless of candidate order).
  const typesByAttribute = new Map<string, Set<string>>()
  for (const candidate of candidates) {
    const types = typesByAttribute.get(candidate.attributeNameGuess) ?? new Set<string>()
    types.add(candidate.entityTypeGuess)
    typesByAttribute.set(candidate.attributeNameGuess, types)
  }

  for (const candidate of candidates) {
    const collides = (typesByAttribute.get(candidate.attributeNameGuess)?.size ?? 0) > 1
    // sanitizeToken() again on the FINAL concatenated string, not just its already-sanitized
    // parts — found in review (PR #28, the same root cause as the sanitizeIdentifier switch
    // above): joining two already-safe tokens with a literal "-" reintroduces a character
    // compile.ts's own transform would later collapse to "_", so two candidates that only
    // differ in whether THIS join produced a hyphen or an underscore could still both resolve
    // to the identical MiniZinc identifier once compile.ts got to them.
    domains.push({
      variable: collides ? sanitizeToken(`${candidate.attributeNameGuess}-${candidate.entityTypeGuess}`) : candidate.attributeNameGuess,
      entityType: candidate.entityTypeGuess,
      values: [...candidate.values],
      clueIndices: candidate.clueIndices,
      synthesized: false,
    })
  }

  // Step 5: for every ordering-hinted candidate whose entity type has no domain that already
  // looks ordered, synthesize one. "No backing domain" is checked against the FULL set of
  // resolved domains so far (including other merged candidates for the same type), not just
  // the ordering-hinted one itself — a puzzle may separately declare a genuine position domain
  // that the ordering clue itself never mentioned by name.
  for (const candidate of candidates) {
    if (!candidate.anyOrderingHint) continue
    const sameTypeDomains = domains.filter((d) => normalize(d.entityType) === normalize(candidate.entityTypeGuess))
    const hasOrderedDomain = sameTypeDomains.some((d) => looksOrdered(new Set(d.values)))
    if (hasOrderedDomain) continue

    let entitiesForType = entitiesOfType(candidate.entityTypeGuess)
    // No independently-proposed entities exist for this type at all — this is exactly
    // PZL-0010's shape (an "arrival-order" attribute with no entity ever separately named):
    // synthesize one entity per distinct value the ordering-hinted candidate itself
    // accumulated, since those values ARE the participants being ordered.
    if (entitiesForType.length === 0) {
      const synthesizedType = candidate.entityTypeGuess
      const newEntities: ReconciledEntity[] = [...candidate.values].map((value, i) => ({
        id: `${normalize(synthesizedType)}_synth${i + 1}`,
        type: synthesizedType,
        mergedFrom: [normalize(value)],
        clueIndices: candidate.clueIndices,
      }))
      workingEntities = [...workingEntities, ...newEntities]
      entitiesForType = newEntities
    }

    const collides = (typesByAttribute.get(candidate.attributeNameGuess)?.size ?? 0) > 1
    const baseVariable = collides ? sanitizeToken(`${candidate.attributeNameGuess}-${candidate.entityTypeGuess}`) : candidate.attributeNameGuess
    const positionalVariable = sanitizeToken(`${baseVariable}-position`)
    if (!domains.some((d) => d.variable === positionalVariable)) {
      domains.push({
        variable: positionalVariable,
        entityType: candidate.entityTypeGuess,
        values: entitiesForType.map((_, i) => String(i + 1)),
        clueIndices: candidate.clueIndices,
        synthesized: true,
      })
    }
  }

  return { domains, entities: workingEntities }
}

/**
 * Found live (PZL-0010, 2026-09-15, second dry-run pass): a domain VALUE string and an ENTITY
 * TYPE string can independently sanitize to the same MiniZinc identifier (e.g. a "car" entity
 * TYPE alongside some other domain's "car" VALUE) — compile.ts emits an entity-type enum named
 * after the type (`enum car = {...}`) and, separately, a values-enum whose MEMBER is the value
 * itself (`enum Values_car = {car}`), and MiniZinc's single flat namespace rejects the
 * resulting duplicate identifier. Renaming every colliding entity type (never domain values,
 * which are real puzzle data, not something this spike should silently alter) is the
 * conservative fix — same "avoid a hard identifier collision" scope as the variable-name-
 * collision fix above, not new semantic disambiguation (recognizing "car" the type and "car"
 * the value as the same underlying concept is exactly the kind of near-duplicate resolution
 * this spike's Method explicitly defers to a future LLM-assisted pass).
 */
function renameCollidingEntityTypes(entities: readonly ReconciledEntity[], domains: readonly ReconciledDomain[]): { readonly entities: ReconciledEntity[]; readonly domains: ReconciledDomain[] } {
  const allValues = new Set(domains.flatMap((d) => d.values.map((v) => sanitizeToken(v))))
  const renamed = new Map<string, string>()
  for (const entity of entities) {
    const safeType = sanitizeToken(entity.type)
    if (allValues.has(safeType) && !renamed.has(entity.type)) {
      renamed.set(entity.type, sanitizeToken(`${entity.type}-type`))
    }
  }
  if (renamed.size === 0) return { entities: [...entities], domains: [...domains] }
  return {
    entities: entities.map((e) => ({ ...e, type: renamed.get(e.type) ?? e.type })),
    domains: domains.map((d) => ({ ...d, entityType: renamed.get(d.entityType) ?? d.entityType })),
  }
}

export function reconcile(proposals: readonly VocabularyProposal[]): ReconciliationResult {
  const mergedEntities = mergeEntities(proposals)
  const domainCandidates = mergeDomainMentions(proposals)
  const resolved = resolveDomains(domainCandidates, mergedEntities)
  const { domains, entities } = renameCollidingEntityTypes(resolved.entities, resolved.domains)

  const survivingClueIndices = new Set<number>()
  for (const e of entities) for (const i of e.clueIndices) survivingClueIndices.add(i)
  for (const d of domains) for (const i of d.clueIndices) survivingClueIndices.add(i)

  const vocabulary: Vocabulary = {
    entities: entities.map((e) => ({ id: e.id, type: e.type })),
    domains: domains.map((d) => ({ variable: d.variable, entityType: d.entityType, values: d.values })),
  }

  return { vocabulary, entities, domains, survivingClueIndices }
}
