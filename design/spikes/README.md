# Spikes — Time-Boxed Investigations

Spikes answer a specific empirical question an [RFC](../rfc/README.md) left open — typically a
"worth a time-boxed spike" note in its Appendix, or an Open Question — by actually building or
testing something small enough to stay disposable in scope. Their job is to turn an "unmeasured"
or "unknown" cell in an RFC's comparison into a real finding, so an eventual
[ADR](../adr/README.md) commits to a decision informed by evidence rather than a guess.

A spike is lighter-weight than an RFC or ADR: no alternatives-considered section, no formal
decision to record, no requirement to route through speckit. It's expected to happen in its own
git worktree/branch off the motivating RFC's branch, so multiple spikes can run independently and
in parallel.

## When to write a spike

- An RFC's Appendix flags a candidate approach's Coverage, Level-of-effort, or other criterion as
  "unmeasured" and recommends a time-boxed spike before an ADR commits.
- An RFC's Open Questions section contains an empirical question ("does X actually work well
  enough?") rather than a design question.

## Format

Created/updated via `/spike-create`. Always a directory:
`design/spikes/SPIKE-NNN-short-name/SPIKE.md`, `NNN` zero-padded — even when the spike produces
no code (e.g. a manual audit). Any code/fixtures a spike produces live alongside `SPIKE.md` in
the same directory, committed normally; spikes are kept for future reference, not deleted once
concluded.

A spike that ships a static, zero-build browser prototype (plain HTML/JS, no bundler) gets a
`spike:NNN` script in the root `package.json`, running the `@web/dev-server` devDependency against
that spike's directory on a fixed port — `pnpm run spike:NNN`. For example:

```
"spike:006": "web-dev-server --root-dir design/spikes/SPIKE-006-*/ --port 4173 --watch --open"
```

`@web/dev-server` is chosen over a bare static server for two properties that matter to buildless
prototypes: it serves native ES modules untouched (no bundling, so the spike stays zero-build), and
`--watch` reloads the browser on file change while sending `cache-control: no-cache`. Skipping the
cache headers costs real debugging time — stale modules present as state-management bugs.

This is the one exception to spikes staying unwired from root tooling: a generic dev server is dev
tooling, not a spike-specific dependency, so it belongs at the root rather than duplicated per
spike.

**Front-matter** (YAML):

| Field | Description |
|---|---|
| `id` | `SPIKE-NNN` |
| `title` | Short descriptive title |
| `status` | `planned` \| `in-progress` \| `done` \| `abandoned` |
| `rfcs` | Parent RFC id(s), a list — **required, at least one**, only ever grows |
| `created` | ISO date (`YYYY-MM-DD`) |

**Sections** (numbered `##`):

1. Question — the specific empirical question, citing the parent RFC's Open Question number or
   Appendix criterion/section it resolves. One question per spike.
2. Method — what was built or tested, concrete enough to be reproducible.
3. Time-box — the explicit duration/deadline. A spike that can't be time-boxed is feature work,
   not a spike.
4. Findings — filled in once concluded: the actual results.
5. Conclusion — what the findings mean for the parent RFC's decision, and any text worth citing
   back into the RFC.

**Citing findings back into the parent RFC is a manual step** — unlike ADR's automated speckit
backlink, this skill never edits the RFC itself, since a spike's findings are usually paraphrased
into the RFC rather than copied verbatim.

## Index

| Spike | Title | Status | RFCs |
|---|---|---|---|
| [SPIKE-001](SPIKE-001-catalog-clue-audit/SPIKE.md) | Catalog Clue-Shape Audit | done | RFC-003 |
| [SPIKE-002](SPIKE-002-js-native-nlp-wink/SPIKE.md) | JS-Native NLP Library (wink-nlp) Extraction | done | RFC-003 |
| [SPIKE-003](SPIKE-003-gliner2-capability/SPIKE.md) | GLiNER2 Extraction Capability | done | RFC-003 |
| [SPIKE-004](SPIKE-004-llm-based-extraction/SPIKE.md) | LLM-Based Extraction (OpenRouter) | done | RFC-003 |
| [SPIKE-005](SPIKE-005-tool-calling-conventions/SPIKE.md) | Tool-Calling and Structured-Output Conventions Across Providers | done | RFC-003 |
| [SPIKE-006](SPIKE-006-progressive-card-prototype/SPIKE.md) | Progressive Card-Loop Playable Prototype | done | RFC-005 |
