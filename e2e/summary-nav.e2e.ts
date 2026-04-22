import { expect, test } from '@playwright/test';
import { runDiagnostic } from './fixtures';

/**
 * Summary page hand-off actions. After completing a session the summary offers
 * either a "Next session" button (plan still has items) or a "Day complete"
 * CTA plus "Start another round" (plan exhausted). A fresh user has a multi-
 * session plan, so after a single diagnostic we expect the "Next session" path.
 */

test('summary: Next session CTA routes to another session', async ({ page }) => {
	await runDiagnostic(page);

	const nextButton = page.getByTestId('next-session');
	await expect(nextButton).toBeVisible();

	await nextButton.click();
	await expect(page).toHaveURL(/\/session\/(accuracy-drill|speed-drill|real-text|diagnostic)$/);
	// The session route's textbox must be present — proves the hand-off stash
	// was consumed and the loader built a passage (not just that nav fired).
	await expect(page.getByRole('textbox')).toBeVisible();
});
