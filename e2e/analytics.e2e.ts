import { expect, test } from '@playwright/test';
import { runDiagnostic } from './fixtures';

/**
 * Analytics page renders its four sections once at least one diagnostic is on
 * file. Covers the render path — loader → <Analytics> → charts — not chart
 * interactivity. A crash in any of the derived values (bigram summaries, WPM
 * series, classification mix, graduations) would fail here.
 */

test('analytics: renders all four sections after a diagnostic is recorded', async ({ page }) => {
	await runDiagnostic(page);

	await page.goto('/analytics');

	await expect(page.getByTestId('wpm-trend')).toBeVisible();
	await expect(page.getByTestId('error-rate-trend')).toBeVisible();
	await expect(page.getByTestId('classification-distribution')).toBeVisible();
	await expect(page.getByTestId('bigram-table')).toBeVisible();
});
