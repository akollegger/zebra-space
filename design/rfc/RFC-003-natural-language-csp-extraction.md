---
id: RFC-003
title: Natural-Language Puzzle to CSP Extraction
status: draft
created: 2026-08-18
adrs: []
---

# RFC-003: Natural-Language Puzzle to CSP Extraction

## 1. Summary

Zebra Space can now produce prose puzzles (`catalog/puzzles/`, [ADR-001](../adr/ADR-001-catalog-format-seeding.md))
and solve hand-authored constraint models (`src/solver/`, [ADR-002](../adr/ADR-002-adopt-minizinc-solver.md)).
The missing link is turning a puzzle's prose clues into a constraint satisfaction problem
automatically. This RFC scopes that extraction step and compares candidate high-level approaches.

## 2. Problem / Motivation

Every constraint model in `catalog/mzn/` today is hand-translated from its corresponding prose
puzzle (`catalog/mzn/README.md`), and [RFC-002](RFC-002-constraint-solver-selection.md) Non-Goal 2
explicitly excluded building an automatic prose-to-MiniZinc compiler as out of scope for solver
selection. That leaves a gap: nothing in this project reads a puzzle's clue text and produces a
structured constraint representation. Without it, the pipeline described in the project's mission
(generate → model as CSP → represent as graph → solve) has a manual step in the middle that
doesn't scale past a small hand-curated catalog, and blocks any future work on the graph
representation (`@relateby/pattern`), since there's no automated source of constraints to build
graphs from.

## 3. Goals

- Given a puzzle's prose clue text (the format already seeded in `catalog/puzzles/PZL-NNNN-*.md`),
  produce a structured representation of its entities, attribute domains, and constraints.
- Cover the clue phrasings already present in the seeded catalog (`catalog/puzzles/`) as the
  *initial* correctness bar for evaluating a strategy — the catalog is a seed for that
  evaluation, not the extent of the problem space. Beyond today's catalog, the near-term target
  is reasonable, well-intentioned natural-language phrasing of zebra-style clues generally,
  within the strict/explicit tier (stopping short of the arbitrary/adversarial phrasing the last
  item in §4 Non-Goals excludes). Headroom toward the vague/contextual and subjective/preference
  clue types [RFC-001](RFC-001-parameterizable-puzzle-generation.md) §5.1 treats as future
  generation work is a forward-looking property to weigh when choosing a strategy (Appendix §9
  criterion 6), not a requirement of this RFC's initial scope.
- Produce output that is a plausible input to both known downstream consumers: a MiniZinc model
  (per the `.mzn` convention in `catalog/mzn/README.md`) and, eventually, a graph representation
  built with `@relateby/pattern`.
- Make wrong or partial extractions detectable rather than silently wrong — e.g. by surfacing
  confidence, unmatched clues, or ambiguity rather than guessing silently.

## 4. Non-Goals

- Generating new prose puzzles — that's [RFC-001](RFC-001-parameterizable-puzzle-generation.md).
- CSP → NL generation — synthesizing or co-emitting prose from an explicit constraint model is
  the mirror-image problem to this RFC's NL → CSP extraction, and is expected to be its own
  future RFC (see Alternatives Considered, §6), not something this RFC designs or precludes.
- Building or selecting the constraint solver — that's [RFC-002](RFC-002-constraint-solver-selection.md).
- Designing the graph representation itself (schema, `@relateby/pattern` usage) — this RFC only
  needs the extraction output to be *compatible* with a future graph representation, not to design
  it.
- Handling puzzle prose outside the zebra-puzzle family (e.g. open-domain logic puzzles with
  unbounded clue vocabulary) — scope is bounded by the clue patterns the catalog already contains
  or plans to contain.
- Achieving deterministic, 100%-accurate extraction on arbitrary/adversarial phrasing. The bar is
  the catalog's actual clue variety, not worst-case natural language.

## 5. Proposed Approach (high-level)

### 5.1 What "extraction" produces

Independent of *how* it's done, extraction needs to bridge prose clues to two known downstream
shapes: a MiniZinc-compatible model (variables with finite domains, constraints) and a future
graph representation. The intermediate representation this RFC scopes is the structured
constraint model itself — entities, attributes, domains, and constraints in some solver-agnostic
form — not either downstream serialization directly. Candidate ADR work would define this
representation concretely; here the goal is just establishing that it must be expressive enough
for both consumers, and validated well enough to catch when a clue was missed or misread rather
than silently dropped.

### 5.2 Candidate extraction strategies

The design space is closer to a five-tier spectrum than a single three-way choice, ordered
roughly by how much of the extraction work is deterministic/hand-authored versus learned/
inferred:

