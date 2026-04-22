# Re-architecture plan

Target shape the codebase is moving toward. Companion to [ARCHITECTURE.md](ARCHITECTURE.md), which describes current state. Once the moves below are landed, stable bits fold back into `ARCHITECTURE.md` and this file is deleted.

Guiding aim: **make "where is X?" obvious.**

## Principles

Two rules. Everything else follows from these.

1. **One public surface per domain.** Ideally a single function or a single Svelte component. Merge when one is enough; accept two only when the consumers are genuinely distinct (different pages, different kinds of thing — state vs. UI).
2. **Domains don't orchestrate. Routes do.** Page composition (fetch this, compute that, pass to component) lives in `+page.ts` files next to the route. Domains are pure logic+components; they don't import each other through orchestration helpers.

## Philosophy

Our north star is Carson Gross's ["Codin' Dirty"](https://htmx.org/essays/codin-dirty/). The relevant tenets and how they shape this plan:

- **Coherence over separation.** We merge `bigram` + `diagnostic` → `skill` and fold `typing` → `session` because these concerns belong together. A single domain that does one thing well beats two folders chasing an imagined boundary.
- **Large files are acceptable when the logic is coherent.** `SessionShell.svelte` stays at ~360 LOC. It is the _crux_ of the runtime; its size should reflect that. Same for `planner.ts`. We don't split for LOC alone.
- **Minimize class/interface proliferation.** One public function or component per domain. `analyzeSkill(history)` returning a bag beats `classifyBigram` + `extractBigramAggregates` + `generateDiagnosticReport` + `derivePriorityBigrams` as four separate exports.
- **Pragmatism over purity.** We accept two public surfaces for Progress (`<Summary>` + `<Analytics>`) and Settings (`profile` + `<DataTransfer>`) because forcing one would be ceremony. The rule serves readability, not the other way around.
- **Sparse, short comments.** Default to none. Only add one when the _why_ is non-obvious — a hidden constraint, a workaround, a counter-intuitive choice. No multi-paragraph JSDoc blocks narrating what the code already says. If a good name would remove the comment, use the name. Current codebase is comment-heavy; trim as we touch files.

When in doubt: _would this change make the "where is X?" question easier or harder?_

## Target domain model

Six domains + two support layers.

| Domain       | Responsibility                                                | Public surface                    |
| ------------ | ------------------------------------------------------------- | --------------------------------- |
| **Corpus**   | Produces a string of text for the user to type.               | `generateText(spec)`              |
| **Plan**     | Decides what the user should do next.                         | `computePlan(context)`            |
| **Session**  | Runs one live typing attempt, first keystroke to persistence. | `<SessionShell>`                  |
| **Skill**    | Models what the app believes about the user's typing.         | `analyzeSkill(history)`           |
| **Progress** | Turns session history into views for the user.                | `<Summary>`, `<Analytics>`        |
| **Settings** | Holds user preferences; makes data portable.                  | `profile` store, `<DataTransfer>` |

Support layers (not domains):

- **Storage** — Dexie wrapper. Only domains touch it; routes never do.
- **Core** — shared types (`SessionSummary`, `BigramAggregate`, …). DAG leaf; zero imports from domains.

### Per-domain cards

**Corpus** — _Produces a string of text for the user to type._

- Public: `generateText(spec) → string` — dispatches to bigram-drill weaving, real-text stitching, quotes, diagnostic sampler based on the spec.
- Internal (not exported): registry, normalization, selection, each generator.

**Plan** — _Decides what the user should do next._

- Public: `computePlan(context) → Plan` — returns a rich object with `.nextSession`, `.window`, `.graduations`, whatever the dashboard and summary CTA need.
- Internal: planner, plan-window, graduation-filter, planned-session stash.

**Session** — _Runs one live typing attempt from first keystroke to persisted summary._

- Public: `<SessionShell>` — imported by route file path.
- Internal: runner, persistence, pacer, capture, postprocess, typing surface & text display (after R3).

**Skill** — _Models what the app believes about the user's typing ability._

- Public: `analyzeSkill(history) → SkillModel` — returns `{ aggregates, classifications, diagnosticReport, priorityBigrams }`. One call, one bag.
- Internal: classification thresholds, extraction, diagnostic engine, baseline-WPM derivation.

**Progress** — _Turns history into views for the user._

- Public: `<Summary session history>` and `<Analytics history>` — each a distinct page view.
- Internal: delta, celebrations, metrics, rolling-window math, chart sub-components.
- Logic lives _inside_ the components. No standalone `computeDelta` / `detectGraduations` exports.

**Settings** — _Holds user preferences and makes data portable._

- Public: `profile` store, `<DataTransfer>`.
- Internal: serialization, word budgets, theme state, threshold constants (if user-tunable).

### Dependency direction

```
Routes compose:
 ├── Settings
 ├── Skill ◄───┐
 ├── Plan ─────┤   (reads Skill, reads Corpus)
 ├── Corpus    │
 ├── Session ──┘   (reads Skill for aggregation)
 └── Progress      (reads session summaries only)
```

All domain arrows point to Skill or Corpus (leaves). **No edges between peer domains.** The only place that knows "summary page needs Progress _and_ Plan" is `routes/session/[id]/summary/+page.ts`.

## Reshape plan

Status key: ✅ done · 🔄 in progress · ⬜ not started

### ✅ R0 — Session public surface cleanup

Deleted `src/lib/session/index.ts`. `<SessionShell>` is the domain's only public surface.

### ✅ R1 — Loaders out of domains

