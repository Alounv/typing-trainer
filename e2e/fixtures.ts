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

/** Complete one passage, so there is history for the next thing to read. */
export async function runSession(page: Page): Promise<void> {
	await page.goto('/session/real-text');
	await typeCurrentPassage(page);
}

/**
 * Several passages back to back. A single passage is ~125 chars, which is too
 * few bigrams for anything that needs a populated table; the diagnostic that
 * used to seed these tests was five times longer on its own.
 */
export async function runSessions(page: Page, count: number): Promise<void> {
	for (let i = 0; i < count; i++) await runSession(page);
}
