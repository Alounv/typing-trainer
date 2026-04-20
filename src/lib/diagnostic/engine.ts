import type { DiagnosticReport } from '../core';
import type { KeystrokeEvent } from '../typing';
import { deriveBaselineWPM } from './pacing';

/** Input bundle for {@link generateDiagnosticReport}. */
interface DiagnosticReportInput {
	events: readonly KeystrokeEvent[];
}

/**
 * Build the persisted diagnostic snapshot. Everything else the analytics and
 * planner need (counts, priority targets, undertrained, bottlenecks) is now
 * derived live from session history, so the report holds only the pacer's
 * baseline WPM — the one number we can't recompute after the fact.
 */
export function generateDiagnosticReport(input: DiagnosticReportInput): DiagnosticReport {
	return { baselineWPM: deriveBaselineWPM(input.events) };
}
