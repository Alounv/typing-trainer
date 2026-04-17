import { expect, test } from '@playwright/test';

/**
 * Walking-skeleton coverage (Phase 2.5): diagnostic → runner → Dexie →
 * summary page. Also doubles as the TypingSurface integration test now
 * that `/dev/text-display` is gone — the diagnostic route uses the same
 * surface, so error/correction state transitions get exercised here.
 */

const PASSAGE =
	'The quick brown fox jumps over the lazy dog. Typing trainers improve speed and accuracy through deliberate practice.';

test('type diagnostic passage → persisted → summary page shows stats', async ({ page }) => {
	await page.goto('/session/diagnostic');

	// Textbox's accessible name carries the full passage via aria-label.
	const textbox = page.getByRole('textbox', { name: /The quick brown fox/ });
	await expect(textbox).toBeFocused();

	// Typing mechanics: correct chars advance, a wrong char flags the position,
	// a retype of the expected char flips it to "corrected".
	await page.keyboard.type('The');
	await expect(page.locator('[data-state="typed-correct"]')).toHaveCount(3);
	await page.keyboard.type('x'); // expected ' ', typed 'x' → uncorrected error at position 3
	await expect(page.locator('[data-state="typed-error"]')).toHaveCount(1);
	await page.keyboard.press('Backspace');
	await page.keyboard.type(' ');
	await expect(page.locator('[data-state="typed-error-corrected"]')).toHaveCount(1);

	// Finish the rest of the passage (position 4 onward) in one shot.
	await page.keyboard.type(PASSAGE.slice(4));

	// URL transitions to /session/<uuid>/summary. The uuid matches v4 shape,
	// but we just assert the path segment — shape is the contract here.
	await page.waitForURL(/\/session\/[^/]+\/summary$/);

	await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();

	// WPM surfaces a non-zero number. We don't pin the value because it depends
	// on how fast Playwright's `keyboard.type` fires — machine-dependent.
	const wpm = page.getByTestId('wpm-value');
	await expect(wpm).toBeVisible();
	const wpmText = await wpm.textContent();
	expect(Number(wpmText)).toBeGreaterThan(0);

	// Slowest-5 tiles populated — the passage is long enough to yield at least
	// a handful of clean bigrams.
	const tiles = page.getByTestId('slowest-tiles').locator('li');
	await expect(tiles).toHaveCount(5);
});
