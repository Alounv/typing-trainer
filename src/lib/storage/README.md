# `storage/` — IndexedDB persistence (Dexie)

Single source of truth for everything that survives a page reload: sessions,
per-bigram history, diagnostic raw logs, user profile, and the long-term
progress store. Built on Dexie.

## Big picture

```
                            app code
                               │
                               ▼
              ┌────────────────────────────────────┐
              │          service.ts                │   ← public API
              │                                    │
              │  saveSession(summary, rawData?)    │
              │  getSession(id)                    │
              │  getRecentSessions(limit)          │
              │  getBigramHistory(bigram)          │
              │  getDiagnosticRawData(sessionId)   │
              │  get/saveProfile                   │
              │  get/saveProgressStore             │
              │  clearAll()                        │
              └─────────────────┬──────────────────┘
                                │
                                ▼
              ┌────────────────────────────────────┐
              │         db.ts (Dexie)              │
              │   database: "typing-trainer" v1    │
              └─────────────────┬──────────────────┘
                                │
      ┌──────────────┬──────────┴──────────┬──────────────┬──────────────────┐
      ▼              ▼                     ▼              ▼                  ▼
┌───────────┐  ┌────────────┐   ┌──────────────────┐  ┌─────────┐  ┌────────────────┐
│ sessions  │  │ bigram     │   │ diagnosticRaw    │  │ profile │  │ progressStore  │
│           │  │ Records    │   │ Data             │  │(single) │  │   (single)     │
│ pk: id    │  │ pk: key    │   │ pk: sessionId    │  │ pk: id  │  │  pk: id        │
│ idx:      │  │ idx:       │   │                  │  │         │  │                │
│  timestamp│  │  bigram    │   │ events[] — heavy;│  │ settings│  │ graduation hx, │
│  type     │  │  sessionId │   │ only written for │  │         │  │ wpm hx, sdm,   │
│           │  │  classif.  │   │ diagnostic       │  │         │  │ error floor,   │
│           │  │            │   │ sessions         │  │         │  │ snapshots...   │
└───────────┘  └────────────┘   └──────────────────┘  └─────────┘  └────────────────┘

          ▲              ▲
          │              │
          └──────┬───────┘
                 │
   saveSession writes both atomically in one `rw` txn:
     sessions.put(summary)
     bigramRecords.bulkPut(rows)   — each row = BigramAggregate + key
     diagnosticRawData.put(rawData)  (only if provided)
```

## Why two places for bigram data?

`bigramRecords` is **denormalized** — it duplicates what's already inside
`SessionSummary.bigramAggregates`. The redundancy buys cheap per-bigram history
queries (sparklines, classification trends) without scanning every session.
`saveSession` is transactional so the two can't drift.

## Files

- [db.ts](db.ts) — Dexie class, schema, `bigramRecordKey(bigram, sessionId)` (scalar PK for the join), singleton `db`, `SINGLETON_ID`.
- [service.ts](service.ts) — all reads/writes. No component ever touches `db` directly.

## Invariants

- **Singleton rows** (`profile`, `progressStore`) always use `id = SINGLETON_ID`. There's only ever one user on the device.
- **Raw data only for diagnostics.** Drill and real-text sessions drop their event log after aggregates are computed (spec §2.8).
- **Migrations bump `version(n)`** — never mutate `version(1).stores(...)`. Dexie upgrades only on strictly-increasing versions.
