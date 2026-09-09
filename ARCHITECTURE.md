# Architecture

How `src/lib` is organized. Five **domains** sit on top of four **support
layers**; routes compose domains through a thin route-local `loader.ts`.

## Principles

1. **One public surface per domain.** Ideally a single function or a single
   Svelte component. Accept more only when the consumers are genuinely
   distinct.
2. **Domains don't orchestrate — routes do.** Page composition (fetch this,
   compute that, pass to component) lives in `loader.ts` next to each route.
   Domains are pure logic + components; they don't import each other through
   orchestration helpers.
3. **Lib-boundary rule.** Imports must go through a lib barrel (`$lib/corpus`,
   `$lib/support/core`). Deep paths into internals are banned by ESLint. The
   only exceptions are `.svelte` components and `$lib/assets/**`.
4. **Storage stays out of `+page.svelte`.** Route-local `loader.ts` files are
   the orchestration layer and the only place a route may reach storage. A
   domain may own its own reads (`session/tint`, `session/persistence`) — but
   its components take data as props.

## Domains

| Domain       | Responsibility                                          | Public surface                                       |
| ------------ | ------------------------------------------------------- | ---------------------------------------------------- |
| **Corpus**   | Produces the text the user will type.                   | `buildPassage`, `loadBigramFrequencies`              |
| **Session**  | Runs the live typing loop and saves the result.         | `<SessionShell>`                                     |
| **Skill**    | Measures how well the user types, from raw keystrokes.  | `hydrateSession`, `summarizeBigrams`, `assessPacing` |
| **Progress** | Turns session history into views for the user.          | `<Summary>`, `<Analytics>`, `<PacingBadge>`          |
| **Settings** | Reads and writes the user profile; makes data portable. | `getProfile`, `<DataTransfer>`                       |

## Support layers (not domains)

- **`support/core`** — Shared types (`StoredSession`, `KeystrokeStream`,
  `SessionSummary`, `BigramAggregate`, `KeystrokeEvent`, `UserSettings`,
  thresholds, …). Type-only; no runtime; no `$lib/*` imports. The DAG leaf.
- **`support/storage`** — Dexie wrapper, and it stays dumb: it reads and writes
  `StoredSession` rows and derives nothing.
- **`support/loadable.svelte.ts`** — `loadable()`, the loading/ready/error rune
  every route needs. Data lives in IndexedDB, so loading is client-side and
  can't move into SvelteKit's `load`. One function with four call sites, so it
  is a file rather than a folder with a barrel.
- **`support/theme`** — Theme selector component + store.

## Dependency graph

Every edge points down. Nothing below reaches back up.

```
  routes/
    /                    /session/real-text      /session/[id]/summary
    /analytics           /settings
      │                        │
      │  (+page.svelte: UI only — no storage)
      ▼                        ▼
  route-local loader.ts   ────────────────────────────┐
    routes/loader                                     │
    real-text/loader                                  │
    summary/loader                                    │
    analytics/loader                                  │
      │                                               │
      ├──────────────┬──────────────┬─────────────┐   │
      ▼              ▼              ▼             │   │
  ┌────────┐   ┌──────────┐   ┌──────────┐        │   │
  │ corpus │   │  skill   │   │ settings │        │   │
  └────────┘   └──────────┘   └──────────┘        │   │
      ▲              ▲              ▲             │   │
      │              │              │             │   │
      │        ┌─────┴──────┬───────┘             │   │
      │        │            │                     │   │
      │   ┌─────────┐  ┌──────────┐               │   │
      └───│ session │  │ progress │───────────────┘   │
          └─────────┘  └──────────┘                   │
               │            │                         │
               ▼            ▼                         ▼
        ┌──────────────────────────────────────────────────┐
        │  support/storage      support/loadable.svelte    │
        │            └──────────┬───────────┘              │
        │                 support/core                     │
        └──────────────────────────────────────────────────┘
```

Notes on the less obvious edges:

- **Every loader that reads stored rows also depends on Skill**, because a
  stored row has to be hydrated into measurements before anything can read it.
- **Session touches storage directly**, in exactly two files: `persistence`
  (the session write) and `tint` (the one read the tint needs). Its components
  take everything else as props.
- **Skill → Corpus and Progress → Corpus are type-only** (`FrequencyTable`).
- **Session and Progress have no `index.ts`.** Their entire public surface is
  Svelte components, and re-exporting components through a `.ts` barrel costs
  HMR granularity for no gain. The lint rule exempts `.svelte` paths, so this is
  allowed — but it also means nothing stops a route importing one of their
  _internal_ components. That trade is deliberate: both are called by `routes`
  and by nobody else, so the boundary has one consumer to protect it from.

## The training loop

Speed and accuracy are one curve, not two skills, so there is one session type
and one ceiling (5% errors — past it the corrections cost more than the pace
buys). The ceiling is enforced by a loop that closes across sessions rather
than by separate modes:

