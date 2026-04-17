import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end coverage for all three session types (Phase 6+):
 *   diagnostic → drill → real-text
 *
 * Uses the dashboard override row rather than the planner-built plan
 * cards: after a first diagnostic, *what* cards appear in the plan
 * depends on classifier output, and Playwright types fast+clean enough
 * that all bigrams land `healthy` — yielding a plan of only real-text
 * cards. The override row is the stable path that always offers all
 * three session kinds, which is exactly what this smoke test wants.
 *
 * Per session we: visit the route, read the live passage off the
 * typing surface's `aria-label`, type it, and assert the runner
 * redirects to a per-session summary. Same trick the walking-skeleton
 * test uses — keeps the assertion independent of sampler changes.
 */

async function typeCurrentPassage(page: Page): Promise<void> {
	const textbox = page.getByRole('textbox');
	await expect(textbox).toBeVisible();
	await expect(textbox).toBeFocused();

	const passage = (await textbox.getAttribute('aria-label')) ?? '';
	expect(passage.length).toBeGreaterThan(0);

	await page.keyboard.type(passage);
	await page.waitForURL(/\/session\/[^/]+\/summary$/);
	await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
}

test(
	'diagnostic → drill → real-text: each session type persists through the runner',
	{
		// Diagnostic passage is ~1000 chars; keyboard.type plus nav and
		// Dexie writes across three sessions needs more than the 30s
		// Playwright default.
		annotation: { type: 'slow', description: 'types three passages end-to-end' }
	},
	async ({ page }) => {
		// Diagnostic: kicks off the session graph. Subsequent dashboard
		// loads rehydrate the diagnostic report from persisted raw
		// events, which is what unlocks the planner's non-first-run
		// branches — but for this test we use overrides, so we only
		// need the diagnostic to land on the summary without crashing.
		await page.goto('/session/diagnostic');
		await typeCurrentPassage(page);

		// Drill: override link is always present on the dashboard and
		// routes straight to the bigram-drill session. Without a
		// dashboard hand-off, the route falls back to a small set of
		// common English target bigrams — enough to generate a valid
		// drill passage for the runner to consume.
		await page.goto('/');
		await page.getByTestId('override-drill').click();
		await expect(page).toHaveURL(/\/session\/bigram-drill$/);
		await typeCurrentPassage(page);

		// Real-text: same shape via the real-text override.
		await page.goto('/');
		await page.getByTestId('override-realtext').click();
		await expect(page).toHaveURL(/\/session\/real-text$/);
		await typeCurrentPassage(page);
	}
);
