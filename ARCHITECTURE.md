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
    subgraph Routes["routes/ (pages)"]
        R_Dash["/ (dashboard)"]
        R_Sess["/session/*<br/>(diagnostic, bigram-drill,<br/>real-text)"]
        R_Summary["/session/[id]/summary"]
        R_Ana["/analytics"]
        R_Set["/settings"]
    end

    subgraph UI["UI components ($lib)"]
        Shell["session/components<br/>SessionShell"]
        Surface["typing/TypingSurface"]
        SummaryCmp["session/components<br/>SessionDelta,<br/>Graduations,<br/>MilestoneBanner"]
        Charts["progress/components<br/>WpmChart,<br/>ErrorRateChart,<br/>BigramTable,<br/>ClassificationBar"]
        DataXfer["settings/<br/>DataTransfer"]
    end

    subgraph Domain["Domain (TS)"]
        Typing["typing<br/>capture + postprocess"]
        Runner["session/runner"]
        Persistence["session/persistence<br/>saveSession"]
        SummaryLoader["session/summary-loader<br/>(wraps delta +<br/>celebrations + plan)"]

        DashLoader["practice/<br/>dashboard-loader<br/>(+ startPlannedSession,<br/>startBonusRound)"]
        SessLoader["practice/<br/>session-loader<br/>(prepare* functions)"]
        PracticeCore["practice<br/>planner, graduation-filter,<br/>bigram-drill, real-text,<br/>diagnostic-sampler,<br/>bonus-round, planned"]

        Celebrations["progress/celebrations"]
        Metrics["progress/metrics"]
        AnalyticsLoader["progress/<br/>analytics-loader"]

        Bigram["bigram<br/>extraction + classification"]
        Diag["diagnostic<br/>engine + pacing"]
        Corpus["corpus<br/>registry + loader"]
        Profile["settings/profile"]
        DataTransferDom["settings/<br/>data-transfer"]
    end

    subgraph Infra["Infra"]
        Storage[("storage<br/>IndexedDB")]
    end

    %% Dashboard — single loader boundary.
    R_Dash --> DashLoader

    %% Session write-path (keystroke -> storage)
    R_Sess --> Shell
    R_Sess --> SessLoader
    Shell --> Surface
    Shell --> Runner
    Shell --> Persistence
    Surface -- "KeystrokeEvent[]" --> Typing
    Typing --> Runner
    Runner --> Bigram

    %% Summary — loader returns delta + celebrations + next planned session.
    %% The DashLoader edge is only for the `startPlannedSession` /
    %% `startBonusRound` hand-off actions, not data loading.
    R_Summary --> SummaryCmp
    R_Summary --> SummaryLoader
    R_Summary --> DashLoader

    %% Analytics
    R_Ana --> Charts
    R_Ana --> AnalyticsLoader

    %% Settings
    R_Set --> DataXfer
    R_Set --> Profile
    DataXfer --> DataTransferDom

    %% Domain internal + domain -> infra
    SummaryLoader --> Metrics
    SummaryLoader --> Celebrations
    SummaryLoader --> DashLoader
    SummaryLoader --> Storage
    SessLoader --> PracticeCore
    SessLoader --> Corpus
    SessLoader --> Profile
    SessLoader --> Storage
    DashLoader --> PracticeCore
    DashLoader --> Diag
    DashLoader --> Profile
    DashLoader --> Storage
    AnalyticsLoader --> Metrics
    AnalyticsLoader --> Storage
    AnalyticsLoader --> Profile
    AnalyticsLoader --> Corpus
    PracticeCore --> Corpus
    PracticeCore --> Bigram
    Celebrations --> Metrics
    Celebrations --> Bigram
    Metrics --> Bigram
    Diag --> Corpus
    Diag --> Bigram
    Profile --> Storage
    DataTransferDom --> Storage
    Persistence --> Storage

    classDef route fill:#1e3a5f,stroke:#5aa9e6,color:#e6f2ff
    classDef ui fill:#5c3d1e,stroke:#e89f4c,color:#fff2e0
    classDef domain fill:#2d4a2b,stroke:#7cb342,color:#eaffea
    classDef infra fill:#5a2740,stroke:#e06c9f,color:#ffe6f0
    class R_Dash,R_Sess,R_Summary,R_Ana,R_Set route
    class Shell,Surface,SummaryCmp,Charts,DataXfer ui
    class Typing,Runner,Persistence,SummaryLoader,DashLoader,SessLoader,PracticeCore,Metrics,Celebrations,AnalyticsLoader,Bigram,Diag,Corpus,Profile,DataTransferDom domain
    class Storage infra
```

## Main flows

- **Dashboard (`/`)** — calls `practice/dashboard-loader` which fetches recent sessions, runs the planner, and returns the next planned session(s). The loader also exposes `startPlannedSession` / `startBonusRound` so the route doesn't touch `sessionStorage` or `window.location` directly.
- **Session write-path (`/session/*`)** — route calls a `practice/session-loader` (`prepareBigramDrillSession` / `prepareRealTextSession` / `prepareDiagnosticSession`) to get ready-to-render text + metadata. The loader consumes any `practice/planned` hand-off stashed by the dashboard. `SessionShell` → `TypingSurface` captures raw keystrokes → `typing/postprocess` annotates → `session/runner` aggregates (delegating bigram math to `bigram/extraction`) → `SessionSummary` persisted via `session/persistence`.
- **Summary (`/session/[id]/summary`)** — `session/summary-loader` fetches the session + recent history, runs `session/delta`, `progress/celebrations`, and a shared `practice/dashboard-loader` call (reusing the same `recentSessions`), and returns one view-model. The route is render-only plus the `startPlannedSession` / `startBonusRound` hand-off actions.
- **Analytics (`/analytics`)** — `progress/analytics-loader` returns sessions + profile + corpus frequencies + pre-computed trend series (via `progress/metrics`), and the charts render them.
- **Settings (`/settings`)** — reads/writes `settings/profile`; delegates export/import UI to `DataTransfer`, which talks to `settings/data-transfer`.

## Module purposes

| Module       | Role                                                                                                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typing`     | Keystroke capture attachment, `KeystrokeEvent` types, postprocess annotation.                                                                                                                      |
| `session`    | `SessionRunner`, `SessionSummary` construction, delta computation, `saveSession`, summary loader, UI components.                                                                                   |
| `bigram`     | Classification (+ thresholds), extraction, accuracy/timing aggregation from events.                                                                                                                |
| `diagnostic` | Weakness-report engine and pacing computation. Practice-side sampling lives in `practice`.                                                                                                         |
| `practice`   | What-to-practice-next domain: drill/real-text/diagnostic text generation, planner, graduation filter, bonus round, route hand-off (`planned`), plus the dashboard and session loaders routes call. |
| `corpus`     | Text corpus registry, loading, normalization, custom texts.                                                                                                                                        |
| `progress`   | Metrics computation, celebrations logic, analytics chart components, analytics loader.                                                                                                             |
| `storage`    | IndexedDB Dexie instance + low-level helpers. Only domain modules call into it; UI goes through the domain.                                                                                        |
| `stores`     | Theme UI state.                                                                                                                                                                                    |
| `components` | Shared UI (theme selector).                                                                                                                                                                        |
| `settings`   | User-profile domain (`profile`), export/import domain (`data-transfer`), `DataTransfer` component.                                                                                                 |
