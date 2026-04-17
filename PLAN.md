# Typing Trainer — Implementation Plan

Based on the [technical specification](spec.md).

---

## Tech Stack Decision

| Layer     | Choice                              | Rationale                                                                                                                         |
| --------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Framework | **SvelteKit**                       | No virtual DOM = minimal overhead for keystroke capture; 100% client-side app doesn't need Next.js server features                |
| Language  | **TypeScript**                      | Spec is already in TS interfaces                                                                                                  |
| Styling   | **Tailwind CSS + DaisyUI**          | Rapid UI iteration, responsive by default; DaisyUI adds pre-built component classes (btn, card, modal, etc.) as a Tailwind plugin |
| State     | **Svelte stores**                   | Built-in reactive stores, no extra dependency needed                                                                              |
| Storage   | **IndexedDB via Dexie.js**          | Spec requires client-side storage, Dexie simplifies IndexedDB                                                                     |
| Charts    | **LayerCake**                       | Svelte-native charting, composable, good for sparklines + custom visualizations                                                   |
| Timing    | **`performance.now()`**             | Spec requirement for precision                                                                                                    |
| Testing   | **Vitest + Svelte Testing Library** | Fast, TS-native, SvelteKit default                                                                                                |

---

## Architecture: Fully Client-Side (No Backend)

This app runs **100% in the browser**. There is no server, no database, no API. All data lives in the user's browser via IndexedDB. SvelteKit is used purely as a frontend framework with static adapter for deployment.

### Pros

|                         |                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Zero infrastructure** | No server to provision, maintain, or pay for. Deploy as static files to any CDN (Vercel, Netlify, GitHub Pages).      |
| **Privacy by design**   | All typing data stays on the user's machine. No data leaves the browser. No GDPR concerns, no data breaches possible. |
| **Instant responses**   | No network round-trips for data reads/writes. Keystroke capture and analytics are real-time with no latency.          |
| **Works offline**       | Once loaded, the app works without internet. Can be enhanced with a service worker for full PWA support.              |
| **Simpler development** | No API layer to design, no auth system, no server deployment pipeline. One codebase, one build artifact.              |
| **Free to host**        | Static files on a CDN cost virtually nothing, even at scale.                                                          |

### Cons

|                                     |                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **No cross-device sync**            | User's progress is stuck on one browser. Clearing browser data = losing everything.                          |
| **No backups (by default)**         | If IndexedDB is wiped, data is gone. Mitigated by the JSON export/import feature (spec §9), but it's manual. |
| **No multiplayer/leaderboards**     | Would require a backend to add later (out of scope for v1 per spec §11).                                     |
| **Storage limits**                  | IndexedDB has browser-imposed quotas (usually 50%+ of disk, so plenty for this use case, but not unlimited). |
| **No server-side analytics**        | Can't track usage patterns or errors unless a third-party service is added.                                  |
| **Corpus updates require redeploy** | Adding new word lists or prose means publishing a new version of the app.                                    |

### Why it's the right call for this project

The typing trainer is fundamentally a **single-user, latency-sensitive, privacy-friendly** tool. The data is personal (keystroke timings, error patterns), the core loop demands sub-millisecond precision (`performance.now()`), and there's no interaction between users in v1. A backend would add complexity with no clear benefit. If cross-device sync or multiplayer is needed later, a lightweight sync layer can be added without rewriting the app.

---

## Release Slices

The phases below are build order, not release order. These slices define what it takes to cut a usable version at each stage — so scope can be trimmed honestly if time is short.

| Slice                    | Includes                            | What it's good for                                                                                                                 |
| ------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **v0.1** (internal demo) | Phases 0–3 + walking skeleton (2.5) | End-to-end: capture → store → diagnostic report. No drills, no progress tracking. Proves the core loop works.                      |
| **v0.5** (dogfood)       | Adds Phases 4–6, 8                  | Diagnostic + drill generation + session scheduling + per-session feedback. Usable daily for yourself, missing long-term analytics. |
| **v1.0** (ship)          | Adds Phases 7, 9, 10                | Onboarding, analytics dashboards, settings, polish. Shippable to others.                                                           |

