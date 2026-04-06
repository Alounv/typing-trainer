# Typing Trainer — Technical Specification

## 1. Vision & Scope

A web application that improves typing speed through scientifically grounded practice: diagnostic measurement, pattern-level weakness identification, and targeted drills calibrated to the user's specific motor learning state. The app is corpus-aware (language and domain-sensitive), distinguishes between accuracy and fluency bottlenecks, and adapts session structure accordingly.

This spec covers data models, system modules, UX flows, and session logic. It does not dictate stack choices, but notes where certain architectural decisions matter.

---

## 2. Core Data Models

### 2.1 Storage Strategy

Keystroke events are the raw input. Bigram statistics are **derived aggregates**, computed in-memory during a session and persisted as summaries at session end. Raw keystroke events are only persisted for **diagnostic sessions** (needed for reclassification with updated thresholds). Drill session keystrokes are discarded after aggregates are computed.

This means bigram aggregates cannot be retroactively recomputed for drill sessions — an acceptable tradeoff for keeping storage bounded.

### 2.2 KeystrokeEvent

The atomic unit collected during any typing session. Held in memory during all sessions; persisted to disk only for diagnostic sessions.

**Bigram transition time** = keydown timestamp of the second character minus keydown timestamp of the first character. Space is treated as a regular character for bigram purposes, so word-boundary bigrams like `"e "` and `" t"` are valid and measured.

```ts
interface KeystrokeEvent {
  timestamp: number          // ms since session start (via performance.now())
  expected: string           // the character the user should have typed
  actual: string             // the character the user typed
  position: number           // index in the current sequence
  wordIndex: number          // index of the current word in the sequence
  positionInWord: number     // index within the current word (0 = word-initial)
}
```

Note: `corrected` and `correctionDelay` are computed in post-processing (they require lookahead for a subsequent backspace), not recorded on the raw event.

**Backspace / correction model:**
- The **first input** at each position is what counts for error rate — a backspace does not erase the error
- Bigram transition time is measured on **first inputs only** — correction time (backspace + retype) is excluded from timing
- `corrected: boolean` (whether the user backspaced and retyped) and `correctionDelay: number` (ms spent correcting) are tracked for analytics but do not affect classification

### 2.3 BigramAggregate

Derived from keystroke events at session end. One record per bigram per session. This is what gets persisted.

```ts
interface BigramAggregate {
  bigram: string             // e.g. "th"
  sessionId: string
  occurrences: number
  meanTime: number           // mean transition time in ms
  stdTime: number
  errorCount: number
  errorRate: number          // errorCount / occurrences
  classification: 'healthy' | 'fluency' | 'hasty' | 'acquisition'  // snapshot at session-time thresholds; not recomputed if thresholds change
}
```

### 2.4 UserSettings

Persistent user configuration. Separated from session data.

```ts
interface UserSettings {
  layout: string               // 'bépo' | 'azerty' | 'qwerty' | 'dvorak' | ...
  languages: string[]           // e.g. ['en'], ['fr', 'en'] — order = priority
  corpusIds: string[]           // references CorpusConfig entries, one per language
}
```

### 2.5 Pacing

`baselineWPM` is derived from the most recent diagnostic session data (middle quartiles of WPM — see §3.3). `targetWPM` = `baselineWPM × 1.17`, computed on-the-fly. No separate stored entity needed.

### 2.6 CorpusConfig

```ts
interface CorpusConfig {
  id: string
  language: string
  wordlistId: string            // e.g. 'fr-top-5000', 'en-top-1000'
  customText?: string           // optional user-supplied text
}
```

Bigram and word frequency tables are derived from the corpus text at import time and recomputed on any corpus change. They are not stored as part of the config.

**Mixed-language support:** When a user selects multiple languages, the corpora are merged into a single bigram/word frequency table weighted by language priority order. Diagnostics and drills draw from the merged corpus, so bigrams common in both languages (e.g. "th" in English, "le" in French) are weighted higher. Words in bigram drills are selected from whichever language contains the target bigram most frequently.

### 2.7 SessionSummary

Session metadata and aggregate results. Raw keystroke events stored separately, only for diagnostic sessions.

