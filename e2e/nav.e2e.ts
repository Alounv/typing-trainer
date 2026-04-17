import { expect, test } from '@playwright/test';

test('dashboard renders and nav links route correctly', async ({ page }) => {
	await page.goto('/');
	// The landing is CTA-first, not a generic "Dashboard" header. Asserting
	// on the Start Diagnostic CTA is a more meaningful shape check than
	// pinning the h1 text anyway.
	await expect(page.getByTestId('start-diagnostic')).toBeVisible();

	await page.getByTestId('override-drill').click();
	await expect(page).toHaveURL(/\/session\/bigram-drill$/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bigram drill');
});
