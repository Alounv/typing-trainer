# Typing Trainer — Implementation Plan

Based on the [technical specification](spec.md).

---

## Tech Stack Decision

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | **SvelteKit** | No virtual DOM = minimal overhead for keystroke capture; 100% client-side app doesn't need Next.js server features |
| Language | **TypeScript** | Spec is already in TS interfaces |
| Styling | **Tailwind CSS + DaisyUI** | Rapid UI iteration, responsive by default; DaisyUI adds pre-built component classes (btn, card, modal, etc.) as a Tailwind plugin |
| State | **Svelte stores** | Built-in reactive stores, no extra dependency needed |
| Storage | **IndexedDB via Dexie.js** | Spec requires client-side storage, Dexie simplifies IndexedDB |
| Charts | **LayerCake** | Svelte-native charting, composable, good for sparklines + custom visualizations |
| Timing | **`performance.now()`** | Spec requirement for precision |
| Testing | **Vitest + Svelte Testing Library** | Fast, TS-native, SvelteKit default |

---

## Architecture: Fully Client-Side (No Backend)

This app runs **100% in the browser**. There is no server, no database, no API. All data lives in the user's browser via IndexedDB. SvelteKit is used purely as a frontend framework with static adapter for deployment.

### Pros

| | |
|---|---|
| **Zero infrastructure** | No server to provision, maintain, or pay for. Deploy as static files to any CDN (Vercel, Netlify, GitHub Pages). |
| **Privacy by design** | All typing data stays on the user's machine. No data leaves the browser. No GDPR concerns, no data breaches possible. |
| **Instant responses** | No network round-trips for data reads/writes. Keystroke capture and analytics are real-time with no latency. |
| **Works offline** | Once loaded, the app works without internet. Can be enhanced with a service worker for full PWA support. |
| **Simpler development** | No API layer to design, no auth system, no server deployment pipeline. One codebase, one build artifact. |
| **Free to host** | Static files on a CDN cost virtually nothing, even at scale. |

### Cons

| | |
|---|---|
| **No cross-device sync** | User's progress is stuck on one browser. Clearing browser data = losing everything. |
| **No backups (by default)** | If IndexedDB is wiped, data is gone. Mitigated by the JSON export/import feature (spec §9), but it's manual. |
| **No multiplayer/leaderboards** | Would require a backend to add later (out of scope for v1 per spec §11). |
| **Storage limits** | IndexedDB has browser-imposed quotas (usually 50%+ of disk, so plenty for this use case, but not unlimited). |
| **No server-side analytics** | Can't track usage patterns or errors unless a third-party service is added. |
| **Corpus updates require redeploy** | Adding new word lists or prose means publishing a new version of the app. |

### Why it's the right call for this project

The typing trainer is fundamentally a **single-user, latency-sensitive, privacy-friendly** tool. The data is personal (keystroke timings, error patterns), the core loop demands sub-millisecond precision (`performance.now()`), and there's no interaction between users in v1. A backend would add complexity with no clear benefit. If cross-device sync or multiplayer is needed later, a lightweight sync layer can be added without rewriting the app.

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

## Phase 1 — Domain Types & Storage
> Define types co-located with their domains, and implement the persistence layer.

- [ ] **1.1** Define `typing/types.ts` — `KeystrokeEvent`, `CaptureConfig`
- [ ] **1.2** Define `bigram/types.ts` — `BigramAggregate`, `BigramClassification`
- [ ] **1.3** Define `session/types.ts` — `SessionSummary`, `SessionConfig`
- [ ] **1.4** Define `diagnostic/types.ts` — `DiagnosticRawData`
- [ ] **1.5** Define `corpus/types.ts` — `CorpusConfig`, `FrequencyTable`
- [ ] **1.6** Define `progress/types.ts` — `GraduationEvent`, `ClassificationSnapshot`, `ErrorFloorHistory`, `SDMHistory`, `ProgressStore`, `DiagnosticProgressReport`
- [ ] **1.7** Define `models/` — cross-cutting types only (`UserSettings`, shared enums)
- [ ] **1.8** Create Dexie database schema in `storage/db.ts`
  - Tables: `sessions`, `bigramRecords`, `profile`, `progressStore`
