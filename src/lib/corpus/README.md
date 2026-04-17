# `corpus/` — corpus configuration & frequency tables

A corpus is the text the user practices on: a built-in wordlist (e.g.
`"en-top-1000"`), or their own pasted text. The user can have multiple
corpora across languages; one is active per session.

Only types today. Loaders, built-in wordlists, and frequency derivation land
in this folder when the selection/drill pipeline wires up.

## Big picture

```
  UserSettings.corpusIds[]
         │
         ▼
  ┌───────────────────────────────┐
  │       CorpusConfig            │   persisted
  │   id · language               │
  │   wordlistId                  │    ← built-in reference
  │   customText? (§6.3)          │    ← pasted text (custom corpora)
  └──────────────┬────────────────┘
                 │  load
                 ▼
  ┌───────────────────────────────┐
  │       CorpusData              │   in-memory
  │   config                      │
  │   wordFrequencies:            │    derived from text on load —
  │     { token → count/weight }  │    cheap to recompute, never stored
  │   bigramFrequencies:          │
  │     { bigram → count/weight } │
  └──────────────┬────────────────┘
                 │
                 ├──▶ drill/ (pick words containing target bigrams)
                 ├──▶ diagnostic/ corpusFit.coverageRatio
                 │                (what fraction of corpus bigrams
                 │                 have ≥10 observations?)
                 └──▶ real-text session selection
                      (prefer sentences dense with target bigrams)
```

## Files

- [types.ts](types.ts) — `CorpusConfig`, `FrequencyTable`, `CorpusData`.

## Design notes

- **Frequencies aren't stored on the config** — only the text reference is.
  Recomputing from the text takes milliseconds and keeps the persisted shape
  minimal. Spec §2.6.
- **`FrequencyTable` units are opaque** (raw counts vs. normalized weights).
  Callers interpret.
- **Multi-language support via `UserSettings.languages[]` + `corpusIds[]`.**
  One corpus per language, ordered by priority; the first entry drives the
  default session.
