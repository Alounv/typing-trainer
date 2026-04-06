# Typing Trainer — Technical Specification

## 1. Vision & Scope

A web application that improves typing speed through scientifically grounded practice: diagnostic measurement, pattern-level weakness identification, and targeted drills calibrated to the user's specific motor learning state. The app is corpus-aware (language and domain-sensitive), distinguishes between accuracy and fluency bottlenecks, and adapts session structure accordingly.

This spec covers data models, system modules, UX flows, and session logic. It does not dictate stack choices, but notes where certain architectural decisions matter.

---

## 2. Core Data Models

### 2.1 KeystrokeEvent
The atomic unit collected during any typing session.

```ts
interface KeystrokeEvent {
  timestamp: number          // ms since session start
  expected: string           // the character the user should have typed
  actual: string             // the character the user typed
  position: number           // index in the current sequence
  wordIndex: number          // index of the current word in the sequence
  positionInWord: number     // index within the current word (0 = word-initial)
  corrected: boolean         // whether a backspace followed within 500ms
  correctionDelay: number | null  // ms until backspace, if corrected
}
```

### 2.2 BigramRecord
Derived from raw keystroke events. One record per bigram per session.

```ts
interface BigramRecord {
  bigram: string             // e.g. "th"
  occurrences: number
  transitionTimes: number[]  // ms between keydown N and keydown N+1
  meanTime: number
  stdTime: number
  errorCount: number
  errorRate: number          // errorCount / occurrences
  errorTypes: {
    wrongFinger: number      // adjacent-column error
    adjacentKey: number      // adjacent-row/column on same finger
    transposition: number    // bigram reversed
    omission: number         // key skipped
    other: number
  }
  // Derived classification (see section 3.1)
  classification: 'healthy' | 'fluency' | 'hasty' | 'acquisition'
}
```

### 2.3 WordRecord
Derived per word from keystroke events.

```ts
interface WordRecord {
  word: string
  occurrences: number
  meanWordTime: number           // ms from first to last keystroke of word
  perPositionTimes: number[][]   // [position][occurrence] → transition time
  perPositionMeanTimes: number[] // mean per position
  errorRate: number
  compositeScore: number         // see section 3.2
  containedBigrams: string[]
}
```

### 2.4 UserProfile
Persistent across sessions.

```ts
interface UserProfile {
  id: string
  layout: string               // 'bépo' | 'azerty' | 'qwerty' | 'dvorak' | ...
  language: 'fr' | 'en' | string
  corpus: CorpusConfig
  sessions: SessionSummary[]
  bigramHistory: Record<string, BigramRecord[]>  // bigram → history over time
  wordHistory: Record<string, WordRecord[]>
  pacing: PacingProfile
}

interface PacingProfile {
  comfortableWPM: number        // settled speed at <2% errors over a long run
  ceilingWPM: number            // max speed before errors climb above ~5%
  trainingTargetWPM: number     // comfortableWPM × 1.15 to 1.20
  realTextErrorFloor: number    // error rate during real-text sessions
  lastUpdated: number           // timestamp
}
```

### 2.5 CorpusConfig

```ts
interface CorpusConfig {
  language: string
  wordlistId: string            // e.g. 'fr-top-5000', 'en-top-1000'
  customText?: string           // optional user-supplied text
  bigramFrequencyTable: Record<string, number>  // bigram → frequency in corpus
  wordFrequencyTable: Record<string, number>    // word → frequency rank
}
```

### 2.6 SessionSummary

```ts
interface SessionSummary {
  id: string
  timestamp: number
  type: 'diagnostic' | 'bigram-drill' | 'word-drill' | 'real-text' | 'race'
  durationMs: number
  wpm: number
  errorRate: number
  bigramsTargeted?: string[]
  wordsTargeted?: string[]
  rawEvents: KeystrokeEvent[]
}
```

---

## 3. Diagnostic Module

### 3.1 Bigram Classification Algorithm

Run after collecting enough occurrences (minimum 10 per bigram, ideally 20+).