```
   passage            typing              verdict
   selection  ──────▶  surface   ──────▶  (summary)
       ▲                  ▲                   │
       │                  │  opening tint     │
       │                  └───────────────────┘
       │                                      │
       └────────── bigram debt ◀───────────────┘
                  (skill/debt)
```

Three readings of the same history, each with one job:

| Reading                                  | Decides                         |
| ---------------------------------------- | ------------------------------- |
| `assessPacing` (wpm + error rate)        | what the summary says           |
| the same verdict, next session           | which tint the passage opens on |
| `computeAllBigramDebts` → `buildPassage` | which passage comes next        |

Accuracy is checked first, then pace:

```
                       errors > 5%    errors <= 5%
  clearly under pace    too-fast      room-to-push
  at or near pace       too-fast      well-paced
```

Past the ceiling the pace is wrong however fast it was, so speed is not
consulted. Under it, accuracy has been paid for and the only question left is
whether the speed was collected. "Clearly" is a 5% dead zone around the recent
average (`PACING_SLOW_MARGIN`) — without it, half of anyone's sessions fall
below their own mean and the verdict would fire every other session.

Only `room-to-push` means speed up, so only that flips the tint to draggy
pairs. Everything else leaves it on error-prone ones, and the typist can
override or turn it off at any point.

**What the verdict cannot see.** Being timid and being tired are the same
signal from here — both are slow with accuracy to spare. So `room-to-push` is
named for the opportunity rather than a fault, and its copy hands the call back
to the typist instead of asserting a diagnosis. Acting on it is cheap either
way: pushing on an off day produces errors, and the next session says
`too-fast`.

The tint follows the same rule. A pacer tells you what to do; the tint changes
what you _notice_ and leaves the regulating to you. Both modes are derived from
one read taken when the session mounts (`session/tint`), so flipping the toggle
mid-passage is a pure recompute.

Delivery and accounting are separate choices: real words are what you type,
transitions are what gets credited. Typing `brown` pays down `br ro ow wn`, so
`crown` benefits without ever being drilled — which is why the design needs no
corpus of all words. Real prose supplies the words; the ledger only ever holds
a few hundred transitions.

## Storage model: evidence, not conclusions

A session row stores what happened, and every statistic is a reading of it:

```
        write                                   read
  keystrokes ──encodeStream──> { text, stream } ──hydrateSession──> aggregates
                                  (IndexedDB)                       classifications
```

`text` plus `position` is enough to recover everything else about a keystroke —
the expected character, the word, the position in that word, the surrounding
context — so none of it is stored. Roughly 8 bytes per keystroke: a `positions`
delta (`Int16`, nearly always 1), a `times` delta (`Uint32`, whole ms) and one
UTF-16 character.

Two consequences worth knowing:

- **Thresholds apply retroactively.** Classifications are computed on read, so
  changing what "clean" means re-scores the whole history rather than only
  future sessions.
- **Reads must hydrate.** `support/storage` hands back `StoredSession` (no
  aggregates); consumers read `SessionSummary` (aggregates required). The type
  gap is deliberate — a caller that forgets to hydrate fails to compile.

Rows written before this model have aggregates and no text. `hydrateSession`
passes them through untouched, but they can never gain context: their
keystrokes were never kept. Their session types (`diagnostic`, `bigram-drill`)
no longer exist either — they stay in `SessionType` so old summaries still open.
The `bigramRecords` table mirrors those rows only; nothing writes it and nothing
reads it, and it survives so exporting an old database doesn't drop history.

## Main flows

- **Dashboard (`/`)** — `routes/loader` reads recent rows and scores each with
  `assessPacing`. Scalars only, no stream decoded. One action: start a passage.
- **Session (`/session/real-text`)** — `real-text/loader` hydrates recent
  history to price outstanding bigram debt, then asks `corpus` for the passage
  that repays most per keystroke. `<SessionShell>` captures keystrokes, owns the
  tint, and persists the run via `session/persistence` — the text and the raw
  stream, nothing derived.
- **Summary (`/session/[id]/summary`)** — `summary/loader` fetches the session +
  recent history, or `null` if the id is unknown. The route renders `<Summary>`,
  which states the pacing verdict.
- **Analytics (`/analytics`)** — `analytics/loader` returns sessions, corpus
  frequencies, and thresholds; `<Analytics>` renders the charts.
- **Settings (`/settings`)** — reads/writes via `$lib/settings`; delegates
  export/import UI to `<DataTransfer>`.

## Testing

Each domain has **one test file at its frontier**. Logic domains (`corpus`,
`skill`, `session`) are exercised through their public functions; component
domains (`progress`, settings' `<DataTransfer>`) lean on the `e2e/` Playwright
suite as the outermost frontier. `settings/profile.test.ts` is kept because
`profile` is a public surface.

A domain's own test file may reach one level past the barrel — `scoreQuoteByDebt`,
`decodeStream`, `buildDifficultyMap` — where the function is the domain's core
arithmetic and driving it through the public surface would test the setup
instead of the maths. That is the only exception, and it stays inside the
domain's single test file.