- **Rule-based / grammar parsing** — a clue-pattern library (regex, a PEG grammar via e.g.
  Peggy/nearley, or a parser-combinator/grammar DSL like Chevrotain) tailored to the phrasings
  zebra-puzzle clues actually use (e.g. "X is immediately to the right of Y", "X drinks Y", "X
  lives next to Y"). Fully deterministic, zero runtime dependency beyond the parser, trivially
  offline/CI-testable. Brittleness scales with phrasing diversity: each new variant needs an
  explicit rule, and grammars get harder to maintain as that variety grows (see Appendix §9.1 for
  whether this is sufficient on its own or better treated as a fast path).
- **General-purpose NLP libraries** — tokenization/POS-tagging/pattern-matching libraries used as
  a toolkit rather than a bespoke grammar. JS/TS-native options (e.g. wink-nlp, compromise.js)
  run in-process with no subprocess or second language runtime; wink-nlp's custom entity/pattern
  matcher in particular is well suited to a bounded clue vocabulary. Python-ecosystem options
  (e.g. spaCy, with its `Matcher`/`EntityRuler` rule engine) offer more mature statistical NER and
  true dependency parsing, but would need a subprocess/sidecar bridge — architecturally similar
  to how `src/solver/solve.ts` already shells out to the `minizinc` CLI, but a second language
  runtime is a materially larger footprint than a pure-npm option for a capability (dependency
  trees) this bounded grammar may not actually need.
- **Small specialized extraction models** — compact transformer models purpose-built for
  zero/few-shot entity or schema-driven structured extraction, distinct from general chat/
  instruction LLMs (e.g. the GLiNER family, GLiNER2 for relation/schema-level extraction,
  NuExtract for text-to-JSON template filling). Some (GLiNER-scale, ~60M-500M params) run
  in-process via ONNX/`transformers.js` with no Python dependency and near-deterministic latency;
  others (NuExtract, UniNER, at LLM-adjacent scale) need a local model runtime and behave more
  like a locally-hosted LLM. Handles phrasing variation without hand-authored rules, at the cost
  of non-deterministic (if fast and cheap) output that still needs schema validation downstream.
  A plausible middle ground if phrasing variety turns out wider than the rule-based tier can
  comfortably cover, without committing to a full LLM's cost/latency/network profile.
- **LLM-based extraction** — prompting a general-purpose LLM to read clue prose and emit the
  structured constraint representation directly, typically via schema-constrained structured
  output (tool/function calling, or native constrained decoding) rather than free-form JSON in a
  prompt. Handles genuinely novel phrasing with the least per-clue-shape engineering effort, but
  introduces non-determinism, a network (or locally-hosted-model) dependency, per-call latency
  and cost, and a harder validation story — constrained decoding guarantees schema-valid output
  but not semantic correctness (e.g. confusing "left of" with "right of").
- **Hybrid** — a cascade across any of the above (e.g. rule-based fast path, falling back to a
  small model or LLM only for clues the rules don't recognize), or one tier producing a candidate
  extraction that another validates (e.g. LLM extraction checked by round-tripping through
  `src/solver/`). Adds routing/fallback-boundary complexity but can combine determinism where
  possible with graceful degradation elsewhere, and this project's puzzles have an unusually
  strong validator already available for free: an extraction can be checked by attempting to
  solve it and comparing against the puzzle's expected solution/uniqueness.

Which tier(s) an ADR should actually commit to isn't resolved here — see the comparative
evaluation in the Appendix (section 9), which scores each tier against a set of selection
criteria and flags which are uncertain enough to warrant a time-boxed spike first.

### 5.3 Cross-cutting concerns (apply to any strategy)

- **Validation** — how an extraction is checked before being trusted: round-tripping (solve the
  extracted model and confirm a unique or expected solution), cross-checking against the puzzle's
  declared `variables`/`domains`/`constraints` front-matter counts (see `catalog/puzzles/` format),
  or manual review.
- **Dependency footprint** — ranges from a pure-npm parsing/pattern-matching library (rule-based,
  JS-native NLP libraries, in-process ONNX-scale small models) to a second-language subprocess/
  sidecar (Python-ecosystem NLP libraries, locally-hosted LLM-scale models) to a network-calling
  API (hosted LLMs). Anything beyond a pure in-process library, per this project's `effect`
  convention, would need to be modeled as an `Effect` pipeline the way `src/solver/solve.ts`
  wraps its external process call.

Determinism/reproducibility and extensibility to future clue types are also cross-cutting, but
are scored formally as Appendix (§9) criteria rather than restated here.

## 6. Alternatives Considered

- **Leave extraction manual indefinitely** — keep hand-translating prose to `.mzn` as
  `catalog/mzn/README.md` currently does. Rejected as a long-term direction because it doesn't
  scale past a small hand-curated catalog and blocks automated graph-representation work, though
  it remains the fallback/reference process until this RFC's resulting ADR(s) are implemented.
- **Skip prose entirely and generate puzzles directly in structured/constraint form** — would
  sidestep extraction, but contradicts the project's stated pipeline (prose generation is itself a
  goal per [RFC-001](RFC-001-parameterizable-puzzle-generation.md)) and would only solve the
  problem for newly generated puzzles, not the existing seeded prose catalog.
- **Generation-side co-emission** — instead of extracting a CSP from prose after the fact, have
  puzzle generation emit prose and its constraint model together from a single known-correct
  source. Relevant to [RFC-001](RFC-001-parameterizable-puzzle-generation.md) strategies that
  already start from a known solution (generate-from-solution, catalog modification), where the
  CSP exists before any prose is rendered. Not adopted as a substitute for this RFC's scope — it
  only covers future solution-first generation, not the existing hand-authored catalog or
  prose-only scenario generation ([RFC-001](RFC-001-parameterizable-puzzle-generation.md) §9.4) —
  and it's really the mirror-image problem (CSP → NL) to this RFC's NL → CSP extraction. This
  project intends to address that direction, and further format conversions beyond it (e.g. an
  eventual `.mzn` → gram translator), as their own separate future RFCs rather than folding them
  into this one's scope (see Non-Goals, §4).

## 7. Open Questions

7.1. What concrete form should the solver-agnostic intermediate representation take — is it
close enough to a MiniZinc AST to serialize directly, or does it need to be independent of any
one solver's syntax to also serve the future graph representation?

7.2. For an LLM-based or hybrid strategy, what's the acceptable failure mode when extraction is
wrong — reject and flag for manual review, attempt self-correction via re-prompting, or something
else?

7.3. Should validation require round-tripping through the solver (extract → solve → compare
against the puzzle's expected solution/uniqueness) as a hard gate before an extraction is
accepted, given `src/solver/` already exists to make that check possible?
[SPIKE-004](../spikes/SPIKE-004-llm-based-extraction/SPIKE.md) found a concrete case (not just a
theoretical risk) where the identical LLM extraction call produced a correct result once and a
schema-valid-but-semantically-wrong result on a second, identical run — schema validation alone
did not and structurally cannot catch this. That evidence weighs this question toward "yes, a
hard gate" if the LLM tier (or a hybrid including it) is chosen, though the answer may differ for
tiers with different determinism profiles (9.1's rule-based tier is perfectly deterministic by
construction and may not need the same gate).

7.4. Does extraction need to run offline/deterministically for CI (`tests/`, `pnpm test`), and if
an LLM-based strategy is chosen, how would that be tested without a live model dependency in CI?

7.5. How wide is "reasonable, well-intentioned" clue phrasing in practice, beyond just what the
seed catalog currently contains — narrow enough that a rule-based or JS-native-NLP-library tier
plausibly covers it outright, or wide enough (now, or as
[RFC-001](RFC-001-parameterizable-puzzle-generation.md) generation grows toward its
vague/contextual and subjective/preference clue-strictness tiers) that a small specialized model
or LLM tier is needed for adequate coverage? This is probably the single biggest factor in which
tier(s) an ADR should commit to, and the seed catalog alone can only answer it for the
strict/explicit tier already present today.

7.6. [SPIKE-001](../spikes/SPIKE-001-catalog-clue-audit/SPIKE.md) found that `PZL-0011` (Loan
Review) has clues that reference other clues by number ("If not denied by rules 1-2...") and
resolve to a 3-valued outcome (Denied/Approved/Counter-Offer) via a chain of threshold rules on
derived variables (a minimum, a ratio) — closer to a decision procedure than a flat constraint
list. MiniZinc can express derived variables, thresholds, and multi-valued outcomes within a
finite domain, so this likely still fits the classic-CSP scope [RFC-002](RFC-002-constraint-solver-selection.md)
established — but should extraction treat cross-clue numeric references and rule precedence as
just another shape within scope, or is this specific pattern significant enough to call out as
its own boundary case before an ADR commits to a representation?

## 8. ADRs

_(populated automatically as `/adr-create` links ADRs to this RFC)_

## 9. Appendix: Extraction Strategy Evaluation

Qualitative, research-level evaluation of each tier from 5.2 against selection criteria — not a
decision. The eventual ADR should verify uncertain estimates before committing, and time-boxed
spikes are called out below where effort/coverage numbers are currently guesses rather than
measurements.

**Criteria used:**

1. **Level of effort** — engineering cost to build *and* to maintain/extend, so ongoing team time
   goes toward puzzles rather than tooling.
2. **Coverage** — estimated share of the current catalog's clues (`catalog/puzzles/`) correctly
   convertible.
3. **Runtime requirements** — extra language runtime/sidecar, API keys, network dependency, $
   cost per extraction.
4. **Determinism & reproducibility** — same clue text reliably produces the same extraction.
5. **Failure legibility** — a wrong or partial extraction fails loudly (flagged, low-confidence,
   rejected) rather than silently producing a plausible-but-wrong constraint (Goal, §3).
6. **Extensibility to novel phrasing** — engineering effort needed for both new phrasing within
   today's tier and reach toward [RFC-001](RFC-001-parameterizable-puzzle-generation.md) §5.1's
   future clue-strictness tiers — see 9.1-9.5 for how each tier scores on this.
7. **Offline/CI testability** — runnable in `pnpm test`/CI with no network access, no live API
   key, and no un-vendorable model weights.
8. **Licensing/distribution** — license terms on any redistributed library or model weights.

Criterion 6 deliberately covers two distinct things: phrasing variety *within* today's
strict/explicit tier (distinct from Coverage, which measures only the seed catalog as it exists
today), and headroom toward the vague/contextual and subjective/preference tiers RFC-001 treats
as future generation work. The seed catalog is a floor for evaluation, not the ceiling of what
this capability should eventually reach — the outer bound is §4's closing Non-Goal (reasonable,
well-intentioned phrasing, not arbitrary/adversarial input), not the catalog's current size.

### 9.1 Rule-based / grammar parsing

- **Level of effort**: Moderate, scoped per distinct problem family rather than "low, scoped per
  phrasing variant" — [SPIKE-001](../spikes/SPIKE-001-catalog-clue-audit/SPIKE.md) found 12
  distinct structural shapes across the seed catalog's 14 puzzles, only 4 of which reduce to the
  flat assignment/adjacency/negation patterns this tier's original estimate assumed. The rest
  need either a second extraction pass over already-parsed facts (a relational-fact clue plus a
  generative meta-rule, e.g. "two countries that share a border must be colored differently"),
  recognition of a named problem type to infer unstated constraints (N-Queens, magic square),
  or numeric/derived-variable evaluation (a threshold rule computed from a derived minimum or
  ratio). Two shapes aren't grammar-over-sentences problems at all regardless of tier: an
  ASCII-diagram arithmetic layout, and requirement statements that need mapping against an
  embedded markdown table's columns — both need a dedicated parser before any clue-level grammar
  applies.
- **Coverage**: 4/14 seed puzzles (~29%) covered by simple flat clue patterns alone; full-catalog
  coverage needs all shapes above handled (per SPIKE-001) — not the "plausibly high" guessed
  before that audit existed.
- **Runtime requirements**: None beyond an npm parsing library — no sidecar, no API key, no
  per-call cost.
- **Determinism & reproducibility**: Perfect — same input, same output, always.
- **Failure legibility**: Excellent by construction — an unmatched clue simply fails to parse,
  with no plausible-but-wrong output possible.
- **Extensibility to novel phrasing**: Weak — each new phrasing requires a hand-authored rule and
  doesn't generalize on its own. Weakest of any tier at reaching toward RFC-001's
  vague/contextual or subjective/preference tiers, since those clues aren't well served by a
  fixed grammar in the first place.
- **Offline/CI testability**: Full — pure in-process code, trivially unit-testable.
- **Licensing/distribution**: Whatever a small parser-generator library uses (Peggy/nearley/
  Chevrotain are all permissively licensed) — low risk.
- **Spike?**: Done — [SPIKE-001](../spikes/SPIKE-001-catalog-clue-audit/SPIKE.md) audited the
  catalog's clue text (no code needed, as anticipated). It also produced a stratified sample
  (PZL-0001, 0005, 0008, 0011, 0013) recommended for the §9.2-9.4 spikes below, spanning the
  difficulty range instead of just zebra-style clues.

### 9.2 General-purpose NLP libraries (JS-native vs. Python-ecosystem)

- **Level of effort**: Low-to-moderate for the JS-native path for the simple shapes (A/B/C/D) —
  confirmed by [SPIKE-002](../spikes/SPIKE-002-js-native-nlp-wink/SPIKE.md), which matched all
  four on the first attempt. But three concrete, library-specific frictions add real effort
  beyond "thin layer over the rule-based tier's own pattern work": (1) patterns containing a
  hyphenated compound (`3-by-3`, `nut-free`, `1-2`) **throw at pattern-registration time**, and
  because `learnCustomEntities()` registers a whole batch at once, one bad pattern silently
  voids every other pattern in that batch; (2) the tokenizer splits hyphenated compounds into
  three tokens with a literal `-` PUNCT token between them, and the lite model's POS tagger can
  mis-tag the pieces (e.g. "left" in "top-left" tagged as a verb); (3) predicate nouns that read
  like adjectives (e.g. "vegan") need checking against actual tagger output, not assumed from
  intuition — an easy silent-failure trap when hand-authoring patterns. Higher for the
  Python-ecosystem path regardless, since it also requires building and maintaining the
  subprocess/sidecar bridge itself before any clue-parsing work starts.
- **Coverage**: Confirmed clean for shapes A/B/C/D; SPIKE-002 could not fully test shapes F/H/I
  due to the hyphenated-compound registration crash above (a follow-up would need per-pattern
  registration and pre-normalized numeric ranges to test those properly). Shape K's embedded
  markdown table confirmed unreachable by any NLP-layer pattern, matching SPIKE-001's prediction.
  spaCy's dependency parsing may offer more headroom on genuinely ambiguous phrasing — headroom
  this catalog may not need.
- **Runtime requirements**: JS-native — none beyond an npm package. Python-ecosystem — a second
  language runtime installed, versioned, and kept alive in both dev and CI, materially larger
  than the rule-based tier's footprint for uncertain additional benefit.
- **Determinism & reproducibility**: High for both — POS-tagging/pattern-matching pipelines are
  deterministic given the same model/rule version.
- **Failure legibility**: Good — an unmatched pattern can be surfaced the same way as the
  rule-based tier's unmatched clue.
- **Extensibility to novel phrasing**: Somewhat better than pure hand-rolled rules in theory,
  since tagging reduces some phrasing variants (tense, article use) to the same pattern match —
  but [SPIKE-002](../spikes/SPIKE-002-js-native-nlp-wink/SPIKE.md) found this doesn't extend to
  syntactic voice (a passive-voice variant of a matched active-voice clue still needed its own
  separate pattern) — still bounded by the custom pattern set for anything semantically new, and
  — like the rule-based tier — has no natural path toward the vague/contextual or
  subjective/preference tiers, which aren't fixed-pattern problems.
- **Offline/CI testability**: Full for JS-native. Full but more fragile for Python-ecosystem
  (sidecar process must start reliably in CI, similar to the existing `minizinc` CLI dependency
  in `src/solver/`'s test suite).
- **Licensing/distribution**: wink-nlp (MIT) and compromise.js (MIT) are permissive; spaCy (MIT)
  is too, though its models may carry separate terms depending on which is used.
- **Spike?**: Done for the JS-native path —
  [SPIKE-002](../spikes/SPIKE-002-js-native-nlp-wink/SPIKE.md) confirmed the pattern-matcher API
  is a real but partial simplification (clean for shapes A/B/C/D, real friction beyond that — see
  Level of effort above). Not worth spiking the Python-ecosystem path unless a future need
  surfaces a concrete gap the JS-native path can't cover (e.g. a clue shape that genuinely needs
  dependency parsing) — SPIKE-002 didn't find one.

### 9.3 Small specialized extraction models (GLiNER family, NuExtract, UniNER)

- **Level of effort**: Low to integrate (a vendored ONNX model + `transformers.js`, or an npm
  wrapper), but the schema/label design for zero-shot extraction is itself a design task.
  [SPIKE-003](../spikes/SPIKE-003-gliner2-capability/SPIKE.md) found accuracy tuning is more
  predictable than expected for its native Python API — the main lever that mattered was calling
  it **per-clue rather than per-puzzle**: batching several distinct clues into one extraction
  call measurably degraded field accuracy, while an isolated single-sentence call on the same
  text was materially cleaner. That's a usage-pattern constraint an eventual implementation needs
  to bake in, not a tuning problem to iterate away.
- **Coverage**: [SPIKE-003](../spikes/SPIKE-003-gliner2-capability/SPIKE.md) found GLiNER2
  (native Python) substantially outperforms the JS-native NLP tier
  ([SPIKE-002](../spikes/SPIKE-002-js-native-nlp-wink/SPIKE.md)) on every harder shape tested:
  real relation tuples (not just span matches) for shape E, correct compound-fact splitting and
  correct extraction of a hyphenated rule-cross-reference ("rules 1-2") for shapes H/I where
  wink-nlp's pattern registration crashed outright, and correct semantic vocabulary mapping
  ("has a nut allergy... nut-free kitchen" → `"nut-free"`) for shape K where wink-nlp failed
  because "vegan" is POS-tagged as a noun, not an adjective. Remaining gaps: hyphenated
  spatial/numeric compounds ("3-by-3") still aren't resolved into structured values (though this
  degrades to a missing field, not a crash), and — as with every tier — applying a recognized
  meta-rule to generate derived constraints, and parsing an embedded markdown table, remain
  necessarily external logic no extraction tier alone can produce.
