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

/**
 * The two factors behind the priority score get their own columns, so the table
 * shows *why* a row ranks where it does. Asserted here because the unit tests
 * only reach `summarizeBigrams` — nothing else proves the values make it onto
 * the page, and a rename in the component would otherwise pass CI silently.
 */
test('analytics: bigram table exposes the priority factors as sortable columns', async ({
	page
}) => {
	await runDiagnostic(page);
	await page.goto('/analytics');

	const table = page.getByTestId('bigram-table');
	await expect(table.getByRole('button', { name: /^Time lost/ })).toBeVisible();
	await expect(table.getByRole('button', { name: /^Freq\./ })).toBeVisible();
	await expect(table.getByRole('button', { name: /^Priority/ })).toBeVisible();

	// A time-loss cell should render as milliseconds (or a dash when under 0.5ms).
	const firstRow = table.locator('tbody tr').first();
	await expect(firstRow.locator('td').nth(-3)).toHaveText(/^(\d+ ms|—)$/);
	// ...and frequency as a percentage with two decimals.
	await expect(firstRow.locator('td').nth(-2)).toHaveText(/^(\d+\.\d{2}%|—)$/);

	// Sorting by the new column must actually reorder, not silently no-op.
	const before = await table.locator('tbody tr td:first-child').allTextContents();
	await table.getByRole('button', { name: /^Time lost/ }).click();
	const after = await table.locator('tbody tr td:first-child').allTextContents();
	expect(after).not.toEqual(before);
});
