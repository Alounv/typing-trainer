# Architecture

High-level schema of how the `src/lib` modules interact. Each route is itself a
Svelte page; the **UI layer** below shows only reusable components imported from
`$lib`.

Routes talk to **one loader per page** plus the components they render —
loaders are the single route→domain boundary. Routes never import
`storage/*`, `session/delta`, `progress/celebrations`, or domain sub-modules
directly; each loader composes the pieces its page needs and returns a
ready-to-render view-model. Persistence is mediated by the domain
(`settings/profile`, `settings/data-transfer`, `session/persistence`, the
loaders).

```mermaid
flowchart TB
    subgraph Routes["routes/"]
        R["/ · /session/* · /session/[id]/summary<br/>/analytics · /settings"]
    end

    subgraph Domain["src/lib (domain)"]
        session
        practice
        progress
        settings
        diagnostic
        corpus
        bigram
        typing
        core
    end

    subgraph Support["src/lib (support UI)"]
        stores
        components
    end

    subgraph Infra["Infra"]
        storage[("storage<br/>IndexedDB")]
    end

    %% Route → domain. Each page enters the domain through one (or two) libs,
    %% never directly into storage.
    R --> session
    R --> practice
    R --> progress
    R --> settings
    R --> diagnostic
    R --> bigram
    R --> corpus
    R --> core
    R --> stores
    R --> components

    %% Domain → domain (all forward-only, strict DAG).
    session --> practice
    session --> progress
    session --> diagnostic
    session --> bigram
    session --> typing
    session --> core
    practice --> settings
    practice --> diagnostic
    practice --> corpus
    practice --> bigram
    practice --> core
    progress --> settings
    progress --> corpus
    progress --> bigram
    progress --> core
    settings --> bigram
    settings --> core
    diagnostic --> corpus
    diagnostic --> bigram
    diagnostic --> typing
    diagnostic --> core
    bigram --> typing
    bigram --> core
    components --> stores

    %% Domain → infra. Only these libs touch storage; routes never do.
    session --> storage
    practice --> storage
    progress --> storage
    settings --> storage
    storage --> core

    classDef route fill:#1e3a5f,stroke:#5aa9e6,color:#e6f2ff
    classDef domain fill:#2d4a2b,stroke:#7cb342,color:#eaffea
    classDef support fill:#5c3d1e,stroke:#e89f4c,color:#fff2e0
    classDef infra fill:#5a2740,stroke:#e06c9f,color:#ffe6f0
    class R route
    class session,practice,progress,settings,diagnostic,corpus,bigram,typing,core domain
    class stores,components support
    class storage infra
```

## Main flows

- **Dashboard (`/`)** — calls `practice/dashboard-loader` which fetches recent sessions, runs the planner, and returns the next planned session(s). The loader also exposes `startPlannedSession` / `startBonusRound` so the route doesn't touch `sessionStorage` or `window.location` directly.
- **Session write-path (`/session/*`)** — route calls a `practice/session-loader` (`prepareBigramDrillSession` / `prepareRealTextSession` / `prepareDiagnosticSession`) to get ready-to-render text + metadata. The loader consumes any `practice/planned` hand-off stashed by the dashboard. `SessionShell` → `TypingSurface` captures raw keystrokes → `typing/postprocess` annotates → `session/runner` aggregates (delegating bigram math to `bigram/extraction`) → `SessionSummary` persisted via `session/persistence`.
- **Summary (`/session/[id]/summary`)** — `session/summary-loader` fetches the session + recent history, runs `session/delta`, `progress/celebrations`, and a shared `practice/dashboard-loader` call (reusing the same `recentSessions`), and returns one view-model. The route is render-only plus the `startPlannedSession` / `startBonusRound` hand-off actions.
- **Analytics (`/analytics`)** — `progress/analytics-loader` returns sessions + profile + corpus frequencies + pre-computed trend series (via `progress/metrics`), and the charts render them.
- **Settings (`/settings`)** — reads/writes `settings/profile`; delegates export/import UI to `DataTransfer`, which talks to `settings/data-transfer`.

## Module purposes

| Module       | Role                                                                                                                                                                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typing`     | Keystroke capture attachment, `KeystrokeEvent` types, postprocess annotation.                                                                                                                                                                                   |
| `session`    | `SessionRunner`, `SessionSummary` construction, delta computation, `saveSession`, summary loader, UI components.                                                                                                                                                |
| `bigram`     | Classification (+ thresholds), extraction, accuracy/timing aggregation from events.                                                                                                                                                                             |
| `diagnostic` | Weakness-report engine and pacing computation. Practice-side sampling lives in `practice`.                                                                                                                                                                      |
| `practice`   | What-to-practice-next domain: drill/real-text/diagnostic text generation, planner, graduation filter, bonus round, route hand-off (`planned`), plus the dashboard and session loaders routes call.                                                              |
| `corpus`     | Text corpus registry, loading, normalization, custom texts.                                                                                                                                                                                                     |
| `progress`   | Metrics computation, celebrations logic, analytics chart components, analytics loader.                                                                                                                                                                          |
| `storage`    | IndexedDB Dexie instance + low-level helpers. Only domain modules call into it; UI goes through the domain.                                                                                                                                                     |
| `stores`     | Theme UI state.                                                                                                                                                                                                                                                 |
| `components` | Shared UI (theme selector).                                                                                                                                                                                                                                     |
| `settings`   | User-profile domain (`profile`), export/import domain (`data-transfer`), `DataTransfer` component.                                                                                                                                                              |
| `core`       | Shared domain types (`SessionSummary`, `SessionType`, `SessionConfig`, `UserSettings`, `Language`, `BigramAggregate`, `BigramClassification`, `BigramSample`, `DiagnosticReport`, `PriorityBigram`). Type-only; no runtime, no `$lib/*` imports — the DAG leaf. |
