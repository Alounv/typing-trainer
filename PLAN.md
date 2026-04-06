# Typing Trainer — Implementation Plan

Based on the [technical specification](/Users/alounvangkeosay/Desktop/typing-trainer-spec.md).

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
| Keyboard viz | **Custom SVG component** | Heatmap requires full layout control |
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

### Directory Structure
```
src/
├── routes/                 # SvelteKit file-based routing
│   ├── +layout.svelte
│   ├── +page.svelte        # Landing / dashboard
│   ├── onboarding/
│   ├── session/
│   │   ├── bigram-drill/
│   │   ├── word-drill/
│   │   ├── real-text/
│   │   └── race/
│   ├── diagnostic/
│   ├── analytics/
│   └── settings/
├── lib/
│   ├── components/
│   │   ├── typing/         # Core typing input, pacer, display
│   │   ├── keyboard/       # SVG keyboard heatmap
│   │   ├── charts/         # Progress charts, sparklines
│   │   ├── session/        # Session UI chrome (timer, stats)
│   │   └── ui/             # Shared UI primitives
│   ├── models/             # TypeScript interfaces from spec §2
│   ├── engine/             # Core logic (keystroke capture, bigram extraction)
│   ├── diagnostic/         # Classification algorithm (§3)
│   ├── drills/             # Drill generators (§4)
│   ├── scheduler/          # Session scheduler (§5)
│   ├── corpus/             # Corpus management (§6)
│   ├── progress/           # Progress tracking & metrics (§10)
│   ├── stores/             # Svelte stores (reactive state)
│   └── storage/            # Dexie DB schema, persistence
├── data/                   # Built-in corpora JSON files
│   ├── en-top-1000.json
│   ├── en-top-5000.json
│   ├── fr-top-1000.json
│   ├── fr-top-5000.json
│   ├── en-prose.json
│   └── fr-prose.json
└── tests/
```

---

## Phase 1 — Core Data Models & Storage
> Implement all TypeScript interfaces and the persistence layer.

- [ ] **1.1** Define all interfaces from spec §2 in `lib/models/`
  - `KeystrokeEvent`, `BigramRecord`, `WordRecord`, `UserProfile`, `PacingProfile`, `CorpusConfig`, `SessionSummary`
- [ ] **1.2** Define progress-tracking interfaces from spec §10.7
  - `GraduationEvent`, `ClassificationSnapshot`, `ErrorFloorHistory`, `SDMHistory`, `ProgressStore`, `WeeklyReport`
- [ ] **1.3** Create Dexie database schema in `lib/storage/db.ts`
  - Tables: `sessions`, `bigramRecords`, `wordRecords`, `profile`, `progressStore`
- [ ] **1.4** Implement storage service with CRUD operations
- [ ] **1.5** Implement JSON export/import for backup (spec §9)
- [ ] **1.6** Write unit tests for storage layer

---

## Phase 2 — Keystroke Engine
> The foundation: capture keystrokes with `performance.now()` precision and derive bigram/word records.

- [ ] **2.1** `createKeystrokeCapture` Svelte action — captures raw `KeystrokeEvent` array
  - Listen to `keydown` events
  - Track expected vs actual characters
  - Detect corrections (backspace within 500ms)
  - Use `performance.now()` for all timestamps
- [ ] **2.2** Bigram extraction — `extractBigramRecords(events: KeystrokeEvent[]): BigramRecord[]`
  - Compute transition times, mean, std, error rates
  - Classify error types (wrong finger, adjacent key, transposition, omission)
- [ ] **2.3** Word extraction — `extractWordRecords(events: KeystrokeEvent[]): WordRecord[]`
  - Per-position timing arrays
  - Composite score calculation (spec §3.2)
- [ ] **2.4** Core typing display component — renders text with cursor, highlights current position, shows errors
- [ ] **2.5** Write comprehensive tests for extraction logic

---