- **Runtime requirements**: GLiNER/GLiNER2-scale — none beyond a vendored model file and
  `transformers.js`/ONNX Runtime, no network call, no API key, confirmed by SPIKE-003's CPU
  inference. **New finding**: on a platform without current `torch` wheel support (e.g. Intel
  Mac, where PyPI tops out at `torch==2.2.2`), a plain `pip install gliner2` pulls a
  `transformers` version requiring `torch>=2.5` — an unsatisfiable combination that needed
  manually pinning `transformers`, `peft`, `numpy`, and installing `setuptools` to resolve. A
  one-time environment-setup cost this tier carries that tiers 9.1/9.2 don't, separate from its
  per-inference cost. NuExtract/UniNER-scale — needs a local model runtime (e.g. llama.cpp/GGUF),
  a heavier footprint closer to a locally-hosted LLM.
- **Determinism & reproducibility**: Weaker than tiers 9.1-9.2 — still a neural model, so output
  can vary with model version even at fixed input, though typically more stable than a
  general-purpose LLM given the narrower task.
- **Failure legibility**: Moderate, and better in practice than the JS-native tier —
  [SPIKE-003](../spikes/SPIKE-003-gliner2-capability/SPIKE.md) found GLiNER2 degrades to a
  missing field or an empty result on input it can't handle (unresolved hyphenated compounds, an
  embedded markdown table), never a thrown exception that voids unrelated extractions in the same
  call the way wink-nlp's pattern registration did. Confidence scores are available but still
  need an explicit threshold/validation step to turn "low confidence" into a hard failure rather
  than a silently accepted guess.