If you have to cut, cut from v1.0 inward — not from v0.1 outward.

---

## Risks & Spikes

Prototype these before committing to the design. Each spike should answer a concrete go/no-go question within a few hours of exploration — if a spike fails, the relevant phase needs a different approach.

- **Keystroke capture perf under reactive re-renders.** Svelte's reactivity can re-run DOM updates on every `KeystrokeEvent` append. _Question:_ does capture stay sub-ms when the event array is reactive and the text display is rebinding per keystroke, or do we need an untracked buffer? Prototype by typing 500 chars at speed and measuring p99 event-handler duration.
- **IndexedDB quota & eviction.** Diagnostic sessions persist raw events; long-term usage could hit quota, especially under browser storage pressure. _Question:_ what's the realistic retention window, and do we need a pruning policy (e.g., keep last N diagnostics)? Check `navigator.storage.estimate()` behavior and Safari's 7-day eviction.
- **Svelte action lifecycle on dynamic text.** The typing action attaches to a node that may re-render when the text prop changes between drills. _Question:_ does the action correctly tear down and re-attach without losing events or double-counting? Prototype with sequential drill starts.
- **Corpus data sourcing & licensing.** Top-1000 word lists and prose excerpts must come from permissively licensed sources. _Question:_ which sources (OPUS, Project Gutenberg, Google Books n-grams, Leipzig Corpora) satisfy both license and frequency-data quality? Resolve before Phase 4.

---

## Testing Strategy

Not every module benefits equally from tests. Focus effort where correctness is non-obvious or where regressions are silent.

- **Classification boundaries (`bigram/classification.ts`).** Table-driven tests covering each boundary of `SPEED_THRESHOLD` × `HIGH_ERROR_THRESHOLD`, including exact-threshold inputs and insufficient-data cases. High value because thresholds are tunable and incorrect classification propagates into drill selection.
- **Timing precision (`typing/capture.ts`).** Synthetic event streams with known timestamps fed into capture — verify transition times, correction delays, and first-input-only bigram timing. Do not rely on real keyboard events in tests.
- **Drill determinism (`drill/*.ts`).** Generators take an injected RNG; tests use a seeded RNG to pin sequences. Lets us assert "given this diagnostic + corpus, produce this sequence" without flakiness.
- **Bigram extraction (`bigram/extraction.ts`).** Property-based tests: for any KeystrokeEvent[], aggregate counts must equal input counts; means must fall within [min, max]; no bigram appears twice per session.
- **Storage round-trip.** Write → read → compare — the only test storage really needs. Don't test Dexie's internals.
- **Manual / felt-experience checkpoints.** Pacer distraction, celebration tone, error highlight readability — these cannot be unit-tested. Flag in each phase for real-use evaluation before closing.

The scattered "write tests" checkboxes in phases below defer to this strategy.

---

## Phase 0 — Project Scaffolding

> Get the repo buildable with all tooling in place.

- [ ] **0.1** Initialize SvelteKit project with TypeScript, Tailwind, DaisyUI, ESLint
- [ ] **0.2** Install core dependencies: `dexie`, `layercake`, `uuid`
- [ ] **0.3** Set up project structure (see below)
- [ ] **0.4** Configure Vitest (included with SvelteKit)
- [ ] **0.5** Create `CLAUDE.md` with project conventions
- [ ] **0.6** Build app shell — root layout with navigation, session chrome (timer, stats bar), route structure

### Directory Structure

The architecture is organized by **domain boundary**, not by implementation layer. Each domain module owns its own types, logic, and (where applicable) UI components. Cross-cutting types that don't belong to any single domain live in `models/`.