```ts
interface SessionSummary {
  id: string
  timestamp: number
  type: 'diagnostic' | 'bigram-drill' | 'real-text'
  durationMs: number
  wpm: number
  errorRate: number
  bigramsTargeted?: string[]
  bigramAggregates: BigramAggregate[]
}
```

### 2.8 DiagnosticRawData

Persisted only for diagnostic sessions. Allows reclassification with updated thresholds.

```ts
interface DiagnosticRawData {
  sessionId: string
  events: KeystrokeEvent[]
}
```

---

## 3. Diagnostic Module

### 3.1 Bigram Classification Algorithm

Run after collecting enough occurrences (minimum 10 per bigram, ideally 20+).

**Thresholds** (configurable, defaults below):
- `SPEED_THRESHOLD`: 150ms mean transition time
- `HIGH_ERROR_THRESHOLD`: 0.05 (5% error rate)

**Classification logic:**

```
if meanTime <= SPEED_THRESHOLD AND errorRate < HIGH_ERROR_THRESHOLD → 'healthy'
if meanTime <= SPEED_THRESHOLD AND errorRate >= HIGH_ERROR_THRESHOLD → 'hasty'
if meanTime > SPEED_THRESHOLD AND errorRate < HIGH_ERROR_THRESHOLD → 'fluency'
if meanTime > SPEED_THRESHOLD AND errorRate >= HIGH_ERROR_THRESHOLD → 'acquisition'

```

**Each classification maps to a training prescription:**

| Classification | Meaning | Treatment |
|---|---|---|
| `healthy` | Skip | No action needed |
| `fluency` | Program exists, not fast | Speed bursts above ceiling |
| `hasty` | Rush errors under speed pressure | Slow deliberate repetition first |
| `acquisition` | Program missing or wrong | Blocked slow drill, then consolidation |

### 3.2 Bigram Lifecycle

A bigram has two orthogonal dimensions of state: its **classification** (`acquisition`, `hasty`, `fluency`, `healthy`) and its **drill status** (`in-rotation`, `monitored`, `retired`).

**Drill status transitions:**

```
  [unobserved] ──▶ [drilling] ──▶ [healthy]
                       ▲              │
                       └──────────────┘
                        (regression)
```

- **unobserved → drilling**: first diagnostic classifies the bigram as non-healthy.
- **drilling → healthy**: bigram classified as `healthy` at end of a diagnostic. Removed from active drills but still tracked in every session it appears in.
- **healthy → drilling**: bigram regresses to a non-healthy classification during a diagnostic. Re-added to drills. Surfaced in the diagnostic report.

**Classification transitions:**

All classification changes happen at **diagnostic boundaries** — never mid-drill. Drill sessions produce aggregates that feed into the next diagnostic, but they don't reclassify on their own. This keeps the classification stable and avoids confusing the user with mid-week fluctuations.

Valid transitions (any direction is possible, but typical progressions are):
- `acquisition → hasty` (errors persist but speed improves)
- `acquisition → fluency` (speed still slow but errors resolved)
- `hasty → fluency` (user slows down, errors drop)
- `fluency → healthy` (speed catches up)
- `hasty → healthy` (speed was already there, errors resolved)
- `acquisition → healthy` (skip — rare but valid, e.g. after intensive blocked drilling)

Regressions (any non-healthy → worse classification, or `healthy` → any) are valid and surfaced explicitly.

**Drill session graduation vs. classification change:** graduating a drill (15 consecutive correct + timing target met) means the bigram is done *for that session*. It does not change the bigram's classification — that only happens at the next diagnostic.

### 3.3 Pacing Derivation

`baselineWPM` is derived from diagnostic session data: take the middle quartiles of WPM (discard slowest and fastest deciles). `targetWPM` = baselineWPM × 1.17 (adjustable, computed on-the-fly). Updated every time a diagnostic runs — no separate calibration session needed.

---

## 4. Drill Phase Modules

### 4.1 Bigram Drill Session

**Input:** Ranked list of target bigrams from diagnostic, with classifications.

