# `diagnostic/` — diagnostic session types & report shape

A diagnostic is the "full physical" of the user's typing: a longer run over
the whole corpus, with every keystroke archived so thresholds can be replayed
later. Output is a structured `DiagnosticReport` that seeds the drill
scheduler (priority bigrams), the UI (top bottlenecks), and progress tracking
(baseline WPM, corpus coverage).

Only types live here today. The session runner and report-builder come later.

## Big picture

```
     session type = "diagnostic"
              │
              ▼
     typing/ captures full keystroke log
              │
              ▼
     ┌────────────────────────────┐
     │     DiagnosticRawData      │  persisted verbatim → storage/diagnosticRawData
     │   sessionId · events[]     │  (heavy; only diagnostic sessions keep it)
     └─────────────┬──────────────┘
                   │
                   ▼
     typing/annotateFirstInputs ──▶ bigram/extractBigramAggregates
                                              │
                                              ▼
                                    BigramAggregate[]
                                              │
                                              ▼
     ┌───────────────────────────────────────────────────────────────┐
     │                     DiagnosticReport                          │
     │                                                               │
     │   baselineWPM  ─ middle quartiles of session WPM (§3.3)       │
     │   targetWPM    ─ baselineWPM × TARGET_WPM_MULTIPLIER           │
     │                                                               │
     │   counts       ─ { healthy, fluency, hasty, acquisition }     │
     │   topBottlenecks                                              │
     │     fluency[]     ─ top-5 slowest clean                       │
     │     hasty[]       ─ top-5 error-prone fast                    │
     │     acquisition[] ─ top-5 slow + error-prone                  │
     │                                                               │
     │   priorityTargets[] = PriorityBigram                          │
     │     score = badness × corpus frequency                        │
     │                                                               │
     │   corpusFit                                                   │
     │     coverageRatio   ─ fraction of corpus bigrams with ≥10 obs │
     │     undertrained[]  ─ bigrams under the floor                 │
     │                                                               │
     │   aggregates[] ─ full BigramAggregate snapshot                │
     └───────────────────────────────────────────────────────────────┘
                   │
                   ▼
     ├─▶ scheduler/   priorityTargets seed drill rotation
     ├─▶ progress/    DiagnosticProgressReport diffs two reports
     └─▶ UI           top bottlenecks / coverage display
```

## Files

- [types.ts](types.ts) — `DiagnosticRawData`, `DiagnosticReport`, `PriorityBigram`.

## Why persist raw data?

Spec §2.8. Classification thresholds are user-tunable (`UserSettings.thresholds`).
If a user changes them 3 months in, we want to replay old diagnostics under
the new thresholds and see how the picture shifts — not just re-classify the
stored aggregates, which were computed with a specific `speedMs` / `errorRate`
at that point in time. Raw events are the only lossless input.
