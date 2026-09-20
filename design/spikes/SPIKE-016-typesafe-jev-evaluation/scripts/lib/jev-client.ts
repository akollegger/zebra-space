// SPIKE-016 §2 step 0: thin wrapper over @typesafe-ai/sdk's TypeSafeClient, adding per-call
// latency + token-usage logging (matching this spike line's own cost-accounting discipline,
// ADR-010's precedent in direct-solve.ts/harness.ts) without hiding the SDK's own shapes. Every
// sub-question's lib/*.ts calls `ask` directly rather than the raw client, so latency/usage
// tracking happens once, not duplicated four times.

import { type EntryType, type Questions, type SystemOneResult, TypeSafeClient } from "@typesafe-ai/sdk"

export interface JevCallResult<Q extends Questions> {
  readonly ok: true
  readonly result: SystemOneResult<Q>
  readonly latencyMs: number
}

export interface JevCallError {
  readonly ok: false
  readonly error: string
  readonly latencyMs: number
}

export type JevResult<Q extends Questions> = JevCallResult<Q> | JevCallError

let client: TypeSafeClient | undefined

/** Lazily constructs the shared client so importing this module never throws when
 * TYPESAFE_API_KEY is absent (e.g. an offline smoke test) — only calling `ask` does. */
function getClient(): TypeSafeClient {
  client ??= new TypeSafeClient()
  return client
}

/** One systemOne call, timed, never throwing — errors come back as `{ ok: false }` so a sweep
 * over many puzzles/clues/pairs can record a per-item failure without aborting the whole run,
 * the same discipline judge-substitution.ts's Effect.catch-before-runPromise establishes for the
 * existing frontier-model calls. */
export async function ask<const Q extends Questions>(state: EntryType, questions: Q): Promise<JevResult<Q>> {
  const start = performance.now()
  try {
    const result = await getClient().systemOne({ state, questions })
    return { ok: true, result, latencyMs: performance.now() - start }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), latencyMs: performance.now() - start }
  }
}

/** For an offline smoke test: swaps in a fake `ask` so a lib module's plumbing can be verified
 * with zero API cost. Each lib file accepts an injectable `askFn` parameter defaulting to `ask`
 * rather than importing `ask` unconditionally, so a smoke test can pass a stub instead of
 * mocking module internals. */
export type AskFn = typeof ask
