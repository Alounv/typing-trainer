# `models/` — shared user settings & global constants

The small, stable set of app-wide config: the user's languages, their
threshold overrides, and the default values everything else reads from.

Think of this as the only module with no dependencies — it's imported by
almost everyone else and imports nothing in the app.

## Big picture

```
                       ┌──────────────────────────────┐
                       │        UserSettings          │    persisted as
                       │                              │    ProfileRecord
                       │   languages[]                │    in storage/
                       │     (priority-ordered)       │
                       │                              │
                       │   corpusIds[]                │
                       │     (one per language)       │
                       │                              │
                       │   thresholds?                │ ◀─ override of the
                       │     speedMs, errorRate       │    DEFAULT_* below
                       └──────────────┬───────────────┘
                                      │
                  ┌───────────────────┼───────────────────┐
                  ▼                   ▼                   ▼
           corpus/ (which        bigram/                session/
           wordlist to load)     (threshold-driven      (target WPM =
                                 classification)       baseline × multiplier)

                       ┌──────────────────────────────┐
                       │      Global constants        │
                       │                              │
                       │ DEFAULT_SPEED_THRESHOLD_MS   │  150
                       │ DEFAULT_HIGH_ERROR_THRESHOLD │  0.05
                       │ TARGET_WPM_MULTIPLIER        │  1.17  (modest,
                       │                              │        reachable)
                       └──────────────────────────────┘
```

## Files

- [index.ts](index.ts) — `Language`, `UserSettings`, and the three `DEFAULT_*` constants.

## Why a dedicated folder for so few types?

- Avoids circular imports — `bigram/classification.ts` needs the default
  thresholds, `session/` needs the WPM multiplier, and none of those should
  depend on each other.
- Thresholds are spec-driven numbers (§3.1, §3.3). Centralizing them makes
  it obvious where to change defaults if the spec moves.
