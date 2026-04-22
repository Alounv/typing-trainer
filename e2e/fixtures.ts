import { expect, type Page } from '@playwright/test';

/**
 * Type through the current session route's passage end-to-end. Reads the
 * target from the textbox's aria-label (the sampler stamps it there) so the
 * helper is robust to corpus + seed changes.
 */
export async function typeCurrentPassage(page: Page): Promise<void> {
	const textbox = page.getByRole('textbox');
	await expect(textbox).toBeVisible();
	await expect(textbox).toBeFocused();
	const passage = (await textbox.getAttribute('aria-label')) ?? '';
	expect(passage.length).toBeGreaterThan(0);
	await page.keyboard.type(passage);
	await page.waitForURL(/\/session\/[^/]+\/summary$/);
	await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
}

/** Complete one diagnostic session. Used to seed baseline WPM + bigram data. */
export async function runDiagnostic(page: Page): Promise<void> {
	await page.goto('/session/diagnostic');
	await typeCurrentPassage(page);
}