```
src/
├── routes/                    # SvelteKit file-based routing (thin wiring layer)
│   ├── +layout.svelte
│   ├── +page.svelte           # Landing / dashboard
│   ├── onboarding/
│   ├── session/
│   │   ├── bigram-drill/
│   │   ├── real-text/
│   │   └── diagnostic/
│   ├── analytics/
│   └── settings/
├── lib/
│   ├── typing/                # Standalone typing surface — "the library"
│   │   ├── capture.ts         #   Svelte action: keydown → KeystrokeEvent[]
│   │   ├── TextDisplay.svelte #   Text renderer, cursor, error highlights
│   │   ├── Pacer.svelte       #   Speed pacer overlay (ghost cursor, color feedback)
│   │   └── types.ts           #   KeystrokeEvent, CaptureConfig
│   │   # Contract: takes text + config, emits KeystrokeEvent[].
│   │   # Zero knowledge of bigrams, classifications, or drills.
│   │
│   ├── bigram/                # Bigram analysis domain
│   │   ├── extraction.ts      #   KeystrokeEvent[] → BigramAggregate[]
│   │   ├── classification.ts  #   Threshold logic: healthy/fluency/hasty/acquisition
│   │   └── types.ts           #   BigramAggregate, BigramClassification
│   │
│   ├── diagnostic/            # Diagnostic domain (depends on: bigram/)
│   │   ├── engine.ts          #   Run diagnostic, produce report
│   │   ├── pacing.ts          #   baselineWPM / targetWPM derivation
│   │   └── types.ts           #   DiagnosticRawData, DiagnosticReport
│   │
│   ├── drill/                 # Drill generation — pure functions (depends on: corpus/, bigram/)
│   │   ├── bigram-drill.ts    #   Diagnostic + corpus → word sequence
│   │   ├── real-text.ts       #   Corpus + diagnostic → sentence selection
│   │   └── types.ts           #   DrillConfig, DrillSequence
│   │
│   ├── session/               # Session orchestration (wires typing/ + drill/)
│   │   ├── runner.ts          #   Lifecycle: start → capture → aggregation → end
│   │   ├── graduation.ts      #   In-session graduation check (15 correct + timing)
│   │   ├── components/        #   Session UI chrome (timer, stats bar)
│   │   └── types.ts           #   SessionSummary, SessionConfig
│   │
│   ├── corpus/                # Corpus domain (independent)
│   │   ├── loader.ts          #   Parse and validate corpus files
│   │   ├── merge.ts           #   Mixed-language corpus merging
│   │   ├── custom.ts          #   Custom corpus import, tokenization, validation
│   │   └── types.ts           #   CorpusConfig, FrequencyTable
│   │
│   ├── scheduler/             # Session planning (depends on: diagnostic/, session/)
│   │   ├── planner.ts         #   Daily structure suggestion, drill rotation
│   │   └── types.ts
│   │
│   ├── progress/              # Metrics, celebrations, regression detection (depends on: session/, bigram/)
│   │   ├── metrics.ts         #   SDM, error floor, WPM smoothing
│   │   ├── celebrations.ts    #   Graduation events, WPM milestones, streaks
│   │   ├── regression.ts      #   Plateau detection, classification regression
│   │   ├── components/        #   Charts (classification bar, sparklines, WPM chart)
│   │   └── types.ts           #   ProgressStore, DiagnosticProgressReport
│   │
│   ├── storage/               # Persistence layer (depends on: all domain types)
│   │   ├── db.ts              #   Dexie schema
│   │   ├── service.ts         #   CRUD operations
│   │   └── export.ts          #   JSON export/import
│   │
│   ├── models/                # Cross-cutting types only (UserSettings, shared enums)
│   │
│   ├── stores/                # Svelte stores (reactive state wiring)
│   │
│   └── components/            # Shared UI primitives (buttons, cards, modals)
│
├── data/                      # Built-in corpora JSON files
│   ├── en-top-1000.json
│   ├── fr-top-1000.json
│   ├── en-prose.json
│   └── fr-prose.json
└── tests/
```

### Domain Dependency Graph

```
typing/          (no dependencies — standalone)
  ↓ emits KeystrokeEvent[]
bigram/          (depends on: typing/types)
  ↓ produces BigramAggregate[]
diagnostic/      (depends on: bigram/)
corpus/          (independent)
drill/           (depends on: corpus/, bigram/)
session/         (depends on: typing/, drill/, bigram/)
scheduler/       (depends on: diagnostic/, session/)
progress/        (depends on: session/, bigram/)
storage/         (depends on: all domain types)
```

