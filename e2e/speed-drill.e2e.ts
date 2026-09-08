import { expect, test } from '@playwright/test';
import { runDiagnostic } from './fixtures';

/**
 * Speed drill reaches the same shell as every other session type; the drill
 * mode only changes which bigrams are targeted. The pacer ghost this test used
 * to assert is gone, so what's left worth checking is that the route still
 * builds a passage off a prior diagnostic and persists what was typed.
 */

test(
	'speed drill: builds a passage from prior history and persists the session',
	{
		annotation: { type: 'slow', description: 'diagnostic pass + speed-drill pass end-to-end' }
	},
	async ({ page }) => {
		await runDiagnostic(page);

		await page.goto('/');
		await page.getByTestId('override-speed-drill').click();
		await expect(page).toHaveURL(/\/session\/speed-drill$/);

		const textbox = page.getByRole('textbox');
		await expect(textbox).toBeVisible();
		await expect(textbox).toBeFocused();

		const passage = (await textbox.getAttribute('aria-label')) ?? '';
		expect(passage.length).toBeGreaterThan(0);
		await page.keyboard.type(passage);
		await page.waitForURL(/\/session\/[^/]+\/summary$/);
		await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
	}
);