Loaders moved from domain folders to route-local `loader.ts` files. `+page.ts` won't work here: Dexie is client-only and SvelteKit's static adapter would try to prerender a universal load function, so loaders stay as plain async functions imported from `./loader` by each route's `onMount`.

Moves landed:

- `progress/summary-loader.ts` → `routes/session/[id]/summary/loader.ts`
- `progress/analytics-loader.ts` → `routes/analytics/loader.ts`
- `practice/session-loader.ts` split →
  - `prepareDrillSession` → `routes/session/drill-loader.ts` (shared by both drill routes; `routes/session/` is just a folder, not a SvelteKit route)
  - `prepareRealTextSession` → `routes/session/real-text/loader.ts`
  - `prepareDiagnosticSession` → `routes/session/diagnostic/loader.ts`
- `practice/dashboard-loader.ts` → `practice/plan-actions.ts` (nav helpers only; `loadDashboardData` / `DashboardData` aliases deleted, dashboard now calls `computePlan` / `PlanContext` directly)

ESLint boundary rule updated: `+page.svelte` files still can't touch `$lib/storage`; route-local `loader.ts` files are the new orchestration layer and are allowed to.

Known temporary debt: `practice/index.ts` is widened to re-export its internals (`planned`, `bigram-drill`, `real-text`, `diagnostic-sampler`, `graduation-filter`, `planner`) so the split route loaders can reach them. R4 collapses this back to a single `computePlan` export.

### ✅ R2 — Skill merge (bigram + diagnostic → skill)

Two folders merged into `skill/`. The misnamed `diagnostic/pacing.ts` (10 LOC, one caller) was inlined into `skill/engine.ts`; its test cases merged into `engine.test.ts`.

Landed:

- `bigram/{classification,extraction}.ts` (+ tests) → `skill/`
- `diagnostic/engine.ts` + `diagnostic/pacing.ts` merged → `skill/engine.ts` (+ merged test)
- New `skill/index.ts` re-exports classification, extraction, engine
- 8 import sites updated (3 routes + 5 lib files, including a deep `bigram/classification` import I missed on the first sweep)
- `bigram/` and `diagnostic/` deleted

Public surface narrowing to a single `analyzeSkill(history)` function is deferred — R2 is a structural merge; surface consolidation is a later pass.

### ⬜ R3 — Typing → Session

Fold `src/lib/typing/` into `src/lib/session/`. Keystroke capture is the input layer of a session.

Provisional shape:

```
session/
├── components/        # SessionShell, Timer, StatsBar, TextDisplay, TypingSurface
├── capture.ts         # from typing/
├── postprocess.ts     # from typing/
├── runner.ts
├── persistence.ts
├── pacer.ts
└── types.ts           # merges typing/types.ts (KeystrokeEvent etc.)
```

Confirm at execution: whether `TextDisplay`/`TypingSurface` go flat in `session/components/` or under `session/typing/`.

### ⬜ R4 — Practice split (corpus generators → corpus, scheduler → plan)

The name `practice/` conflates "what text to show" (Corpus) and "when to show it" (Plan).

Moves:

- To `corpus/`: `bigram-drill.ts`, `real-text.ts`, `diagnostic-sampler.ts` (+ tests)
- Rename `practice/` to `plan/`: `planner.ts`, `plan.ts`, `plan-window.ts`, `planned.ts`, `graduation-filter.ts`, `types.ts`

After R1, `session-loader.ts` and `dashboard-loader.ts` are already gone. `plan/` exports only `computePlan`.

### ⬜ R5 — Tests at the domain frontier

Final stage, after R1–R4 have stabilized the public surfaces. Move tests so each domain has **one test file per public entry point**, exercising it end-to-end. Drop unit tests tied to internals.

Target shape:

```
skill/
├── skill.test.ts         # drives analyzeSkill(history) with varied inputs
└── (internals, no tests)

plan/
├── plan.test.ts          # drives computePlan(context)
└── (internals, no tests)

corpus/
├── corpus.test.ts        # drives generateText(spec) across all spec kinds
└── (internals, no tests)
```

For component domains (Session, Progress, Settings), frontier tests become component tests via Testing Library — exercise `<SessionShell>` / `<Summary>` / `<Analytics>` as the user would, not their internals. The existing `e2e/` Playwright suite is the outermost frontier and stays.

Trade-offs we accept:

- Tests need richer fixtures (driving through the domain instead of through an internal function).
- When a test fails, triangulating which internal broke takes a bit longer.
- Some exhaustive edge-case coverage (e.g. current `planner.test.ts` is 653 LOC exercising branching in the scheduler) will shrink. That's the point: if an edge case isn't observable through the public surface, it isn't part of the contract.

Do this **only after** R1–R4 — otherwise we'd be migrating tests twice.

## Deferred cleanups

Known leaks/smells we're intentionally not fixing in this pass.

- **Test fixture leak** — [storage/service.test.ts](src/lib/storage/service.test.ts) and [settings/data-transfer.test.ts](src/lib/settings/data-transfer.test.ts) reach into `../session/persistence` to call `saveSession` as a fixture. Production boundaries are clean; only test code leaks. A `test-utils/fixtures.ts` wrapper would close the hole.

- **Scattered drill/threshold constants** — `LIVE_PRIORITY_TARGETS_TOP_N`, `DEFAULT_DRILL_TARGET_COUNT`, `DEFAULT_HIGH_ERROR_THRESHOLD`, etc. Revisit after R1–R4 so they land in their final domain.

- **`SessionShell.svelte` size (361 LOC)** — not splitting. User preference is "know where things are" over "separate concerns." The file orchestrates the session lifecycle + briefing header + progress bars honestly. Revisit only if genuine duplication appears.
