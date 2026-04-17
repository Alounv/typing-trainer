# `typing/` — keystroke capture & display

The input layer. Owns the typing surface, captures keystrokes, renders
per-character state, and post-processes the raw log into first-input events.
Everything downstream (bigram extraction, session summaries, diagnostics)
feeds on what this module produces.

## Big picture

```
                ┌──────────────────────────────────────────────┐
  user keys ──▶ │               <TypingSurface>                │
                │  role="textbox"  tabindex=0                  │
                │  ┌────────────────────────────────────────┐  │
                │  │     attachment: keystrokeCapture       │  │
                │  │  ─ records KeystrokeEvent per keydown  │  │
                │  │  ─ tracks position / wordIndex         │  │
                │  │  ─ fires onEvent / onPositionChange    │  │
                │  │  ─ fires onComplete(events[]) at end   │  │
                │  └──────────────────┬─────────────────────┘  │
                │                     │ position               │
                │                     ▼                        │
                │          <TextDisplay text position ...>     │
                │          (pure render: typed / error /       │
                │           corrected / current / pending /    │
                │           ghost)                             │
                └─────────────┬────────────────────────────────┘
                              │ onComplete
                              ▼
                    raw KeystrokeEvent[]
                              │
                              ▼
                ┌──────────────────────────────┐
                │     annotateFirstInputs      │   postprocess.ts
                │  groups events by position,  │
                │  keeps earliest, flags       │
                │  `corrected` + delay         │
                └─────────────┬────────────────┘
                              ▼
                 AnnotatedKeystrokeEvent[]
                 (feeds bigram/extraction.ts)

   side channel: <Pacer targetWPM position textLength running />
                 drives ghostPosition via setInterval(100ms);
                 parent binds it back into TextDisplay.
```

## Files

- [types.ts](types.ts) — `KeystrokeEvent`, `CaptureConfig`, `DEFAULT_CORRECTION_WINDOW_MS`.
- [capture.ts](capture.ts) — `keystrokeCapture`, the Svelte attachment. Plain-array event buffer (never `$state`) so typing doesn't trigger re-renders.
- [postprocess.ts](postprocess.ts) — `annotateFirstInputs`: collapses retypes into the first-input event, flags `corrected` + `correctionDelay`.
- [TypingSurface.svelte](TypingSurface.svelte) — focusable `role="textbox"` wrapper; owns capture + a11y (aria-label, optional live region).
- [TextDisplay.svelte](TextDisplay.svelte) — per-char renderer. State = `typed-correct` / `typed-error` / `typed-error-corrected` / `current` / `pending` (+ ghost overlay).
- [Pacer.svelte](Pacer.svelte) — ghost cursor clock at `targetWPM` (5 char = 1 word). Badge: on-pace / behind / far-behind.

## Key invariants

- **First input sticks.** Spec §2.2: the first keystroke at a position counts for error rate. Retypes are recorded at the same position and resolved by `annotateFirstInputs` — they never overwrite history.
- **Backspace moves the cursor, does not delete events.** Post-processing decides what "correction" means.
- The capture buffer is a **plain array**, never reactive. Consumers render from the `position` signal, not from the growing event list.