`typing/` is the most decoupled module — it could be extracted to a standalone package without touching any other domain.

---

## Phase 0.5 — CI & Deploy

> Get a green build and a live preview URL before writing domain code.

- [x] **0.5.1** Configure `@sveltejs/adapter-static` for SPA output
- [x] **0.5.2** GitHub Actions workflow: install → lint → typecheck → test → build
- [x] **0.5.3** Preview deploy target (Vercel / Netlify / GitHub Pages) wired to PRs
- [x] **0.5.4** Production deploy on merge to `main`
- [x] **0.5.5** Verify the deployed shell loads offline-ready (service worker optional for v0.1)

---

## Phase 1 — Domain Types & Storage

> Define types co-located with their domains, and implement the persistence layer.

- [x] **1.1** Define `typing/types.ts` — `KeystrokeEvent`, `CaptureConfig`
- [x] **1.2** Define `bigram/types.ts` — `BigramAggregate`, `BigramClassification`
- [x] **1.3** Define `session/types.ts` — `SessionSummary`, `SessionConfig`
- [x] **1.4** Define `diagnostic/types.ts` — `DiagnosticRawData`, `DiagnosticReport`
- [x] **1.5** Define `corpus/types.ts` — `CorpusConfig`, `FrequencyTable`
- [x] **1.6** Define `progress/types.ts` — `GraduationEvent`, `ClassificationSnapshot`, `ErrorFloorHistory`, `SDMHistory`, `ProgressStore`, `DiagnosticProgressReport`
- [x] **1.7** Define `models/` — cross-cutting types only (`UserSettings`, shared enums)
- [x] **1.8** Create Dexie database schema in `storage/db.ts`
  - Tables: `sessions`, `bigramRecords`, `diagnosticRawData`, `profile`, `progressStore` (5 tables — `diagnosticRawData` split off per spec §2.1 / §2.8)
- [x] **1.9** Implement storage service with CRUD operations
- [x] **1.11** Write unit tests for storage layer
- ~~**1.10** Implement JSON export/import for backup (spec §9)~~ — deferred to Phase 10.2, where the UI actually needs it

---

## Phase 2 — Typing Surface (`typing/`)

> The standalone typing input module. Takes text + config, emits KeystrokeEvent[]. No domain knowledge.

- [x] **2.1** `capture.ts` — Svelte action for keystroke capture
  - Listen to `keydown` events
  - Track expected vs actual characters
  - Detect corrections (backspace within 500ms)
  - Use `performance.now()` for all timestamps
- [x] **2.2** `TextDisplay.svelte` — text rendering component
  - Render text with cursor, highlight current position, show errors inline
  - Line wrapping behavior (word-boundary aware, no mid-word breaks)
  - Error styling (wrong char highlight, skipped char, extra char)
  - Backspace visual handling (cursor moves back, error state clears)
- [x] **2.3** `Pacer.svelte` — speed pacer overlay
  - Visual cursor/highlight advancing at configured WPM
  - Color feedback: green (on pace) / amber (slightly behind) / red (far behind)
- [ ] **2.4** Accessibility & focus management (load-bearing, not polish)
  - Focus trap on the typing surface during an active session
  - ARIA live region for error announcements (opt-in, off by default during timed drills)
  - Visible focus ring that doesn't interfere with cursor rendering
  - Verify screen reader doesn't re-announce every character — test with VoiceOver
