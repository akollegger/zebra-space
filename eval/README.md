# Extraction Eval

Runs every catalog puzzle (`catalog/puzzles/`) through the full extract → compile → solve
pipeline ([ADR-004](../design/adr/ADR-004-llm-extraction-critic-loop.md)/
[ADR-005](../design/adr/ADR-005-extractedcsp-mzn-compiler.md)) and compares the result against
`answer-keys.json`'s known-correct solutions — a broader, ground-truth-checked measurement than
`tests/extraction/live.test.ts`, which only samples 5 of 14 puzzles and checks a weaker signal
(the critic accepted it, not that it solves to the right answer).

## Running it

```bash
pnpm eval                                   # all 14 catalog puzzles
node scripts/eval-extraction.ts PZL-0004    # just one, for debugging
node scripts/eval-extraction.ts --model openai/gpt-4o-mini --frontier-model anthropic/claude-sonnet-4.5
```

Requires `OPENROUTER_API_KEY` (auto-loaded from a repo-root `.env`, see root README) and a
working `minizinc` install. **Not a CI gate** — it makes real, billed LLM calls, and extraction is
non-deterministic ([SPIKE-004](../design/spikes/SPIKE-004-llm-based-extraction/SPIKE.md)), so a
single run's pass rate is a noisy sample, not a stable regression signal. Puzzles run
sequentially, not in parallel, to stay easy on rate limits/cost.

## Output

- `results.md` (committed) — one append-only section per run: date, git commit, models used, and
  a per-puzzle outcome table. The durable history to compare across runs/changes.
- `results/<run-id>.json` (gitignored) — full raw detail for one run: extracted CSP, compiled
  `.mzn`, solve result, and comparison detail per puzzle. Use this to actually debug a failure;
  `results.md` only has the summary.

## Answer keys (`answer-keys.json`)

Ground truth, one entry per puzzle id (`title`, `answer`, `notes`). Moved here from
`specs/001-catalog-seeding/` (originally authored per that spec's FR-009 verification
requirement) and reformatted from Markdown to JSON so it's machine-comparable. `notes` keeps the
original hand-derivation reasoning for human review. `answer`'s shape is deliberately
heterogeneous — arrays, flat maps, digit maps, grids, orderings, subsets — matching the seed
catalog's own mix of constraint shapes (not every puzzle is a zebra-grid puzzle), not a single
uniform schema.

## Known limitations

**The comparison is a value-presence check, not a correctness proof.** `flatten()`/
`compareAnswer()` in `scripts/eval-extraction.ts` reduce both the answer key's expected structure
and the solver's actual assignment to a flat set of string tokens, then check the expected tokens
are a subset of the actual ones. This is deliberately generic — one function handles every answer
shape without per-puzzle logic — but it has real, documented blind spots:

- **Array-pairing is unchecked.** For puzzles whose answer is a set of parallel arrays
  (PZL-0001, PZL-0002, PZL-0006, PZL-0008, PZL-0010), the check confirms the right *vocabulary* of
  values is present, not that values are paired/ordered correctly. A `MATCH` there means "uniquely
  solved, used the right values," not a full proof every value is bound to the right entity.
  Building full ordinal-correspondence matching was judged disproportionate for a first-pass
  eval; `solve()` already independently confirms `UniquelySolvable`, so a false `MATCH` here needs
  both the structure and the vocabulary to align by accident.
  `recoverEntityKeyedArrays()` (`scripts/eval-extraction.ts`) closes one specific instance of this
  found live on PZL-0010: MiniZinc's own JSON output for an entity-indexed array is purely
  positional, so an answer key phrased as a flat list of entity names could never match at all —
  the vocabulary was structurally missing, not just unpaired. Re-zipping the solved array against
  the same entities `compile.ts` itself indexed it by recovers that vocabulary, without adding
  real ordinal-pairing verification — PZL-0006 (a mapping keyed by row numbers, not entity ids)
  remains a genuine, unaddressed instance of this same limitation.
- **Exact string matching only, no fuzzy/semantic matching.** If the LLM's chosen entity name
  differs from the answer key's phrasing (e.g. `book_set` vs. the answer key's "hardcover book
  set"), a genuinely correct solve can register as `MISMATCH`.
- **Top-level object keys are excluded from comparison on both sides** — only their values are
  flattened. Top-level keys are just field-name choices (the answer key's own authored JSON
  structure, or the LLM's independently-invented domain-variable names), not reliable
  cross-comparable puzzle vocabulary.

**Known, currently-unaddressed pipeline gaps** — real representational limits in ADR-004's
`ExtractedCsp`/ADR-005's compiler, not eval-script issues, found by running this harness against
the full catalog (also noted in each ADR's Consequences section):

- **Relational chaining between two anonymous entities** (e.g. "the green house is immediately
  right of the ivory house," where neither house is otherwise named) — `adjacency` needs a shared
  numeric positional domain between its two entities, which doesn't exist when both are only
  identified by attribute rather than an ordinal fixed elsewhere. Affects PZL-0001/0002/0009
  intermittently, depending on which clues a given extraction happens to lean on. Already flagged
  in ADR-004 §2.2/§4.
- **No "universal rule table" constraint kind** — puzzles whose logic is a small set of static,
  entity-independent facts (Rock-Paper-Scissors' "paper beats rock, rock beats scissors, scissors
  beats paper," PZL-0003) have no clean home in the current constraint-kind taxonomy. `relation`
  facts exist but are only consumed by `derivedRule`'s fact-driven expansion mode, which expands
  per matching *entity pair*, not per free-variable assignment against a static table.
- **Residual model non-determinism** — even after this session's schema/compiler fixes (entity-
  scoped `variableRef`, expression-valued `target`, more/n-ary arithmetic operators, adjacency
  relation-name normalization, enum-collision fix — see ADR-005 §4), occasional extractions still
  confuse an arithmetic `op` with the constraint's `comparator`, or reference an undeclared
  variable. Consistent with SPIKE-004's already-documented non-determinism finding; a residual
  rate is expected, not chased to zero within this branch's scope.

Fixing any of the above is real follow-on work (a new constraint kind, a chaining-aware compiler
pass, or a fuzzy comparison layer) — deliberately left for a future ADR/spec rather than expanding
this branch's scope.
