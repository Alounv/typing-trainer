# `session/` — session types & (eventually) runners

A session is one contiguous typing run. There are three kinds:

- `diagnostic` — full corpus pass, keystrokes archived for later threshold replay.
- `bigram-drill` — targeted repetition of a small set of bigrams.
- `real-text` — paced reading of corpus excerpts with errors but no stop-on-error.

Right now the folder only defines **types**; the runner logic (pick text →
start timer → collect events → compute summary → persist) lands here when
sessions move past the typing-lib milestone.

## Big picture

```
              scheduler/ (picks a SessionConfig)
                        │
                        ▼
          ┌──────────────────────────────┐
          │        SessionConfig         │
          │   type / durationMs          │
          │   bigramsTargeted? / pacer?  │
          └───────────────┬──────────────┘
                          │
                          ▼
               (session runner — TBD here)
                          │
        feeds:            │
        ┌─ typing/TypingSurface ─ capture keystrokes ──┐
        │                                              │
        │                                              ▼
        │                                KeystrokeEvent[]
        │                                              │
        │                                              ▼
        │                             typing/annotateFirstInputs
        │                                              │
        │                                              ▼
        │                             bigram/extractBigramAggregates
        │                                              │
        │                                              ▼
        │                                  BigramAggregate[]
        │                                              │
        ▼                                              ▼
  ┌─────────────────────────────────────────────────────────┐
  │                   SessionSummary                        │
  │   id · timestamp · type · durationMs                    │
  │   wpm (raw) · errorRate                                 │
  │   bigramsTargeted? (drill only)                         │
  │   bigramAggregates[] (always)                           │
  └─────────────────────────┬───────────────────────────────┘
                            │
                            ▼
                    storage/saveSession
                  (+ DiagnosticRawData if diagnostic)
                            │
                            ▼
                 progress/ consumes summaries for
                 WPM / SDM / error-floor / graduation history
```

## Files

- [types.ts](types.ts) — `SessionType`, `SessionSummary`, `SessionConfig`.
- `components/` — future: `<DiagnosticSession>`, `<DrillSession>`, `<RealTextSession>` shells.

## Invariants

- **`wpm` is raw**, never smoothed. Smoothing lives in `progress/`.
- **`bigramsTargeted` is set only for drills.** Real-text and diagnostic sessions pass through the whole corpus; flagging bigrams there would be meaningless.
- **One summary per session, N bigram aggregates per summary.** `storage/saveSession` writes both sides in one transaction.