**Sequence generation:**
1. Select real words from the corpus that contain the target bigram, weighted by word frequency (e.g. for "th" → "the", "that", "with", "other")
2. Interleave with filler words containing healthy bigrams at ratio 70% target / 30% filler
3. Group by classification:
   - `acquisition` and `hasty` bigrams: start at 60% of baselineWPM, no speed pressure
   - `fluency` bigrams: target targetWPM, use visual pacer

**Speed pacer:**
- Optional bouncing cursor or highlight advancing at targetWPM
- Visual feedback: green if on pace, amber if slightly behind, red if far behind
- Do not penalize errors during speed-push phase beyond visual indication

**Session end trigger:**
- Stop a bigram target when: 14 out of 15 most recent occurrences correct AND last 5 are within 20% of phase speed target
- Phase speed targets: `acquisition` and `hasty` bigrams target 60% of baselineWPM; `fluency` bigrams target targetWPM
- Or: session time limit reached (default 5 minutes)

**Output per bigram:** updated BigramRecord appended to bigramHistory.

### 4.2 Real Text Session

**Input:** Corpus excerpt. Selection algorithm:
1. Prefer sentences with high density of non-healthy bigrams (target bigrams from diagnostic)
2. Prefer sentences containing common words with `fluency`-classified bigrams (since real text is where speed gains transfer)
3. Minimum sentence length: 8 words (shorter = too many word-boundary effects, not representative)

**Pacer:** ghost cursor running at targetWPM. User can toggle off.

**No stop-on-error:** user types through errors. Errors are recorded but not corrected mid-stream (mirrors real use conditions). Backspace allowed but not penalized beyond time cost.

**Session exit condition:** user-chosen duration (default 10 minutes) or word count.

**Output:** full KeystrokeEvent log; update bigramHistory for all encountered patterns.

---

## 5. Session Scheduler

The app should suggest a daily session structure rather than leaving the user to choose manually. This is important for progression and avoiding over-drilling.

**Default daily structure (15 min):**

| Phase | Duration | Type |
|---|---|---|
| Bigram drill | 5 min | Targeted, from diagnostic |
| Real text | 10 min | Corpus-based |

**Scheduler rules:**
- Run full diagnostic every 7 sessions (or on demand)
- Each session contains both phases (bigram drill followed by real text) as shown above
- After 3 consecutive sessions where a bigram is `healthy`, remove from drill rotation

---

## 6. Corpus Management

### 6.1 Built-in Corpora

The app should ship with at minimum:
- `en-top-1000`, `en-top-5000` (English frequency lists)
- `fr-top-1000`, `fr-top-5000` (French frequency lists — important for Bépo users)
- `fr-prose` — excerpts from public domain French prose (Maupassant, Zola, etc.)
- `en-prose` — English prose equivalents

Each corpus includes:
- Word frequency table
- Pre-computed bigram frequency table for that corpus
- Recommended layout pairings

### 6.2 Mixed-Language Corpora

When a user selects multiple languages, the app merges their corpora:
1. Combine word frequency tables, applying a weight per language (default: equal weight, user-adjustable)
2. Weight is expressed as **proportion of words** in the diagnostic session — e.g. 70% French / 30% English means 70% of diagnostic words are drawn from the French corpus. The user sets this in settings.
3. Recompute the merged bigram frequency table from the combined word lists, scaled by the same word proportion weights
4. Diagnostic sessions draw text from both languages, interleaved according to the weight ratio
5. Bigram drill word selection pulls from whichever language has the best word for a given target bigram

### 6.3 Custom Corpus Import

User can paste or upload their own text (code, emails, domain-specific writing). The app:
1. Tokenizes and computes word and bigram frequencies
2. Computes overlap with built-in bigram frequency table
3. Warns if corpus is too small (<500 unique bigrams) for reliable diagnostics
4. Merges with base corpus at user-specified weight (e.g. 70% custom / 30% base)

---

## 7. Analytics & Progress Views

### 7.1 Bigram Table

Sortable table of all observed bigrams showing: bigram, classification, mean transition time, error rate, occurrences, and trend (improving / flat / regressing). Default sort: badness × corpus frequency descending (worst first).

### 7.2 Progress Charts

