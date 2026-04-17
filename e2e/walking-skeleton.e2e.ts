import { expect, test } from '@playwright/test';

/**
 * Walking-skeleton coverage (Phase 2.5+6): diagnostic → runner → Dexie →
 * summary page. Also doubles as the TypingSurface integration test now
 * that `/dev/text-display` is gone — the diagnostic route uses the same
 * surface, so error/correction state transitions get exercised here.
 *
 * The passage is no longer hardcoded (Phase 6): it's sampled from the
 * corpus per session. The test reads the live passage from the
 * textbox's `aria-label` (which carries the full text) and types it
 * back, so it stays robust to sampler changes.
 */

test('type diagnostic passage → persisted → summary page shows stats', async ({ page }) => {
	await page.goto('/session/diagnostic');

	// Textbox's aria-label carries the full passage. Wait for the
	// sampler to finish (loading state → ready) before reading it.
	const textbox = page.getByRole('textbox');
	await expect(textbox).toBeVisible();
	await expect(textbox).toBeFocused();

	const passage = (await textbox.getAttribute('aria-label')) ?? '';
	expect(passage.length).toBeGreaterThan(100);

	// Typing mechanics: correct chars advance, a wrong char flags the position,
	// a retype of the expected char flips it to "corrected".
	const firstThree = passage.slice(0, 3);
	const expectedFourth = passage[3];
	const wrongFourth = expectedFourth === 'x' ? 'y' : 'x';

	await page.keyboard.type(firstThree);
	await expect(page.locator('[data-state="typed-correct"]')).toHaveCount(3);
	await page.keyboard.type(wrongFourth);
	await expect(page.locator('[data-state="typed-error"]')).toHaveCount(1);
	await page.keyboard.press('Backspace');
	await page.keyboard.type(expectedFourth);
	await expect(page.locator('[data-state="typed-error-corrected"]')).toHaveCount(1);

	// Finish the rest of the passage in one shot.
	await page.keyboard.type(passage.slice(4));

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
