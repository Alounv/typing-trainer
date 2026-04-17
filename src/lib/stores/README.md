# `stores/` — cross-route reactive state (planned)

> Empty today. Placeholder for Svelte runes/stores that outlive a single
> route's lifecycle.

Most state in this app is **local** to a component (capture buffer, per-char
display state) or **persisted** (storage/). The middle ground — state that
needs to be shared across routes without hitting IndexedDB on every read —
lives here.

## Intended big picture

```
    storage/ (IndexedDB — cold, per-op)
             │
             │  hydrate on app load
             ▼
   ┌───────────────────────────────────────────┐
   │              stores/ (runes)              │
   │                                           │
   │   currentUserSettings   ─ $state wrapper  │
   │                           around profile  │
   │                           (spec §2.4)     │
   │                                           │
   │   currentCorpus         ─ loaded          │
   │                           CorpusData;     │
   │                           swap on         │
   │                           language change │
   │                                           │
   │   activeSession?        ─ the in-flight   │
   │                           SessionConfig + │
   │                           live stats      │
   │                                           │
   │   progressSnapshot      ─ cached          │
   │                           ProgressStore;  │
   │                           invalidated     │
   │                           on saveSession  │
   └───────────────────┬───────────────────────┘
                       │  read/mutate
                       ▼
                +page.svelte / components
```

## Rules of thumb

- **Hydrate from storage once** at app load, write through on mutation.
- **No typing-hot-path state here** — per-keystroke updates go through local
  component state (see `typing/README.md`), never a global store.
- **Progress snapshot is cache-first**: read here, write through to
  `storage/saveProgressStore`.
