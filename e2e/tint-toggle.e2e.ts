import { expect, test } from '@playwright/test';

/**
 * The tint toggle is the only in-session control, and the thing that would
 * quietly ruin it is focus: a click that pulls the caret out of the typing
 * input costs the user their session. Unit tests can't see that, so it is
 * asserted here alongside the state changes.
 */
test('tint toggle: switches mid-passage without taking focus off the text', async ({ page }) => {
	await page.goto('/session/real-text');

	const textbox = page.getByRole('textbox');
	await expect(textbox).toBeVisible();
	await expect(textbox).toBeFocused();

	// No history on a fresh profile, so there is no "too careful" verdict to
	// answer and the passage opens on the error-prone tint.
	const toggle = page.getByTestId('tint-toggle');
	await expect(toggle).toHaveAttribute('data-tint', 'errors');

	// Type into the passage first: the toggle has to survive being used
	// part-way through, not just before the session starts.
	const passage = (await textbox.getAttribute('aria-label')) ?? '';
	expect(passage.length).toBeGreaterThan(4);
	await page.keyboard.type(passage.slice(0, 4));

	await page.getByTestId('tint-speed').click();
	await expect(toggle).toHaveAttribute('data-tint', 'speed');
	await expect(textbox).toBeFocused();

	await page.getByTestId('tint-off').click();
	await expect(toggle).toHaveAttribute('data-tint', 'off');
	await expect(textbox).toBeFocused();

	// Typing still lands where it should, so the session can be finished.
	await page.keyboard.type(passage.slice(4));
	await page.waitForURL(/\/session\/[^/]+\/summary$/);
	await expect(page.getByTestId('pacing-verdict')).toBeVisible();
});