**Thresholds** (configurable, defaults below):
- `FAST_THRESHOLD`: 120ms mean transition time
- `SLOW_THRESHOLD`: 200ms mean transition time
- `HIGH_ERROR_THRESHOLD`: 0.05 (5% error rate)
- `HIGH_VARIANCE_THRESHOLD`: std/mean > 0.4

**Classification logic:**

```
if meanTime <= FAST_THRESHOLD AND errorRate < HIGH_ERROR_THRESHOLD → 'healthy'
if meanTime <= FAST_THRESHOLD AND errorRate >= HIGH_ERROR_THRESHOLD → 'hasty'
if meanTime > SLOW_THRESHOLD AND errorRate < HIGH_ERROR_THRESHOLD → 'fluency'
if meanTime > SLOW_THRESHOLD AND errorRate >= HIGH_ERROR_THRESHOLD → 'acquisition'
// Intermediate zone: use variance as tiebreaker
if HIGH_VARIANCE → flag as 'unstable' sub-tag on any classification
```

**Each classification maps to a training prescription:**

| Classification | Meaning | Treatment |
|---|---|---|
| `healthy` | Skip | No action needed |
| `fluency` | Program exists, not fast | Speed bursts above ceiling |
| `hasty` | Program unstable, rush errors | Slow deliberate repetition first |
| `acquisition` | Program missing or wrong | Blocked slow drill, then consolidation |
| `unstable` (sub-tag) | Inconsistent execution | Blocked repetition to stabilize first |

### 3.2 Word Composite Score

Used to rank words for the word-drill phase:

```
compositeScore(word) = Σ over bigrams b in word:
  bigramBadness(b) × log(wordFrequency(word) + 1)

bigramBadness(b) =
  (meanTime(b) / SLOW_THRESHOLD) × (1 + errorRate(b) × 10)
```

This ensures common words with moderately bad bigrams outrank rare words with very bad bigrams.

### 3.3 Position-in-Word Analysis

For each word with ≥ 5 occurrences, compute `perPositionMeanTimes`. Flag a word as having a **chunking gap** if:
- Any position has a mean time > 1.5× the word's own mean inter-key time
- And that position is not also flagged as a bad isolated bigram

A chunking gap means the word hasn't been compiled into a motor program — the fix is word-level repetition, not bigram drilling.

### 3.4 Pacing Calibration Session

A special session type run during onboarding and periodically (every 2 weeks suggested):
- Present 200-300 words of real text
- First half: user types at natural comfortable pace
- Second half: user is prompted to push speed
- Derive `comfortableWPM` from first half (lowest decile removed), `ceilingWPM` from second half
- `trainingTargetWPM` = comfortableWPM × 1.17 (adjustable)

---

## 4. Drill Phase Modules

### 4.1 Bigram Drill Session

**Input:** Ranked list of target bigrams from diagnostic, with classifications.

**Sequence generation:**
1. Wrap each target bigram in CVC nonsense words to force bigram execution without word-program interference: e.g. for "th" → "atha", "uthe", "othi"
2. Interleave with filler bigrams (healthy ones) at ratio 70% target / 30% filler
3. Group by classification:
   - `acquisition` and `hasty` bigrams: start at 60% of comfortableWPM, no speed pressure
   - `fluency` bigrams: target trainingTargetWPM, use visual pacer

**Speed pacer:**
- Optional bouncing cursor or highlight advancing at trainingTargetWPM
- Visual feedback: green if on pace, amber if slightly behind, red if far behind
- Do not penalize errors during speed-push phase beyond visual indication

**Session end trigger:**
- Stop a bigram target when: 15 consecutive correct occurrences AND last 5 are within 20% of target time
- Or: session time limit reached (default 8 minutes)

**Output per bigram:** updated BigramRecord appended to bigramHistory.

### 4.2 Word Drill Session

**Input:** Top N words by compositeScore (default N=20 per session).