Per bigram: line chart of meanTime and errorRate over time (sessions on X axis). Should show the "slow down then speed up" pattern clearly when acquisition is working correctly.

Per session: WPM over time, error rate over time, number of bigrams graduating out of drill rotation per week.

### 7.3 Diagnostic Report

Generated after each diagnostic session. Structured output:

```
Diagnostic Report — [date]

Pacing:
  Baseline: 68 WPM
  Target: 79 WPM (baseline × 1.17)

Bigram breakdown:
  Healthy: 312 bigrams
  Fluency bottlenecks (top 5): "sc", "mp", "wr", "qu", "pl"
  Hasty patterns (top 5): "ti", "ng", "er", "ou", "in"
  Acquisition gaps: "wh", "ck"

Priority bigram targets (top 10):
  [bigram list with badness × corpus frequency scores]

Corpus fit:
  Training coverage: 87% of your corpus bigrams have ≥10 observations
  Undertrained: [list of frequent corpus bigrams with < 10 observations]
```

---

## 8. UX Flow Overview

```
Onboarding
  → Choose layout + language(s)
  → First diagnostic session (10 min) — also derives baselineWPM
  → First diagnostic report shown
  → Enter daily session flow

Daily Session
  → Scheduler shows suggested structure for today
  → User can override (skip a phase, extend another)
  → After each phase: brief stats shown (don't interrupt flow with too much)
  → End-of-session summary: WPM delta, bigrams graduated

Diagnostic (every 7 days or on demand)
  → Full diagnostic session
  → Progress report: which bigrams moved classifications, WPM trend, error trend since last diagnostic
```

---

## 9. Implementation Notes

### Data storage
- All session data can live client-side (IndexedDB) for a solo tool with no backend
- Export/import as JSON for backup and cross-device portability
- If multi-device sync is desired later: append-only event log makes syncing straightforward

### Timing precision
- Use `performance.now()` for all keystroke timestamps — `Date.now()` is not precise enough
- Debounce nothing during capture; record all keydown events raw and filter in post-processing

### Minimum data requirements before diagnostic is meaningful
- Each bigram needs ≥ 10 occurrences for classification, ≥ 20 for stability
- A diagnostic session should be designed to guarantee ≥ 15 occurrences of the top 50 corpus bigrams, with best-effort coverage for the remaining top 200
- This typically requires ~500-800 keystrokes, roughly 5-8 minutes of typing
- Text generation should prioritize sentences that maximize coverage of undertrained bigrams (those with < 10 observations)

---

## 10. Progress & Feedback System

### 10.1 Design Principle

The user should never have to infer progress from raw numbers. The app's job is to interpret data and surface conclusions — *"you're getting better at X"*, *"Y is stuck"*, *"Z breakthrough happened this week"* — backed by evidence. Numbers are evidence, not the message. Every metric exposed in the UI must answer "so what?" before it reaches the user.

A secondary principle: **session performance and structural progress are different things** and must be visually separated. WPM fluctuates ±15% from noise alone. Structural progress (bigram classifications, error floor) is slow but monotonic. Conflating the two is the main cause of discouragement in typing training tools.

---

### 10.2 Metrics to Track

These are the canonical progress signals the app maintains. Not all are shown in every context — see section 10.4 for where each appears.

#### Bigrams Graduated
Count of bigrams that have moved classification since the last diagnostic:
- `acquisition → fluency`
- `fluency → healthy`
- `hasty → fluency` or `hasty → healthy`

This is the most honest progress signal because it requires consistent improvement across multiple sessions to trigger, filtering out session noise almost entirely.

```ts
interface GraduationEvent {
  bigram: string
  from: BigramClassification
  to: BigramClassification
  sessionId: string
  timestamp: number
}
```

#### Error Floor
Rolling minimum error rate over the last 10 sessions. Only moves when performance has genuinely improved. Shown as a trend, never as a raw instantaneous session value.

```ts
interface ErrorFloorHistory {
  values: { sessionId: string; floor: number }[]
  current: number
  delta7d: number    // floor change over last 7 days
  delta30d: number
}
```

