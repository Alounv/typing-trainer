# `scheduler/` — daily session structure (planned)

> Empty today. README captures intended shape; work resumes once sessions
> and progress are wired end-to-end.

The scheduler decides **what the user does next**, without asking them. Spec
§5 treats this as first-class: users should not be left to pick sessions
manually — that's how people over-drill weak bigrams, skip diagnostics, or
plateau on real text.

## Intended big picture

```
                    app launch / "next session" press
                                 │
                                 ▼
        ┌────────────────────────────────────────────────┐
        │                 scheduler                      │
        │                                                │
        │  inputs:                                       │
        │   ─ last N SessionSummary (type, timestamp)    │
        │   ─ ProgressStore (graduationHistory)          │
        │   ─ latest DiagnosticReport (priorityTargets)  │
        │   ─ UserSettings                               │
        │                                                │
        │  rules (§5):                                   │
        │   • run full diagnostic every 7 sessions       │
        │   • default daily = drill (5m) + real-text(10m)│
        │   • a bigram `healthy` for 3 consecutive       │
        │     sessions → drop from drill rotation        │
        │                                                │
        │  outputs: ordered SessionConfig[] for today    │
        └──────────────────────┬─────────────────────────┘
                               │
             ┌─────────────────┼────────────────┐
             ▼                 ▼                ▼
      SessionConfig      SessionConfig    SessionConfig
      type: diagnostic   type: bigram-    type: real-text
       (every 7th)       drill             (10 min, pacer)
                          (targets from
                           diagnostic,
                           filtered)
                               │
                               ▼
                        session runner
```

## What will live here

- A pure `planDailySessions(state)` function — stateless given the inputs.
- A drill-rotation filter: "which priority bigrams are still worth drilling
  given recent graduations?"
- A "time since last diagnostic" check triggering the every-7-session rule.

## Related spec sections

- §5 — Session Scheduler.
- §10 — Progress: what the scheduler reads to decide the next session.
