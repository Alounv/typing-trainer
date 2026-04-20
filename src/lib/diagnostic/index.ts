/**
 * `diagnostic` lib — public API surface.
 *
 * Weakness-report engine. `pacing` is consumed only by the engine and
 * stays internal. The report shapes (`DiagnosticReport`, `PriorityBigram`)
 * live in `$lib/core` — see [ARCHITECTURE.md](../../ARCHITECTURE.md).
 */
export * from './engine';