#### Slowest-Decile Mean (SDM)
Average transition time of the bottom 10% of bigrams by speed. This is the leading indicator of WPM gains — it falls steadily during effective training, often 2–3 weeks before WPM visibly improves. Showing it gives the user a signal that work is paying off before the lagging WPM metric catches up.

```ts
interface SDMHistory {
  values: { sessionId: string; sdm: number }[]  // ms
  current: number
  delta7d: number
  delta30d: number
}
```

#### WPM — Smoothed and Raw
Both are kept and displayed together:
- `rawWPM`: actual session WPM
- `smoothedWPM`: 7-session rolling average
- `floorWPM`: rolling minimum over last 10 sessions
- `ceilingWPM`: rolling maximum over last 10 sessions (derived from history)

Never show raw WPM in isolation. Always show it alongside the smoothed trend.

#### Classification Distribution
Snapshot of how the user's active bigrams are distributed across `healthy / fluency / hasty / acquisition` at any given time. Tracked as a time series so it can be diffed (e.g. this week vs 4 weeks ago).

```ts
interface ClassificationSnapshot {
  timestamp: number
  healthy: number
  fluency: number
  hasty: number
  acquisition: number
  total: number
}
```

---

### 10.3 Timescales & Corresponding Signals

Progress must feel real at three timescales, each requiring different treatment.

#### Within a Session (minutes)
The user needs visceral, immediate feedback during practice — not numbers. Numbers pull attention away from typing.

- **Pacer color shift**: green when on pace, amber when slightly behind, red when far behind. No numbers needed.
- **Bigram highlight in drill panel**: during a drill, the target bigram's entry should visibly update as the session progresses and transition times improve.
- **Warm-up curve**: most users improve 5–10 WPM during the first 3 minutes of a session. Surface this subtly (a thin line showing WPM trend within the session) so users learn their own warm-up pattern and don't quit early thinking they're having a bad session.

#### Session to Session (days)
This is where discouragement lives. One bad session can subjectively erase weeks of progress.

- Always show the **7-session rolling average trendline** as the primary WPM display. Show individual session dots alongside it so the user can see both signal and noise.
- After each session, show a **session delta card** with this structure:

```
Today's session
───────────────────────────────
WPM: 67  (avg: 71 — normal variance)
Bigrams drilled: 12 · 3 graduated ✓
Error floor: unchanged
───────────────────────────────
Nothing to worry about — your bigram
profile keeps improving.
```

The interpretive sentence at the bottom is essential. The app provides the conclusion, not just the numbers. The tone should be factual and calm, never cheerleader-ish.

- If session WPM drops more than 15% below the rolling average: explicitly attribute it — *"You're 18% below your average today. This often reflects fatigue or a harder-than-usual corpus selection."* Never let a bad session feel like regression without context.

#### Diagnostic to Diagnostic (long term)
Shown as a **Diagnostic Report** after each diagnostic session. Structured around three questions:

**What got better?**
- Bigrams graduated (listed by name with classification change)
- SDM delta
- Bigrams with improved transition times

**What's stubborn?**
- Bigrams that have been in drill rotation for 4+ sessions without classification change — surfaced so the user can see what isn't moving

**What to focus on next?**
- Auto-generated priority list: top 5 bigrams by badness × corpus frequency
- Suggested session structure adjustment if any metric is trending poorly

---

### 10.4 Celebration Design

Celebrate threshold crossings, not effort. Session completion is not a celebratable event. Structural change is.

#### Graduation Events
When a bigram moves classification, surface a small inline callout — not a modal, not confetti, just a visible annotation:

```
✓ "ck" is no longer an acquisition gap   [fluency]
```

When a bigram reaches `healthy`, slightly more prominent:

```
✓✓ "qu" graduated to healthy — removed from drill rotation
```

