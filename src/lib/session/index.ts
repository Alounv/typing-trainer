/**
 * Session
 * Runs the live typing loop and saves the result.
 *
 * Captures keystrokes from the input element, drives the ghost pacer,
 * annotates the raw event stream into a summary, and persists that summary
 * (plus mirrored bigram rows) atomically. Does not decide what to type —
 * `corpus` generates the text, `plan` picks the drill.
 */
export { saveSession } from './persistence';
