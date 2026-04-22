import type { DiagnosticReport, KeystrokeEvent } from '../support/core';

interface DiagnosticReportInput {
	events: readonly KeystrokeEvent[];
}

/**
 * Build the persisted diagnostic snapshot. Everything else the analytics and planner need
 * (counts, priority targets, undertrained, bottlenecks) is derived live from session
 * history, so the report holds only the pacer's baseline WPM — the one number we can't
 * recompute after the fact.
 */
export function generateDiagnosticReport(input: DiagnosticReportInput): DiagnosticReport {
	return { baselineWPM: deriveBaselineWPM(input.events) };
}

/** Wall-clock WPM across the event span. Mirrors session WPM so the pacer tracks sustained pace, not a pauses-stripped peak. */
export function deriveBaselineWPM(events: readonly KeystrokeEvent[]): number {
	if (events.length < 2) return 0;
	const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
	const durationMs = sorted[sorted.length - 1].timestamp - sorted[0].timestamp;
	if (durationMs <= 0) return 0;
	const positions = new Set<number>();
	for (const e of sorted) positions.add(e.position);
	return positions.size / 5 / (durationMs / 60_000);
}
