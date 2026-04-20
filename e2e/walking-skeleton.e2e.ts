import { expect, test } from '@playwright/test';

/**
 * Walking-skeleton coverage: diagnostic → runner → Dexie → summary.
 * Also exercises TypingSurface (error/correction state transitions).
 * Reads passage from textbox aria-label (sampler populates it) so the test stays robust to sampler changes.
 */

test('type diagnostic passage → persisted → summary page shows stats', async ({ page }) => {
	await page.goto('/session/diagnostic');

	const textbox = page.getByRole('textbox');
	await expect(textbox).toBeVisible();
	await expect(textbox).toBeFocused();

	const passage = (await textbox.getAttribute('aria-label')) ?? '';
	expect(passage.length).toBeGreaterThan(100);

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

	await page.keyboard.type(passage.slice(4));

	await page.waitForURL(/\/session\/[^/]+\/summary$/);

	await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();

	// WPM value isn't pinned — depends on Playwright's keyboard.type speed (machine-dependent).
	const wpm = page.getByTestId('wpm-value');
	await expect(wpm).toBeVisible();
	const wpmText = await wpm.textContent();
	expect(Number(wpmText)).toBeGreaterThan(0);

	const tiles = page.getByTestId('slowest-tiles').locator('li');
	await expect(tiles).toHaveCount(5);
});