- **Extensibility to novel phrasing**: Good — this is the tier's main selling point over 9.1/9.2,
  confirmed by SPIKE-003 across shapes E, H/I, and K. Some headroom toward vague/contextual clues
  via schema/label redefinition, though GLiNER-class models are proven for entity/relation
  extraction, not the interpretation vague clues require, and none of this tier is a natural fit
  for the optimization-style subjective/preference tier.
- **Offline/CI testability**: Full for GLiNER-scale (vendored weights, deterministic-enough CPU
  inference); weaker for NuExtract/UniNER-scale, which behaves more like the LLM tier's
  testability profile.
- **Licensing/distribution**: Varies by model and needs explicit verification — GLiNER/GLiNER2
  weights and NuExtract are research-lab releases with their own license terms (Apache 2.0 for
  several GLiNER checkpoints, though this varies by specific model card) that should be checked
  per model before committing, unlike the permissively-licensed npm libraries in 9.1/9.2.
- **Spike?**: Done — [SPIKE-003](../spikes/SPIKE-003-gliner2-capability/SPIKE.md) ran GLiNER2's
  native Python API against the full stratified sample and replaced the "unmeasured" estimates
  above with real numbers, confirming the gap between "sounds promising" and "actually works"
  was smaller than expected — GLiNER2 outperformed the JS-native tier on every harder shape
  tested. NuExtract/UniNER-scale remains unspiked; not obviously worth it given GLiNER2's results
  unless a future need surfaces a gap GLiNER2 doesn't cover.