These should appear in the post-session summary, not during typing (don't interrupt flow).

#### WPM Milestones
Only fire once per round number (60, 70, 80, 90, 100 WPM). This is a bigger moment — worth a full-screen acknowledgment the first time:

```
First session above 70 WPM
Your smoothed average crossed 70 for the first time.
It took 23 sessions from your baseline of 54 WPM.
```

Show the journey (sessions taken, starting point) — context makes the milestone meaningful.

#### Streak Events
Not "days practiced" streaks (brittle, punishing). Instead: **improvement streaks** on specific bigrams — *"'th' has improved for 5 consecutive sessions"*. These are more meaningful and more robust.

#### What Not to Celebrate
- Session completion
- "You practiced today!"
- Maintaining a streak
- Any event that fires regardless of whether improvement happened

---

### 10.5 Regression Handling

Users will have bad sessions and genuine plateaus. Both must be handled with honesty, not obscured.

**Bad session (noise):**
- Show raw WPM in context of rolling average
- If within 15% of average: no comment needed
- If 15–25% below: attribute likely cause (fatigue, hard corpus), confirm bigram profile is stable
- If 25%+ below: attribute likely cause and reassure, but still include the session in all averages — no outlier exclusion

**Genuine plateau (signal):**
A plateau is defined as: no change in SDM or classification distribution over 10+ sessions.

When detected:
- Surface explicitly: *"Your slowest bigrams haven't improved in 10 sessions. Here's what to try:"*
- Offer concrete suggestions: increase blocked drill proportion, reduce baselineWPM by 10%, review whether plateau bigrams share a finger (layout issue vs. motor issue)
- Never hide a plateau. Users who trust the system's honesty stay engaged longer than those who sense it's papering over reality.

**Classification regression:**
A bigram that drops classification (e.g. `fluency → hasty`) after being out of drill rotation:

```
⚠ "ng" has slipped back to hasty — re-added to drill rotation
```

Surface this in the diagnostic report, not as a mid-session alert.

---

### 10.6 Progress UI Components

#### The Classification Bar (primary long-term widget)

A stacked horizontal bar showing the current distribution of active bigrams across classifications. Rendered at two points in time side by side (today vs. 4 weeks ago):

```
4 weeks ago  [acquisition ██████] [hasty ████] [fluency ████████] [healthy ██████████████]
Today        [acquisition ███]    [hasty ██]   [fluency ██████]   [healthy █████████████████████]
```

This is the single most honest representation of structural progress. Update it per diagnostic, not per-session, to avoid visual noise.

#### The Bigram Sparkline
Each bigram in the drill panel shows a miniature line chart: mean transition time over the last 8 sessions. Flat or downward = good. A visible downward slope on a previously stubborn bigram is more satisfying than any WPM number.

#### The WPM Chart
Line chart with three layers:
- Thin dots: raw session WPM
- Thicker line: 7-session rolling average
- Shaded band: ±1 standard deviation envelope

The envelope makes variance feel normal and expected rather than alarming.

---

### 10.7 Data Model Additions for Progress Tracking

```ts
interface ProgressStore {
  graduationHistory: GraduationEvent[]
  classificationSnapshots: ClassificationSnapshot[]   // one per session
  wpmHistory: {
    sessionId: string
    raw: number
    smoothed: number          // computed at record time
    floor: number
    ceiling: number
  }[]
  sdmHistory: SDMHistory
  errorFloorHistory: ErrorFloorHistory
  diagnosticReports: DiagnosticProgressReport[]
}

interface DiagnosticProgressReport {
  diagnosticSessionId: string
  timestamp: number
  bigramsGraduated: GraduationEvent[]
  sdmDelta: number
  wpmDelta: number            // smoothed, since last diagnostic
  bigramsImproved: string[]
  priorityBigrams: string[]   // recommended focus for next period
}
```

---

## 11. Out of Scope (v1)

- Multiplayer / leaderboards
- Mobile / touchscreen support (this is a desktop-first tool)
- Voice or audio feedback
- Ergonomics / RSI guidance
- Auto-layout detection
- PWA / offline support

---

## Appendix: Classification Quick Reference

| Signal | Slow? | Errors? | Classification | First action |
|---|---|---|---|---|
| Fast, clean | No | No | Healthy | Nothing |
| Slow, clean | Yes | No | Fluency | Speed bursts |
| Fast, errors | No | Yes | Hasty | Slow down, deliberate reps |
| Slow, errors | Yes | Yes | Acquisition | Blocked slow drill |