- [x] **2.5** Write tests for capture logic (the module's public contract)

---

## Phase 2.5 — Walking Skeleton

> End-to-end vertical slice: capture one session → persist raw events → render a throwaway summary page. Proves the wiring works before going wide. This code is disposable; Phase 3+ replaces the summary page with the real diagnostic report.

- [x] **2.5.1** Hardcode a single short passage (no corpus yet)
- [x] **2.5.2** Wire `typing/capture` → session runner stub → Dexie `sessions` table
- [x] **2.5.3** Trivial summary page: raw WPM, error count, list of slowest 5 character-pair transitions
- [ ] **2.5.4** Smoke-test the full loop on the deployed preview URL

Exit criterion: you can go to the deployed app, type the passage, and see stored session data rendered on the next page. No classification, no drills, no pacer.

---

## Phase 2b — Bigram Analysis (`bigram/`)

> Pure computation: extract and classify bigram data from keystroke events.

- [x] **2b.1** `extraction.ts` — `extractBigramAggregates(events: KeystrokeEvent[]): BigramAggregate[]`
  - Compute transition times, mean, std, error rates
- [x] **2b.2** `classification.ts` — classify bigrams (spec §3.1)
  - Configurable thresholds (`SPEED_THRESHOLD`, `HIGH_ERROR_THRESHOLD`)
  - Classification logic: healthy / fluency / hasty / acquisition
- [x] **2b.3** Write comprehensive tests for extraction and classification

---

## Phase 3 — Diagnostic Module (`diagnostic/`)

> Orchestrates a diagnostic session, derives pacing, and produces reports. Depends on `bigram/`.

- [x] **3.1** `pacing.ts` — pacing derivation from diagnostic data (spec §3.3)
  - Derive `baselineWPM` from middle quartiles, compute `targetWPM` on-the-fly
- [x] **3.2** `engine.ts` — diagnostic report generator (spec §7.3)
  - Bigram breakdown by classification
  - Priority bigram targets (badness × corpus frequency)
  - Corpus coverage analysis
- [x] **3.3** Unit tests for pacing and report generation

---

## Phase 4 — Corpus Management

> Load and manage word/bigram frequency data.

- [ ] **4.1** Source and build built-in corpus data files (spec §6.1) — this is a real chunk of work, not a checkbox
  - [ ] **4.1a** Identify permissively licensed sources for each language (see Risks & Spikes) and record license terms in repo
  - [x] **4.1b** English top-1000 word list with frequencies _(MonkeyType-style ordered wordlist; also 5k + 10k sizes)_
  - [x] **4.1c** French top-1000 word list with frequencies _(actually 1500 words; also 10k size)_
  - [ ] **4.1d** English prose excerpts (length target: enough for §4.2 sentence selection)
  - [ ] **4.1e** French prose excerpts
  - [ ] **4.1f** Precomputed bigram frequency table per corpus (offline script checked into repo) _(currently derived at load time via Zipf approximation — no explicit counts in source data)_
  - [ ] **4.1g** Validation fixtures: hand-verified frequencies for ~20 sentinel words / bigrams per corpus to catch build-script regressions
- [x] **4.2** Corpus loader — parse and validate corpus files
- [x] **4.3** Mixed-language corpus merging (spec §6.2)
  - Weighted merge of word frequency tables across languages
  - Merged bigram frequency table computation
  - Interleaved text selection from both languages
- [x] **4.4** Custom corpus import (spec §6.3)
  - Text tokenization
  - Bigram/word frequency computation
  - Overlap analysis with built-in corpus
  - Size validation (≥500 unique bigrams)
  - Weighted merge with base corpus
- [x] **4.5** Sentence selection algorithm for real-text sessions (spec §4.2)
- [x] **4.6** Tests for corpus processing

---

## Phase 5 — Drill Generation & Session Orchestration (`drill/` + `session/`)

> `drill/` generates sequences (pure functions). `session/` manages lifecycle (wires `typing/` + `drill/`).

### Drill generation (`drill/`)

- [x] **5.1** `bigram-drill.ts` — bigram drill sequence generator (spec §4.1)
  - Real word selector from corpus (words containing target bigrams, weighted by frequency)
  - Interleave target (70%) and filler (30%) bigrams
  - Speed differentiation by classification (acquisition/hasty at 60% WPM, fluency at target WPM) _(pacing is not applied in this pure module — the session runner in Slice 2 will apply per-classification pacing when consuming the generated sequence)_
- [x] **5.2** `real-text.ts` — real text sentence selector (spec §4.2)
  - Sentence selection from corpus, weighted by non-healthy bigram density
  - Minimum 8 words per sentence
- [x] **5.3** Tests for drill sequence generation

### Session orchestration (`session/`)

- [x] **5.4** `runner.ts` — session lifecycle manager
  - Start → feed text to `typing/` → collect KeystrokeEvent[] → pass to `bigram/extraction` → persist via `storage/`
  - Manages timer, session end conditions
- [x] **5.5** `graduation.ts` — in-session graduation check
  - Follow spec §4.1: 14/15 recent correct AND last 5 within 20% of phase speed target. (No time-based timeout — sessions are pre-sized by word budget, so text exhaustion is the natural end.)
- [x] **5.6** Session UI chrome (`session/components/`) — timer, stats bar
- [x] **5.7** Tests for session runner and graduation logic
- [x] **5.8** Mini-session model — drills and real-text sessions are intentionally small (~15–25 words, <1 min each). The scheduler emits 4 drill + 4 real-text mini-sessions interleaved, so each completion is its own checkpoint and abandoning mid-plan costs at most one mini-session.

---

## Phase 6 — Session Scheduler

> Auto-suggest daily session structure.

- [x] **6.1** Default session structure (spec §5)
  - 4 interleaved pairs of [bigram drill (15 words), real text (25 words)] per daily plan
- [x] **6.2** Scheduler rules
  - Full diagnostic every 28 non-diagnostic sessions (or on demand) — scaled from 7 to match mini-session volume
  - Alternate between bigram drill and real text (interleave within a day)
  - Remove bigram from rotation after 3 consecutive healthy sessions
- [x] **6.3** Dashboard page — suggested session structure, today's drill targets, quick-start buttons, allow user overrides
- [x] **6.4** Tests for scheduler logic

---

## Phase 6.5 — Settings

> User-facing configuration surface. Lands here because by now every setting it exposes (corpus, thresholds, word budget) has a live consumer.

- [ ] **6.5.1** Settings page
  - Language / corpus selection
  - Threshold configuration (for advanced users)
  - Per-session word budget preferences (drill / real-text / diagnostic)

---

## Phase 7 — Onboarding Flow

> First-run experience per spec §8.

- [ ] **7.1** Language selection screen
  - Languages: English, French (extensible), supports selecting multiple languages
- [ ] **7.2** First diagnostic session (also derives baselineWPM)
- [ ] **7.3** First diagnostic report display
- [ ] **7.4** Transition to daily session flow

---

## Phase 8 — Session Feedback

> Post-session summaries and session-level feedback — what the user sees after every session.

- [ ] **8.1** Session delta card (spec §10.3)
  - WPM in context of rolling average
  - Bigrams drilled + graduated
  - Error floor status
  - Interpretive summary sentence
- [ ] **8.2** Bad session handling (spec §10.5)
  - Contextual attribution for drops >15% below average
  - Exclude outlier sessions from pacing target updates (>25% drop)
- [ ] **8.3** Graduation events (spec §10.4)
  - Inline callouts in post-session summary
  - Prominent callout when reaching healthy
- [ ] **8.4** WPM milestones (spec §10.4)
  - Full-screen acknowledgment at round numbers (60, 70, 80, 90, 100)
  - Show journey context (sessions taken, starting point)
- [ ] **8.5** Improvement streaks (spec §10.4)
  - Per-bigram consecutive improvement tracking

---

## Phase 9 — Analytics, Progress & Celebrations

> Dashboards, charts, diagnostic reports, and long-term progress tracking.

- [ ] **9.1** Bigram table (spec §7.1)
  - Sortable table: bigram, classification, mean time, error rate, occurrences, trend
  - Default sort: badness × corpus frequency descending
- [ ] **9.2** Classification bar (spec §10.6)
  - Stacked horizontal bar: acquisition / hasty / fluency / healthy
  - Side-by-side: current vs previous diagnostic
- [ ] **9.3** WPM chart (spec §10.6)
  - Raw session dots + 7-session rolling average line + ±1σ envelope
- [ ] **9.4** Bigram sparklines (spec §10.6)
  - Mini line charts: mean transition time over last 8 sessions
- [ ] **9.5** Progress charts (spec §7.2)
  - Per-bigram: meanTime + errorRate over sessions
  - Per-session: WPM, error rate, bigrams graduating per diagnostic period
- [ ] **9.6** Diagnostic progress report (spec §10.3)
  - What got better / What's stubborn / What to focus on
  - Classification distribution diff
  - SDM delta, WPM delta
- [ ] **9.7** Plateau detection and messaging (spec §10.5)
  - Detect: no SDM or classification change over 10+ sessions
  - Surface concrete suggestions
- [ ] **9.8** Classification regression handling (spec §10.5)
  - Re-add regressed bigrams to drill rotation
  - Surface in diagnostic report

---

## Phase 10 — Settings & Polish

> Final touches for v1.

- [ ] **10.1** Data export/import — JSON serialize/deserialize logic (`storage/export.ts`) + UI (deferred from Phase 1.10)
- [ ] **10.2** Responsive layout (desktop-first, per spec §11)
- [ ] **10.3** Keyboard shortcut support for session navigation
- [x] **10.4** Dark mode
- [ ] **10.5** Accessibility follow-up pass (non-typing surfaces: dashboards, settings, modals — typing surface a11y lives in Phase 2.4)
- [ ] **10.6** Performance audit (ensure keystroke capture has zero lag; re-run the Phase 2 perf spike on low-end hardware)

---

## Dependency Graph

```
Phase 0 (Scaffolding)
  └── Phase 0.5 (CI & Deploy) ← green pipeline before domain code
        └── Phase 1 (Domain Types & Storage)
              ├── Phase 2 (Typing Surface) ─── standalone, no domain deps
              │     └── Phase 2.5 (Walking Skeleton) ← v0.1 exit gate
              │           └── Phase 2b (Bigram Analysis) ─── depends on typing/types
              │                 └── Phase 3 (Diagnostic) ─── depends on bigram/
              │                       ├── Phase 5 (Drill + Session) ← also needs Phase 4
              │                       │     ├── Phase 6 (Scheduler) ← also needs Phase 3
              │                       │     └── Phase 8 (Session Feedback)
              │                       └── Phase 7 (Onboarding) ← also needs Phase 5
              ├── Phase 4 (Corpus) ─── independent, can parallel Phase 2
              └── Phase 9 (Analytics & Progress) ← needs Phases 3, 5, 8
                    └── Phase 10 (Polish)
```

Notes:

- Phases 2 and 4 have no mutual dependency and can be built in parallel.
- Phase 2.5 (Walking Skeleton) is a throwaway milestone — its summary page gets replaced once Phase 3 lands. Don't polish it.

---

## Out of Scope (v1)

Per spec §11:

- Multiplayer / leaderboards
- Mobile / touchscreen support
- Voice or audio feedback
- Ergonomics / RSI guidance

---

## Key Implementation Notes

1. **Code readability**: Favor comments that make the code easy to read. Explain the _why_ on anything non-obvious — domain constants, threshold choices, algorithmic decisions, workarounds, invariants. Type fields and tunable constants should carry a short comment when the name alone doesn't make the intent clear. The default elsewhere is "no comments unless necessary"; in this project the default is "comment for the next reader".
2. **Timing precision**: All keystroke timestamps via `performance.now()`. No debouncing during capture — record raw, filter in post-processing.
3. **Minimum data**: Each bigram needs ≥10 occurrences for classification, ≥20 for stability. Diagnostic sessions must guarantee ≥15 occurrences of top 200 corpus bigrams.
4. **Never show raw WPM alone**: Always alongside smoothed trend.
5. **Interpretive messaging**: Every metric must answer "so what?" — the app provides conclusions, not just numbers.
6. **Celebration restraint**: Celebrate structural change (graduations, milestones), never effort (session completion, streaks of days).
