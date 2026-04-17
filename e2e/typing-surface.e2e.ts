import { expect, test } from '@playwright/test';

/**
 * End-to-end coverage of the typing surface at `/dev/text-display`.
 * Exercises capture → TextDisplay state transitions → Pacer ghost + badge →
 * error live region. This page is throwaway (Phase 2.5 will replace it with
 * a proper walking skeleton); delete this spec when the dev route goes away.
 */
test('typing surface captures input, flags errors and corrections, drives pacer', async ({
	page
}) => {
	await page.goto('/dev/text-display');

	// The textbox's accessible name is the full drill text (aria-label).
	const textbox = page.getByRole('textbox', { name: /The quick brown fox/ });
	await expect(textbox).toBeFocused();

	// Correct keystrokes → cursor advances, typed-correct states accumulate.
	await page.keyboard.type('The');
	await expect(page.locator('[data-state="typed-correct"]')).toHaveCount(3);
	await expect(page.locator('[data-state="current"]')).toHaveCount(1);
	await expect(page.getByText('Position:').getByText('3')).toBeVisible();

	// Wrong char at position 3 (expected space, typed 'x') → uncorrected error.
	await page.keyboard.type('x');
	await expect(page.locator('[data-state="typed-error"]')).toHaveCount(1);
	await expect(page.getByText('Errors:').getByText('1')).toBeVisible();

	// Backspace to position 3, then type the expected space → corrected error.
	await page.keyboard.press('Backspace');
	await page.keyboard.type(' ');
	await expect(page.locator('[data-state="typed-error-corrected"]')).toHaveCount(1);
	// Uncorrected error gone now that position 3 is corrected.
	await expect(page.locator('[data-state="typed-error"]')).toHaveCount(0);

	// Pacer: after a brief pause we should fall behind the target (60 WPM = 200ms/char).
	await page.waitForTimeout(2000);
	const pacer = page.getByRole('status', { name: 'Pace indicator' });
	await expect(pacer).toContainText(/behind/i);
	// Ghost marker has advanced into pending territory.
	await expect(page.locator('[data-ghost="true"]')).toHaveCount(1);

	// The error live region has no aria-label — distinguishes it from the Pacer.
	const live = page.locator('[role="status"][aria-live="polite"]:not([aria-label])');
	await expect(live).toHaveText('');

	// Opt in and fire one more error; live region should now populate.
	await page.getByLabel('Announce errors (SR)').check();
	await textbox.focus();
	await page.keyboard.press('z'); // pos 4 expected 'q'
	await expect(live).toContainText(/Expected q, typed z/);
});
