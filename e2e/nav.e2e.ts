import { expect, test } from '@playwright/test';

test('dashboard renders and nav links route correctly', async ({ page }) => {
	await page.goto('/');
	// The landing is CTA-first, not a generic "Dashboard" header. Asserting
	// on the Start Diagnostic CTA is a more meaningful shape check than
	// pinning the h1 text anyway.
	await expect(page.getByTestId('start-diagnostic')).toBeVisible();

	// Two drill overrides now — accuracy and speed live on separate routes.
	await page.getByTestId('override-accuracy-drill').click();
	await expect(page).toHaveURL(/\/session\/accuracy-drill$/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Accuracy drill');

	await page.goto('/');
	await page.getByTestId('override-speed-drill').click();
	await expect(page).toHaveURL(/\/session\/speed-drill$/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Speed drill');
});
