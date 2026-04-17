# `bigram/` — extraction & 4-way classification

Turns a stream of first-input keystroke events into per-bigram aggregates
(mean time, error rate, occurrences) and tags each one with a training
prescription. This is the core analytics primitive for the whole app —
everything in `diagnostic/`, `progress/`, and the drill selection flow
consumes these aggregates.

## Big picture

```
  typing/ annotateFirstInputs
           │
           ▼
   KeystrokeEvent[]  (first-input only, one per position)
           │
           ▼
  ┌──────────────────────────────────────────────┐
  │           extractBigramAggregates            │  extraction.ts
  │                                              │
  │   for each adjacent (i, i+1) with            │
  │   positions consecutive:                     │
  │     key  = expected[i] + expected[i+1]       │
  │     occ++                                    │
  │     err++  if right.actual != right.expected │
  │     clean timing sample if BOTH correct      │
  │                                              │
  │   per bucket → mean, sample-std, errorRate   │
  └───────────────────┬──────────────────────────┘
                      │ aggregate (occ, meanTime, errorRate)
                      ▼
  ┌──────────────────────────────────────────────┐
  │               classifyBigram                 │  classification.ts
  │                                              │
  │   occ < 10              → unclassified       │
  │   meanTime not finite   → unclassified       │
  │                                              │
  │              clean (err < T)   error (err≥T) │
  │   fast (≤S)  │  healthy       │  hasty       │
  │   slow (>S)  │  fluency       │  acquisition │
  └───────────────────┬──────────────────────────┘
                      ▼
              BigramAggregate[]
                      │
                      ├──▶ session/ SessionSummary.bigramAggregates
                      ├──▶ diagnostic/ DiagnosticReport
                      └──▶ storage/ bigramRecords (denormalized, per-bigram history)
```

## Files

- [types.ts](types.ts) — `BigramClassification` (the 5 tags) and `BigramAggregate`.
- [extraction.ts](extraction.ts) — `extractBigramAggregates(events, sessionId, thresholds?)`. Pure; sorts defensively by `position`. Non-consecutive positions (aborted sessions, gaps) are skipped, not joined.
- [classification.ts](classification.ts) — `classifyBigram`, `DEFAULT_THRESHOLDS`, `MIN_OCCURRENCES_FOR_CLASSIFICATION` (= 10).

## Key invariants

- **Error counted on the right-hand char only.** Otherwise a single wrong keystroke double-counts (it participates in two bigrams). Spec §2.2.
- **Timing uses clean samples only** — pairs where both first-inputs matched `expected`. Error samples pollute the motor-program signal.
- **Threshold semantics are asymmetric**: `meanTime ≤ speedMs` (inclusive), `errorRate < errorRate` (strict). Matches spec §3.1's table; pinned by tests.
- **`classification` is a session-time snapshot** in the stored aggregate. Never recomputed on read — historical records stay stable even if thresholds change.
