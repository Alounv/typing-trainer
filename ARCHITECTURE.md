# Architecture

High-level schema of how `src/lib` is organized. Six **domains** sit on top of
two **support layers**; routes compose domains through a thin route-local
`loader.ts`.

## Principles

1. **One public surface per domain.** Ideally a single function or a single
   Svelte component. Accept two only when the consumers are genuinely distinct.
2. **Domains don't orchestrate — routes do.** Page composition (fetch this,
   compute that, pass to component) lives in `loader.ts` next to each route.
   Domains are pure logic + components; they don't import each other through
   orchestration helpers.
3. **Lib-boundary rule.** Imports must go through a lib barrel (`$lib/corpus`,
   `$lib/support/core`). Deep paths into internals are banned by ESLint. The
   only exceptions are `.svelte` components and `$lib/assets/**`.
4. **UI must not touch storage directly.** Routes (`+page.svelte`) can't import
   `$lib/support/storage`; route-local `loader.ts` files are the orchestration
   layer and are the only place that may.

## Domains

| Domain       | Responsibility                                          | Public surface                        |
| ------------ | ------------------------------------------------------- | ------------------------------------- |
| **Corpus**   | Produces the text the user will type.                   | `generateText`, registry loaders      |
| **Plan**     | Resolves "what should the user do next?".               | `computePlan`, `resolveDrillMix`      |
| **Session**  | Runs the live typing loop and saves the result.         | `<SessionShell>`                      |
| **Skill**    | Measures how well the user types each bigram.           | `extractBigramAggregates`, assessment |
| **Progress** | Turns session history into views for the user.          | `<Summary>`, `<Analytics>`            |
| **Settings** | Reads and writes the user profile; makes data portable. | `profile`, `<DataTransfer>`           |

## Support layers (not domains)

- **`support/core`** — Shared types (`SessionSummary`, `BigramAggregate`,
  `KeystrokeEvent`, `UserSettings`, thresholds, …). Type-only; no runtime; no
  `$lib/*` imports. The DAG leaf.
- **`support/storage`** — Dexie wrapper. Only domains and route-local loaders
  touch it; UI never does.
- **`support/theme`** — Theme selector component + store.

## Dependency graph

```mermaid
flowchart TB
    subgraph Routes["routes/"]
        R_Dash["/"]
        R_Drill["/session/{accuracy,speed}-drill"]
        R_Real["/session/real-text"]
        R_Diag["/session/diagnostic"]
        R_Summ["/session/[id]/summary"]
        R_Ana["/analytics"]
        R_Set["/settings"]
    end

    subgraph Loaders["route-local loader.ts"]
        L_Drill["drill-loader"]
        L_Real["real-text/loader"]
        L_Diag["diagnostic/loader"]
        L_Summ["summary/loader"]
        L_Ana["analytics/loader"]
    end

    subgraph Domains["src/lib/"]
        D_Corpus["corpus"]
        D_Plan["plan"]
        D_Skill["skill"]
        D_Session["session<br/>(&lt;SessionShell&gt;)"]
        D_Progress["progress<br/>(&lt;Summary&gt;, &lt;Analytics&gt;)"]
        D_Settings["settings<br/>(profile, &lt;DataTransfer&gt;)"]
    end

    %% Routes → loaders (orchestration) and components.
    R_Dash --> D_Plan
    R_Drill --> L_Drill
    R_Drill --> D_Session
    R_Real --> L_Real
    R_Real --> D_Session
    R_Diag --> L_Diag
    R_Diag --> D_Session
    R_Diag --> D_Skill
    R_Summ --> L_Summ
    R_Summ --> D_Progress
    R_Summ --> D_Plan
    R_Ana --> L_Ana
    R_Ana --> D_Progress
    R_Set --> D_Settings

    %% Loaders compose domains.
    L_Drill --> D_Corpus
    L_Drill --> D_Plan
    L_Drill --> D_Settings
    L_Real --> D_Corpus
    L_Real --> D_Plan
    L_Real --> D_Settings
    L_Diag --> D_Corpus
    L_Diag --> D_Settings
    L_Summ --> D_Plan
    L_Ana --> D_Corpus
    L_Ana --> D_Settings

    %% Domain → domain edges (all point toward Skill or Corpus).
    D_Plan --> D_Skill
    D_Plan --> D_Corpus
    D_Plan --> D_Settings
    D_Session --> D_Skill

    classDef route fill:#1e3a5f,stroke:#5aa9e6,color:#e6f2ff
    classDef loader fill:#3d2b5a,stroke:#a78bfa,color:#f0e6ff
    classDef domain fill:#2d4a2b,stroke:#7cb342,color:#eaffea

    class R_Dash,R_Drill,R_Real,R_Diag,R_Summ,R_Ana,R_Set route
    class L_Drill,L_Real,L_Diag,L_Summ,L_Ana loader
    class D_Corpus,D_Plan,D_Session,D_Skill,D_Progress,D_Settings domain
```

## Main flows

- **Dashboard (`/`)** — calls `computePlan` directly (no loader; the dashboard
  is just a thin view over the plan). `startPlannedSession` / `startFreshPlan`
  from `$lib/plan` handle the hand-off to session routes.
- **Drill sessions (`/session/{accuracy,speed}-drill`)** — shared
  `routes/session/drill-loader.ts` consumes any planned hand-off, resolves a
  drill mix via `plan`, generates text via `corpus`, and returns a ready-to-render
  config. `<SessionShell>` captures keystrokes, aggregates via `skill`, persists
  via `session/persistence`.
- **Real-text / diagnostic sessions** — their own `loader.ts` files call into
  `corpus.generateText` with the right spec; the rest mirrors the drill flow.
- **Summary (`/session/[id]/summary`)** — `summary/loader` fetches the session +
  recent history, re-runs `computePlan` for the "Next session" CTA, and returns
  one view-model. The route renders `<Summary>` and wires the hand-off actions.
- **Analytics (`/analytics`)** — `analytics/loader` returns sessions, profile,
  and corpus frequencies; `<Analytics>` renders the charts.
- **Settings (`/settings`)** — reads/writes via `$lib/settings.profile`;
  delegates export/import UI to `<DataTransfer>`.

## Testing

Each domain has **one test file per public entry point** (R5 in the now-retired
reshape plan). Logic domains (`corpus`, `plan`, `skill`) are exercised through
their public functions; component domains (`session`, `progress`, settings'
`<DataTransfer>`) lean on the `e2e/` Playwright suite as the outermost frontier.
`settings/profile.test.ts` is kept because `profile` is a public surface.

A test-only helper at `$lib/test-utils/fixtures.ts` lets tests seed state
without exposing domain internals on the production surface.