**Blocked phase (first 2/3 of session):**
- Present one word at a time, repeat until:
  - 5 consecutive correct hits AND
  - last 3 hits are within target time (word length × target ms/char)
- If a chunking gap was flagged: show the word split at the gap position on first attempts, then remove the split guide after 3 successes

**Interleaved phase (last 1/3 of session):**
- Mix all session words in random order
- No repetition targeting — just free flow
- Measure if per-word times hold up under context-switching (they often degrade 15-20% — this is normal and temporary)

**Output:** updated WordRecord for each drilled word.

### 4.3 Real Text Session

**Input:** Corpus excerpt. Selection algorithm:
1. Prefer sentences containing ≥ 2 words from current word-drill targets
2. Prefer sentences with high density of `fluency`-classified bigrams (since real text is where speed gains transfer)
3. Minimum sentence length: 8 words (shorter = too many word-boundary effects, not representative)

**Pacer:** ghost cursor running at trainingTargetWPM. User can toggle off.

**No stop-on-error:** user types through errors. Errors are recorded but not corrected mid-stream (mirrors real use conditions). Backspace allowed but not penalized beyond time cost.

**Session exit condition:** user-chosen duration (default 15 minutes) or word count.

**Output:** full KeystrokeEvent log; update bigramHistory and wordHistory for all encountered patterns.

### 4.4 Race Session

Full-speed, no pacer, no guidance. Purely motivational and diagnostic of "real ceiling."

- Present 100-word excerpt
- Measure gross WPM and net WPM (penalizing uncorrected errors as -1 word each)
- Compare to previous race WPM — show delta
- Output: updates ceilingWPM in PacingProfile if new record

---

## 5. Session Scheduler

The app should suggest a daily session structure rather than leaving the user to choose manually. This is important for progression and avoiding over-drilling.

**Default daily structure (30 min):**

| Phase | Duration | Type |
|---|---|---|
| Bigram drill | 8 min | Targeted, from diagnostic |
| Word drill | 7 min | Top words by compositeScore |
| Real text | 15 min | Corpus-based |

**Scheduler rules:**
- Run full diagnostic every 7 days (or on demand)
- After 3 consecutive sessions where a bigram is `healthy`, remove from drill rotation
- If real-text error floor is rising (>10% increase over 3 sessions): reduce trainingTargetWPM by 5%, flag to user
- If no improvement on a bigram after 4 drill sessions: surface it in UI as "stubborn pattern" and suggest manual attention or layout review

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

### 6.2 Custom Corpus Import

User can paste or upload their own text (code, emails, domain-specific writing). The app:
1. Tokenizes and computes word and bigram frequencies
2. Computes overlap with built-in bigram frequency table
3. Warns if corpus is too small (<500 unique bigrams) for reliable diagnostics
4. Merges with base corpus at user-specified weight (e.g. 70% custom / 30% base)

---

## 7. Analytics & Progress Views

### 7.1 Bigram Heatmap

Keyboard layout rendered as a heatmap. Each key colored by:
- Mean transition time FROM this key (outgoing bigrams)
- Or TO this key (incoming bigrams)
- Toggle between speed heatmap and error heatmap

Clicking a key shows its top 10 outgoing/incoming bigrams sorted by badness.

### 7.2 Progress Charts

Per bigram: line chart of meanTime and errorRate over time (sessions on X axis). Should show the "slow down then speed up" pattern clearly when acquisition is working correctly.

Per session: WPM over time, error rate over time, number of bigrams graduating out of drill rotation per week.

### 7.3 Diagnostic Report

Generated after each diagnostic session. Structured output:

```
Diagnostic Report — [date]

Pacing:
  Comfortable: 68 WPM
  Ceiling: 84 WPM
  Training target: 79 WPM

Bigram breakdown:
  Healthy: 312 bigrams
  Fluency bottlenecks (top 5): "sc", "mp", "wr", "qu", "pl"
  Hasty patterns (top 5): "tion", "ng", "er", "ou", "in"
  Acquisition gaps: "wh", "ck"

Priority word targets (top 10):
  [word list with scores]

Corpus fit:
  Training coverage: 87% of your corpus bigrams have ≥10 observations
  Undertrained: [list of frequent corpus bigrams with < 10 observations]
```