## Phase 3 — Diagnostic Module
> Implement classification algorithm and pacing calibration.

- [ ] **3.1** Bigram classification engine (spec §3.1)
  - Configurable thresholds (`FAST_THRESHOLD`, `SLOW_THRESHOLD`, `HIGH_ERROR_THRESHOLD`, `HIGH_VARIANCE_THRESHOLD`)
  - Classification logic: healthy / fluency / hasty / acquisition + unstable sub-tag
- [ ] **3.2** Word composite score calculation (spec §3.2)
- [ ] **3.3** Position-in-word analysis — chunking gap detection (spec §3.3)
- [ ] **3.4** Pacing calibration session (spec §3.4)
  - Two-phase session: comfortable pace → push speed
  - Derive `comfortableWPM`, `ceilingWPM`, `trainingTargetWPM`
- [ ] **3.5** Diagnostic report generator (spec §7.3)
- [ ] **3.6** Unit tests for all classification and scoring logic

---

## Phase 4 — Corpus Management
> Load and manage word/bigram frequency data.

- [ ] **4.1** Create built-in corpus data files (spec §6.1)
  - English top 1000/5000 word lists with frequencies
  - French top 1000/5000 word lists
  - English and French prose excerpts
  - Pre-computed bigram frequency tables for each
- [ ] **4.2** Corpus loader — parse and validate corpus files
- [ ] **4.3** Custom corpus import (spec §6.2)
  - Text tokenization
  - Bigram/word frequency computation
  - Overlap analysis with built-in corpus
  - Size validation (≥500 unique bigrams)
  - Weighted merge with base corpus
- [ ] **4.4** Sentence selection algorithm for real-text sessions (spec §4.3)
- [ ] **4.5** Tests for corpus processing

---

## Phase 5 — Drill Engines
> Implement the four drill types from spec §4.

- [ ] **5.1** Bigram drill engine (spec §4.1)
  - CVC nonsense word generator for target bigrams
  - Interleave target (70%) and filler (30%) bigrams
  - Speed differentiation by classification (acquisition/hasty at 60% WPM, fluency at target WPM)
  - Session end trigger (15 consecutive correct + within 20% of target time, or 8 min)
- [ ] **5.2** Word drill engine (spec §4.2)
  - Blocked phase: repeat until 5 consecutive correct + 3 within target time
  - Chunking gap visual split guide
  - Interleaved phase: random order, free flow
- [ ] **5.3** Real text session engine (spec §4.3)
  - Sentence selection from corpus
  - No stop-on-error behavior
  - Backspace allowed but tracked
- [ ] **5.4** Race session engine (spec §4.4)
  - 100-word excerpt
  - Gross and net WPM calculation
  - Personal record tracking
- [ ] **5.5** Speed pacer component (spec §4.1)
  - Visual cursor/highlight advancing at target WPM
  - Color feedback: green / amber / red
- [ ] **5.6** Tests for drill sequence generation

---

## Phase 6 — Session Scheduler
> Auto-suggest daily session structure.

- [ ] **6.1** Default session structure (spec §5)
  - Bigram drill (8 min) → Word drill (7 min) → Real text (15 min)
- [ ] **6.2** Scheduler rules
  - Full diagnostic every 7 days
  - Remove bigram from rotation after 3 consecutive healthy sessions
  - Adjust `trainingTargetWPM` if error floor rising
  - Flag "stubborn patterns" after 4 drill sessions without progress
- [ ] **6.3** Session flow UI — show suggested structure, allow user overrides
- [ ] **6.4** Tests for scheduler logic

---

## Phase 7 — Onboarding Flow
> First-run experience per spec §8.

- [ ] **7.1** Layout + language selection screen
  - Support: QWERTY, Dvorak, AZERTY, Bépo
  - Languages: English, French (extensible)
