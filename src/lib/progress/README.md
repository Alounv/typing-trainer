# `progress/` — long-term progress store

Everything that tells the user "you're getting better" (or "this bigram is
stuck"). One persisted singleton — `ProgressStore` — that grows over time;
each session writes one row to each of its internal histories, each
diagnostic writes one `DiagnosticProgressReport`.

Types only for now. Aggregation/update logic lands here when sessions start
being persisted end-to-end.

## Big picture

```
        per session                       per diagnostic
            │                                    │
            ▼                                    ▼
   ┌────────────────────┐            ┌──────────────────────────┐
   │ SessionSummary     │            │ DiagnosticReport         │
   │   (wpm, aggregates)│            │   (aggregates, baseline) │
   └─────────┬──────────┘            └─────────┬────────────────┘
             │                                 │
             ▼                                 ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                       ProgressStore                          │
   │               (singleton in storage/progressStore)           │
   │                                                              │
   │   graduationHistory[]   ─ each classification transition     │
   │                            (bigram, from → to)               │
   │                            ← most trustworthy signal         │
   │                                                              │
   │   classificationSnapshots[]                                  │
   │     { ts, healthy, fluency, hasty, acquisition, total }      │
   │     → diff today vs. 4 weeks ago                             │
   │                                                              │
   │   wpmHistory[]          ─ per session                        │
   │     { raw, smoothed (7-sess avg), floor, ceiling }           │
   │                                                              │
   │   sdmHistory            ─ Slowest-Decile Mean                │
   │     values[] + current + delta7d / delta30d                  │
   │     (leading indicator: drops 2–3 wks before WPM)            │
   │                                                              │
   │   errorFloorHistory     ─ rolling min error-rate over 10     │
   │     values[] + current + delta7d / delta30d                  │
   │                                                              │
   │   diagnosticReports[]   ─ per diagnostic                     │
   │     { bigramsGraduated, sdmDelta, wpmDelta,                  │
   │       bigramsImproved, priorityBigrams }                     │
   └──────────────────────────────────────────────────────────────┘
                             │
                             ▼
              UI (trends, sparklines, "what got better")
```

## Files

- [types.ts](types.ts) — all the above shapes.
- `components/` — future: trend widgets, graduation feed, sparkline cards.

## Why these specific indicators?

Spec §10. Raw per-session WPM is too noisy to show users. The store pre-computes
smoothed metrics **at write time**, not at read time — so opening the progress
view is cheap and the numbers don't flicker as you scroll.

- **Graduation events** — immune to session noise. A bigram moving
  `acquisition → fluency` is a real, discrete improvement.
- **SDM (Slowest-Decile Mean)** — leading indicator. Improves before WPM does.
- **Error floor** — rolling min over 10 sessions. Only moves on genuine
  improvement, not on one unusually clean session.