---

## 8. UX Flow Overview

```
Onboarding
  → Choose layout + language
  → Pacing calibration session (5 min)
  → First diagnostic session (10 min)
  → First diagnostic report shown
  → Enter daily session flow

Daily Session
  → Scheduler shows suggested structure for today
  → User can override (skip a phase, extend another)
  → After each phase: brief stats shown (don't interrupt flow with too much)
  → End-of-session summary: WPM delta, bigrams graduated, words improved

Weekly
  → Full diagnostic re-run suggested
  → Weekly progress report: which bigrams moved classifications, WPM trend, error trend
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
- A diagnostic session should be designed to guarantee ≥ 15 occurrences of the top 200 corpus bigrams
- This typically requires ~500-800 keystrokes, roughly 5-8 minutes of typing

### Layout awareness
- Bigram badness should be normalized against layout expected difficulty
- For Bépo: "ou", "en", "qu", "an" are high-frequency — weight them accordingly
- Do not penalize bigrams that are inherently slow due to same-finger usage if the layout has no alternative

---

## 10. Progress & Feedback System

### 10.1 Design Principle

The user should never have to infer progress from raw numbers. The app's job is to interpret data and surface conclusions — *"you're getting better at X"*, *"Y is stuck"*, *"Z breakthrough happened this week"* — backed by evidence. Numbers are evidence, not the message. Every metric exposed in the UI must answer "so what?" before it reaches the user.

A secondary principle: **session performance and structural progress are different things** and must be visually separated. WPM fluctuates ±15% from noise alone. Structural progress (bigram classifications, error floor, chunking scores) is slow but monotonic. Conflating the two is the main cause of discouragement in typing training tools.

---

### 10.2 Metrics to Track

These are the canonical progress signals the app maintains. Not all are shown in every context — see section 10.4 for where each appears.

#### Bigrams Graduated
Count of bigrams that have moved classification in the current week:
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

#### Word Chunking Score
Count of words in the corpus whose per-position timing profile is flat (no chunking gap detected). Grows slowly but directly reflects motor consolidation.

#### WPM — Smoothed and Raw
Both are kept and displayed together:
- `rawWPM`: actual session WPM
- `smoothedWPM`: 7-session rolling average
- `floorWPM`: rolling minimum over last 10 sessions
- `ceilingWPM`: rolling maximum over last 10 race sessions

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
- **Bigram color on heatmap**: during a drill, the target bigram's heatmap cell should visibly lighten as the session progresses and transition times improve. Watching a cell change color in real time is more motivating than any number.
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

#### Week to Week (long term)
Shown as a **Weekly Report** at the first session of each week. Structured around three questions:

**What got better?**
- Bigrams graduated (listed by name with classification change)
- SDM delta
- Words with closed chunking gaps

**What's stubborn?**
- Bigrams that have been in drill rotation for 4+ sessions without classification change → flagged as "needs attention"
- If a bigram has been stuck for 3+ weeks: surface it as a note, suggest slowing down further or checking for a layout-level issue

**What to focus on this week?**
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
- If 25%+ below: suggest the session not be used to update pacing targets; log it but don't let it pull down the rolling average weight

**Genuine plateau (signal):**
A plateau is defined as: no change in SDM or classification distribution over 10+ sessions.

When detected:
- Surface explicitly: *"Your slowest bigrams haven't improved in 10 sessions. Here's what to try:"*
- Offer concrete suggestions: increase blocked drill proportion, reduce trainingTargetWPM by 10%, review whether plateau bigrams share a finger (layout issue vs. motor issue)
- Never hide a plateau. Users who trust the system's honesty stay engaged longer than those who sense it's papering over reality.

**Classification regression:**
A bigram that drops classification (e.g. `fluency → hasty`) after being out of drill rotation:

```
⚠ "ng" has slipped back to hasty — re-added to drill rotation
```

Surface this in the weekly report, not as a mid-session alert.

---

### 10.6 Progress UI Components

#### The Classification Bar (primary long-term widget)

A stacked horizontal bar showing the current distribution of active bigrams across classifications. Rendered at two points in time side by side (today vs. 4 weeks ago):

```
4 weeks ago  [acquisition ██████] [hasty ████] [fluency ████████] [healthy ██████████████]
Today        [acquisition ███]    [hasty ██]   [fluency ██████]   [healthy █████████████████████]
```

This is the single most honest representation of structural progress. Update it weekly, not per-session, to avoid visual noise.

#### The Bigram Sparkline
Each bigram in the drill panel shows a miniature line chart: mean transition time over the last 8 sessions. Flat or downward = good. A visible downward slope on a previously stubborn bigram is more satisfying than any WPM number.

#### The WPM Chart
Line chart with three layers:
- Thin dots: raw session WPM
- Thicker line: 7-session rolling average
- Shaded band: ±1 standard deviation envelope

The envelope makes variance feel normal and expected rather than alarming.

#### The "What This Means in Real Life" Translation
Shown in the weekly report:

```
Your top 30 bigrams are now 38ms faster on average.
In a 500-word document, that's roughly 11 seconds saved.
In a full day of writing (est. 3000 words), that's over a minute.
```

Abstract millisecond gains become concrete felt experience. Use the user's actual corpus word frequency to compute estimates.

#### The Personal Record Board
A small, permanent widget showing:
- Best session WPM ever
- Best smoothed WPM (rolling average peak)
- Fastest bigram ever recorded
- Most bigrams graduated in a single week

Personal records are motivating because they only go up.

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
  personalRecords: {
    bestRawWPM: number
    bestSmoothedWPM: number
    fastestBigram: { bigram: string; time: number }
    mostGraduationsInWeek: number
  }
  weeklyReports: WeeklyReport[]
}

interface WeeklyReport {
  weekStart: number           // timestamp
  bigramsGraduated: GraduationEvent[]
  stubbornBigrams: string[]
  sdmDelta: number
  wpmDelta: number            // smoothed, week over week
  chunkingGapsClosed: string[]
  priorityBigrams: string[]   // recommended focus for next week
  interpretiveSummary: string // generated text, see section 10.3
}
```