- [ ] **7.2** Pacing calibration session (reuse Phase 3.4)
- [ ] **7.3** First diagnostic session
- [ ] **7.4** First diagnostic report display
- [ ] **7.5** Transition to daily session flow

---

## Phase 8 — Analytics & Progress UI
> Implement all visualization and progress components from spec §7 and §10.

- [ ] **8.1** Keyboard heatmap (spec §7.1)
  - SVG keyboard layout rendering (QWERTY, Bépo, etc.)
  - Speed heatmap and error heatmap toggles
  - Click-to-inspect: top 10 bigrams per key
  - Real-time color updates during drills (spec §10.3)
- [ ] **8.2** Classification bar (spec §10.6)
  - Stacked horizontal bar: acquisition / hasty / fluency / healthy
  - Side-by-side: today vs 4 weeks ago
- [ ] **8.3** WPM chart (spec §10.6)
  - Raw session dots + 7-session rolling average line + ±1σ envelope
- [ ] **8.4** Bigram sparklines (spec §10.6)
  - Mini line charts: mean transition time over last 8 sessions
- [ ] **8.5** Progress charts (spec §7.2)
  - Per-bigram: meanTime + errorRate over sessions
  - Per-session: WPM, error rate, bigrams graduating per week
- [ ] **8.6** Personal record board (spec §10.6)
  - Best session WPM, best smoothed WPM, fastest bigram, most graduations/week
- [ ] **8.7** "What This Means in Real Life" translation (spec §10.6)

---

## Phase 9 — Session Feedback & Celebrations
> Post-session summaries, weekly reports, milestone events.

- [ ] **9.1** Session delta card (spec §10.3)
  - WPM in context of rolling average
  - Bigrams drilled + graduated
  - Error floor status
  - Interpretive summary sentence
- [ ] **9.2** Bad session handling (spec §10.5)
  - Contextual attribution for drops >15% below average
  - Exclude outlier sessions from pacing target updates (>25% drop)
- [ ] **9.3** Graduation events (spec §10.4)
  - Inline callouts in post-session summary
  - Prominent callout when reaching healthy
- [ ] **9.4** WPM milestones (spec §10.4)
  - Full-screen acknowledgment at round numbers (60, 70, 80, 90, 100)
  - Show journey context (sessions taken, starting point)
- [ ] **9.5** Improvement streaks (spec §10.4)
  - Per-bigram consecutive improvement tracking
- [ ] **9.6** Weekly report (spec §10.3)
  - What got better / What's stubborn / What to focus on
  - Classification distribution diff
  - SDM delta, WPM delta
- [ ] **9.7** Plateau detection and messaging (spec §10.5)
  - Detect: no SDM or classification change over 10+ sessions
  - Surface concrete suggestions
- [ ] **9.8** Classification regression handling (spec §10.5)
  - Re-add regressed bigrams to drill rotation
  - Surface in weekly report

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
  └── Phase 1 (Models & Storage)
        ├── Phase 2 (Keystroke Engine)
        │     ├── Phase 3 (Diagnostic)
        │     │     ├── Phase 5 (Drills) ← also needs Phase 4
        │     │     └── Phase 7 (Onboarding) ← also needs Phase 5
        │     └── Phase 8 (Analytics UI) ← also needs Phase 3
        ├── Phase 4 (Corpus)
        └── Phase 9 (Feedback) ← needs Phases 3, 5, 8
              └── Phase 6 (Scheduler) ← needs Phases 3, 5
                    └── Phase 10 (Polish)
```

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
3. **Layout awareness**: Bigram badness normalized against layout expected difficulty. Bépo-specific frequency weighting for "ou", "en", "qu", "an".
4. **Never show raw WPM alone**: Always alongside smoothed trend.
5. **Interpretive messaging**: Every metric must answer "so what?" — the app provides conclusions, not just numbers.
6. **Celebration restraint**: Celebrate structural change (graduations, milestones), never effort (session completion, streaks of days).