- [ ] **1.9** Implement storage service with CRUD operations
- [ ] **1.10** Implement JSON export/import for backup (spec §9)
- [ ] **1.11** Write unit tests for storage layer

---

## Phase 2 — Typing Surface (`typing/`)
> The standalone typing input module. Takes text + config, emits KeystrokeEvent[]. No domain knowledge.

- [ ] **2.1** `capture.ts` — Svelte action for keystroke capture
  - Listen to `keydown` events
  - Track expected vs actual characters
  - Detect corrections (backspace within 500ms)
  - Use `performance.now()` for all timestamps
- [ ] **2.2** `TextDisplay.svelte` — text rendering component
  - Render text with cursor, highlight current position, show errors inline
  - Line wrapping behavior (word-boundary aware, no mid-word breaks)
  - Error styling (wrong char highlight, skipped char, extra char)
  - Backspace visual handling (cursor moves back, error state clears)
- [ ] **2.3** `Pacer.svelte` — speed pacer overlay
  - Visual cursor/highlight advancing at configured WPM
  - Color feedback: green (on pace) / amber (slightly behind) / red (far behind)
- [ ] **2.4** Write tests for capture logic (the module's public contract)

---

## Phase 2b — Bigram Analysis (`bigram/`)
> Pure computation: extract and classify bigram data from keystroke events.

- [ ] **2b.1** `extraction.ts` — `extractBigramAggregates(events: KeystrokeEvent[]): BigramAggregate[]`
  - Compute transition times, mean, std, error rates
- [ ] **2b.2** `classification.ts` — classify bigrams (spec §3.1)
  - Configurable thresholds (`SPEED_THRESHOLD`, `HIGH_ERROR_THRESHOLD`)
  - Classification logic: healthy / fluency / hasty / acquisition
- [ ] **2b.3** Write comprehensive tests for extraction and classification

---

## Phase 3 — Diagnostic Module (`diagnostic/`)
> Orchestrates a diagnostic session, derives pacing, and produces reports. Depends on `bigram/`.

- [ ] **3.1** `pacing.ts` — pacing derivation from diagnostic data (spec §3.3)
  - Derive `baselineWPM` from middle quartiles, compute `targetWPM` on-the-fly
- [ ] **3.2** `engine.ts` — diagnostic report generator (spec §7.3)
  - Bigram breakdown by classification
  - Priority bigram targets (badness × corpus frequency)
  - Corpus coverage analysis
- [ ] **3.3** Unit tests for pacing and report generation

---

## Phase 4 — Corpus Management
> Load and manage word/bigram frequency data.

- [ ] **4.1** Create built-in corpus data files (spec §6.1)
  - English top 1000 word list with frequencies
  - French top 1000 word list with frequencies
  - English and French prose excerpts
  - Pre-computed bigram frequency tables for each corpus
- [ ] **4.2** Corpus loader — parse and validate corpus files
- [ ] **4.3** Mixed-language corpus merging (spec §6.2)
  - Weighted merge of word frequency tables across languages
  - Merged bigram frequency table computation
  - Interleaved text selection from both languages
- [ ] **4.4** Custom corpus import (spec §6.3)
  - Text tokenization
  - Bigram/word frequency computation
  - Overlap analysis with built-in corpus
  - Size validation (≥500 unique bigrams)
  - Weighted merge with base corpus
- [ ] **4.5** Sentence selection algorithm for real-text sessions (spec §4.2)
- [ ] **4.6** Tests for corpus processing

---

## Phase 5 — Drill Generation & Session Orchestration (`drill/` + `session/`)
> `drill/` generates sequences (pure functions). `session/` manages lifecycle (wires `typing/` + `drill/`).

### Drill generation (`drill/`)
- [ ] **5.1** `bigram-drill.ts` — bigram drill sequence generator (spec §4.1)
  - Real word selector from corpus (words containing target bigrams, weighted by frequency)
  - Interleave target (70%) and filler (30%) bigrams
  - Speed differentiation by classification (acquisition/hasty at 60% WPM, fluency at target WPM)
- [ ] **5.2** `real-text.ts` — real text sentence selector (spec §4.2)
  - Sentence selection from corpus, weighted by non-healthy bigram density
  - Minimum 8 words per sentence
- [ ] **5.3** Tests for drill sequence generation

### Session orchestration (`session/`)
- [ ] **5.4** `runner.ts` — session lifecycle manager
  - Start → feed text to `typing/` → collect KeystrokeEvent[] → pass to `bigram/extraction` → persist via `storage/`
  - Manages timer, session end conditions
- [ ] **5.5** `graduation.ts` — in-session graduation check
  - 14/15 recent correct + within 20% of target time, or 5 min timeout
- [ ] **5.6** Session UI chrome (`session/components/`) — timer, stats bar
- [ ] **5.7** Tests for session runner and graduation logic

---

## Phase 6 — Session Scheduler
> Auto-suggest daily session structure.

- [ ] **6.1** Default session structure (spec §5)
  - Bigram drill (5 min) → Real text (10 min)
- [ ] **6.2** Scheduler rules
  - Full diagnostic every 7 sessions (or on demand)
  - Alternate between bigram drill and real text
  - Remove bigram from rotation after 3 consecutive healthy sessions
- [ ] **6.3** Dashboard page — suggested session structure, today's drill targets, quick-start buttons, allow user overrides
- [ ] **6.4** Tests for scheduler logic

---

## Phase 7 — Onboarding Flow
> First-run experience per spec §8.

- [ ] **7.1** Layout + language selection screen
  - Support: QWERTY, Dvorak, AZERTY, Bépo
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

- [ ] **10.1** Settings page
  - Layout selection
  - Language / corpus selection
  - Threshold configuration (for advanced users)
  - Session duration preferences
- [ ] **10.2** Data export/import UI
- [ ] **10.3** Responsive layout (desktop-first, per spec §11)
- [ ] **10.4** Keyboard shortcut support for session navigation
- [ ] **10.5** Dark mode
- [ ] **10.6** Accessibility pass (ARIA labels, focus management during typing)
- [ ] **10.7** Performance audit (ensure keystroke capture has zero lag)

---

## Dependency Graph

```
Phase 0 (Scaffolding)
  └── Phase 1 (Domain Types & Storage)
        ├── Phase 2 (Typing Surface) ─── standalone, no domain deps
        │     └── Phase 2b (Bigram Analysis) ─── depends on typing/types
        │           └── Phase 3 (Diagnostic) ─── depends on bigram/
        │                 ├── Phase 5 (Drill + Session) ← also needs Phase 4
        │                 │     ├── Phase 6 (Scheduler) ← also needs Phase 3
        │                 │     └── Phase 8 (Session Feedback)
        │                 └── Phase 7 (Onboarding) ← also needs Phase 5
        ├── Phase 4 (Corpus) ─── independent, can parallel Phase 2
        └── Phase 9 (Analytics & Progress) ← needs Phases 3, 5, 8
              └── Phase 10 (Polish)
```

Note: Phases 2 and 4 have no mutual dependency and can be built in parallel.

---

## Out of Scope (v1)
Per spec §11:
- Multiplayer / leaderboards
- Mobile / touchscreen support
- Voice or audio feedback
- Ergonomics / RSI guidance
- Auto-layout detection

---

## Key Implementation Notes

1. **Timing precision**: All keystroke timestamps via `performance.now()`. No debouncing during capture — record raw, filter in post-processing.
2. **Minimum data**: Each bigram needs ≥10 occurrences for classification, ≥20 for stability. Diagnostic sessions must guarantee ≥15 occurrences of top 200 corpus bigrams.
3. **Never show raw WPM alone**: Always alongside smoothed trend.
4. **Interpretive messaging**: Every metric must answer "so what?" — the app provides conclusions, not just numbers.
5. **Celebration restraint**: Celebrate structural change (graduations, milestones), never effort (session completion, streaks of days).
