import { expect, test } from '@playwright/test';

/**
 * Settings auto-saves on change (debounced). Toggling French on must persist
 * through a page reload — a regression where `$state.snapshot` is dropped at
 * the write boundary would load the old profile back and un-check the box.
 */

test('settings: toggling a language persists across a reload', async ({ page }) => {
	await page.goto('/settings');

	// The input itself is `sr-only` and a custom pip intercepts pointer
	// events, so use `force` to drive the checkbox directly.
	const french = page.getByTestId('lang-fr');
	await expect(french).not.toBeChecked();
	await french.check({ force: true });
	// Auto-save is debounced (~400 ms); wait for the "Saved · …" indicator.
	await expect(page.getByText(/^Saved ·/)).toBeVisible({ timeout: 2000 });

	await page.reload();

	await expect(page.getByTestId('lang-fr')).toBeChecked();
});