### 9.4 LLM-based extraction

- **Level of effort**: Low to get a first working version (a single structured-output prompt),
  but higher to get *reliable* — schema design, retry/validation logic, and prompt iteration
  against edge cases add up, and per-clue-shape effort doesn't disappear so much as move from
  "write a rule" to "handle this clue's failure mode in the validator."
- **Coverage**: [SPIKE-004](../spikes/SPIKE-004-llm-based-extraction/SPIKE.md) confirmed this is
  the strongest tier tested on raw capability — the only one to solve both shapes that defeated
  every other tier outright: the hyphenated "3-by-3" grid dimension (correctly resolved to
  `grid_rows`/`grid_cols`, where wink-nlp crashed and GLiNER2 returned `null`), and the raw
  embedded markdown table row (perfectly parsed into its schema fields, where wink-nlp produced
  garbage and GLiNER2 returned empty). **This overturns the standing assumption carried since
  SPIKE-001 that shape K "needs a dedicated parser regardless of tier"** — true for tiers
  9.1-9.3, not for schema-constrained LLM extraction. Both a frontier
  (`anthropic/claude-sonnet-4.5`) and a ~30x cheaper model (`google/gemini-2.5-flash-lite`)
  performed similarly well on this sample.
- **Runtime requirements**: A network-calling API (or a locally-hosted LLM-scale model with
  similar footprint to NuExtract/UniNER above); real per-call $ cost and latency, though clue
  texts are short enough that token cost specifically is likely minor compared to whole-puzzle
  generation costs already implied by [RFC-001](RFC-001-parameterizable-puzzle-generation.md).
  [SPIKE-004](../spikes/SPIKE-004-llm-based-extraction/SPIKE.md) used `@openrouter/sdk` rather
  than `@effect/ai` — the latter (and every `@effect/ai-*` provider package) peer-depends on
  `effect@^3.22.0`, incompatible with this repo's `effect` 4.x pin regardless of which 4.x
  prerelease is in use (the `@effect/*` ecosystem hasn't caught up to `effect` 4.x at all yet),
  the same class of incompatibility already documented for `@effect/platform`'s `Command` module.
  `@openrouter/sdk` has zero peer dependencies and is a thin API client, not an agentic
  framework, so it doesn't conflict with the pin and doesn't add "another agentic library."
- **Determinism & reproducibility**: Weakest of any tier, now confirmed concretely rather than
  theoretically —
  [SPIKE-004](../spikes/SPIKE-004-llm-based-extraction/SPIKE.md) ran the *identical* combined-clue
  extraction against the same frontier model twice: the first run correctly returned
  `"outcome": "Denied"`, the second run (same input, same schema, same model) returned
  `"outcome": "680"` — a credit-score value, not a valid outcome — while the JSON schema
  validated successfully both times. Even at temperature 0 (not explicitly set in this spike),
  output isn't guaranteed stable across model versions, and this project has no control over
  provider-side model updates.
- **Failure legibility**: Constrained decoding/tool calling guarantees schema-*valid* output, but
  not semantic correctness — [SPIKE-004](../spikes/SPIKE-004-llm-based-extraction/SPIKE.md)'s
  non-determinism finding above is a direct, observed example of this, not just a hypothetical
  one: a confidently wrong extraction looked identical (valid JSON, right shape) to a correct one
  without a separate validation step (§5.3, §7.3).
- **Extensibility to novel phrasing**: Best of any tier — little to no per-phrasing engineering
  effort, and — per [RFC-001](RFC-001-parameterizable-puzzle-generation.md) §9.4's own
  observation — the most natural fit of any tier for the vague/contextual and
  subjective/preference tiers specifically, since interpretation and preference are exactly what
  general-purpose LLMs are suited to reason about.
- **Offline/CI testability**: Weak unless mocked or cached — a live suite depending on a network
  API call is exactly the offline/CI gap named in Open Question 7.4.
- **Licensing/distribution**: N/A in the traditional sense (no redistributed weights), but
  introduces a usage-terms/API-agreement dependency instead.
- **Spike?**: Done — [SPIKE-004](../spikes/SPIKE-004-llm-based-extraction/SPIKE.md) measured
  accuracy against the full stratified sample on both a frontier and a cheap model, confirming
  this tier's structured-output extraction genuinely handles cases every other tier failed —
  and, more importantly, produced a concrete non-determinism failure case that makes RFC-003
  §7.3's round-trip solver-validation question look closer to a requirement than an optional
  gate if this tier is chosen (see §7.3).

### 9.5 Hybrid

- **Level of effort**: Additive on top of whichever component tiers are combined, plus new
  routing/fallback-boundary logic (deciding what counts as "unmatched" or "low confidence" enough
  to escalate) that doesn't exist in any single tier alone.
- **Coverage**: Highest achievable in principle — a fast/deterministic tier for the common case,
  escalating to a higher-coverage tier for the long tail — but only as good as its slowest
  component's own coverage for whatever reaches it.
- **Runtime requirements**: Inherits the union of whichever tiers are combined; a rule-based +
  LLM-fallback hybrid still needs the LLM tier's network/cost footprint for the fallback path,
  just less often.
- **Determinism & reproducibility**: Mixed — deterministic for inputs the fast path handles,
  inherits the fallback tier's non-determinism otherwise; whether that's acceptable depends on
  what share of clues actually need the fallback (unknown until component tiers are measured).
- **Failure legibility**: Potentially the best of any approach — the routing decision itself
  (which tier handled this clue) is a natural place to surface confidence, and this project's
  solver-based round-trip validation (§5.2, §7.3) is itself a hybrid pattern.
- **Extensibility to novel phrasing**: Good — new phrasing simply falls through to the fallback
  tier without requiring the fast path to be extended immediately, and inherits whichever
  fallback tier's reach toward RFC-001's future clue-strictness tiers — a rule-based + LLM hybrid
  could in principle reach all three tiers today without committing the fast path to any of them.
- **Offline/CI testability**: Only as good as its weakest component for the paths CI needs to
  exercise; a rule-based + small-model hybrid stays fully offline, a rule-based + LLM hybrid
  does not without mocking the fallback path.
- **Licensing/distribution**: Union of whichever components are combined.
- **Spike?**: Not independently — a hybrid's real value (what share of clues actually needs the
  fallback tier) can only be measured once the component tiers in 9.1-9.4 have their own
  spike/audit results. Sequence any hybrid spike after those.