---

## 11. Out of Scope (v1)

- Multiplayer / leaderboards
- Mobile / touchscreen support (this is a desktop-first tool)
- Voice or audio feedback
- Ergonomics / RSI guidance
- Auto-layout detection

---

## Appendix: Classification Quick Reference

| Signal | Slow? | Errors? | Variance? | Classification | First action |
|---|---|---|---|---|---|
| Fast, clean, consistent | No | No | No | Healthy | Nothing |
| Slow, clean | Yes | No | — | Fluency | Speed bursts |
| Fast, errors | No | Yes | — | Hasty | Slow down, deliberate reps |
| Slow, errors | Yes | Yes | — | Acquisition | Blocked slow drill |
| Any + high variance | — | — | Yes | + Unstable tag | Stabilize before pushing speed |

- Multiplayer / leaderboards
- Mobile / touchscreen support (this is a desktop-first tool)
- Voice or audio feedback
- Ergonomics / RSI guidance
- Auto-layout detection

---

## Appendix: Classification Quick Reference

| Signal | Slow? | Errors? | Variance? | Classification | First action |
|---|---|---|---|---|---|
| Fast, clean, consistent | No | No | No | Healthy | Nothing |
| Slow, clean | Yes | No | — | Fluency | Speed bursts |
| Fast, errors | No | Yes | — | Hasty | Slow down, deliberate reps |
| Slow, errors | Yes | Yes | — | Acquisition | Blocked slow drill |
| Any + high variance | — | — | Yes | + Unstable tag | Stabilize before pushing speed |
