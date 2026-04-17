# `drill/` — bigram-targeted word selection (planned)

> Empty today. This README captures the intended shape so the slot is obvious
> when work resumes.

A "drill" is a short (~50-word, 4-round) session where the user repeats words chosen
specifically to stress a set of target bigrams — typically the priority
bigrams from the latest diagnostic, minus any that have graduated to
`healthy` in the last 3 sessions (spec §5).

## Intended big picture

```
   latest DiagnosticReport.priorityTargets[]
                 │
                 │   minus: bigrams `healthy` for 3 consecutive sessions
                 │           (progress/graduationHistory)
                 ▼
        target bigram set  ─ small, e.g. 5–10
                 │
                 ▼
    ┌───────────────────────────────────────────┐
    │         word selection (this folder)      │
    │                                           │
    │  for each target bigram:                  │
    │    pick words from corpus that contain it │
    │    prefer common words (high freq)        │
    │    mix languages if the word is stronger  │
    │    in one than the other (spec §6.2)      │
    │    cap repeats per session                │
    └─────────────────────┬─────────────────────┘
                          ▼
              SessionConfig { type: "bigram-drill",
                              bigramsTargeted: [...] }
                          │
                          ▼
                    session runner
                 (captures keystrokes,
                  emits SessionSummary)
                          │
                          ▼
               storage/saveSession  (no raw data —
                                     drills discard theirs)
```

## What will live here

- A `selectDrillWords(targets, corpus, opts)` function — pure, given a target
  set and a loaded `CorpusData`, return an ordered word list.
- Heuristics for mixing languages, avoiding immediate repeats, spacing bigram
  coverage across the session.

## Related spec sections

- §4.1 — Bigram drill session shape.
- §5 — Scheduler: drill precedes real-text in the default daily structure.
- §6.2 — Multi-language word sourcing.