### 9.6 Comparison summary

| Tier | Level of effort | Coverage (current catalog) | Runtime requirements | Determinism | Extensibility to novel phrasing | Offline/CI testable | Spike recommended? |
|---|---|---|---|---|---|---|---|
| Rule-based / grammar | Moderate, per problem family ([SPIKE-001](../spikes/SPIKE-001-catalog-clue-audit/SPIKE.md)) | 29% (4/14) via simple patterns alone; full coverage needs 12 shapes ([SPIKE-001](../spikes/SPIKE-001-catalog-clue-audit/SPIKE.md)) | None (npm only), plus a dedicated parser for 2 non-sentence shapes | Perfect | Weak | Full | Done — see 9.1 |
| General-purpose NLP library (JS-native) | Low-moderate for shapes A/B/C/D; real friction beyond that ([SPIKE-002](../spikes/SPIKE-002-js-native-nlp-wink/SPIKE.md)) | Clean for A/B/C/D; F/H/I untested (registration crash), K unreachable ([SPIKE-002](../spikes/SPIKE-002-js-native-nlp-wink/SPIKE.md)) | None (npm only) | High | Moderate — no voice generalization ([SPIKE-002](../spikes/SPIKE-002-js-native-nlp-wink/SPIKE.md)) | Full | Done — see 9.2 |
| General-purpose NLP library (Python/spaCy) | Moderate+ (sidecar build cost) | Unmeasured, possibly higher on ambiguous phrasing | Second runtime/sidecar | High | Moderate-good | Full but fragile | No concrete gap found yet ([SPIKE-002](../spikes/SPIKE-002-js-native-nlp-wink/SPIKE.md)) |
| Small specialized model (GLiNER-scale) | Low integration; accuracy needs per-clue calls, not per-puzzle ([SPIKE-003](../spikes/SPIKE-003-gliner2-capability/SPIKE.md)) | Outperforms JS-native tier on every harder shape tested ([SPIKE-003](../spikes/SPIKE-003-gliner2-capability/SPIKE.md)) | None (vendored model), but real one-time env-pinning cost on platforms without current torch wheels ([SPIKE-003](../spikes/SPIKE-003-gliner2-capability/SPIKE.md)) | Moderate | Good | Full | Done — see 9.3 |
| Small specialized model (NuExtract/UniNER-scale) | Low-moderate | Unmeasured | Local model runtime | Moderate | Good | Weak-moderate | Yes, alongside GLiNER spike |
| LLM-based | Low to start, higher for reliability | Highest confirmed — only tier to solve the grid-dimension and embedded-table shapes ([SPIKE-004](../spikes/SPIKE-004-llm-based-extraction/SPIKE.md)) | Network + $ cost; `@openrouter/sdk` avoids the `@effect/ai` incompatibility ([SPIKE-004](../spikes/SPIKE-004-llm-based-extraction/SPIKE.md)) | Weakest, confirmed by a real same-input two-run divergence ([SPIKE-004](../spikes/SPIKE-004-llm-based-extraction/SPIKE.md)) | Best | Weak unless mocked | Done — see 9.4 |
| Hybrid | Additive + routing logic | Highest achievable in principle | Union of components | Mixed | Good | Only as good as weakest component | No — sequence after component spikes |

This comparison proposes criteria (§9 intro) and organizes what's currently known versus
genuinely uncertain — it does not resolve which criteria should be weighted most heavily, nor
does it commit to a tier. All four originally-recommended spikes (9.1-9.4) are now done; only
NuExtract/UniNER-scale (a variant within 9.3) remains unspiked, and not obviously worth it given
GLiNER2's results. [SPIKE-004](../spikes/SPIKE-004-llm-based-extraction/SPIKE.md) closed the
LLM-based tier's Coverage gap and, more importantly, turned Determinism from an abstract concern
into a concrete, reproduced failure case — the single most decision-relevant finding across all
four spikes, since it makes Open Question 7.3's round-trip solver-validation gate look closer to
a requirement than an optional nice-to-have if this tier (or a hybrid including it) is chosen.
[SPIKE-001](../spikes/SPIKE-001-catalog-clue-audit/SPIKE.md) closed this gap for the rule-based
tier (9.1) and produced the shape taxonomy the other spikes test against: two of the twelve
shapes it found (an ASCII-diagram arithmetic layout, and requirements matched against an embedded
markdown table) aren't natural-language extraction problems at all and will need a dedicated
parser regardless of which tier is chosen for everything else.
[SPIKE-002](../spikes/SPIKE-002-js-native-nlp-wink/SPIKE.md) closed it for the JS-native NLP
tier (9.2), and additionally surfaced library-specific friction (hyphenated-compound tokenization
crashing pattern registration, POS-tagging errors on compound words).
[SPIKE-003](../spikes/SPIKE-003-gliner2-capability/SPIKE.md) closed it for the GLiNER2 tier
(9.3), finding it outperforms 9.2 on every harder shape with more graceful failure modes (a
missing field, never a crash) — the main operational caveat is that accuracy holds only when
called per-clue rather than batched per-puzzle. Worth testing the identical sample and batching
question in the 9.4 LLM spike for direct comparison — does an LLM also degrade on batched input,
or handle full-puzzle context better than a narrower extraction model?

The **Extensibility to novel phrasing** column also carries a second dimension beyond the seed
catalog's own phrasing variety: reach toward RFC-001's future vague/contextual and
subjective/preference clue-strictness tiers (§9.1-9.5 detail this per tier). The ranking is
consistent either way — LLM-based scores best and rule-based/JS-native-NLP-library score weakest
on both readings — but an ADR should be explicit about which of the two it's actually optimizing
for, since the seed catalog can only speak to the first.
