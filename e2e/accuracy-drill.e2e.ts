import { expect, test } from '@playwright/test';
import { runDiagnostic } from './fixtures';

/**
 * Accuracy drill feedback loop: mistyping a target bigram damages its chip and
 * pushes the debt meter into the red; later clean occurrences of the same
 * bigram pay repeats back and the meter climbs again.
 */
test(
	'accuracy drill: a mistyped bigram is damaged, then partly repaid',
	{ annotation: { type: 'slow', description: 'diagnostic pass + accuracy-drill pass end-to-end' } },
	async ({ page }) => {
		await runDiagnostic(page);

		await page.goto('/');
		await page.getByTestId('override-accuracy-drill').click();
		await expect(page).toHaveURL(/\/session\/accuracy-drill$/);

		const textbox = page.getByRole('textbox');
		await expect(textbox).toBeVisible();
		await expect(textbox).toBeFocused();
		const passage = (await textbox.getAttribute('aria-label')) ?? '';
		expect(passage.length).toBeGreaterThan(0);

		const chips = page.getByTestId('drill-chip');
		await expect(chips.first()).toBeVisible();
		const targets = await chips.evaluateAll((els) =>
			els.map((el) => el.getAttribute('data-bigram') ?? '')
		);

		// Pick a target that occurs at least three times: one to break, two to repay.
		const target = targets.find((b) => passage.split(b).length - 1 >= 3);
		expect(target, 'drill text should repeat some target at least three times').toBeTruthy();
		const chip = page.locator(`[data-testid="drill-chip"][data-bigram="${target}"]`);

		const occurrences: number[] = [];
		for (let i = passage.indexOf(target!); i !== -1; i = passage.indexOf(target!, i + 1)) {
			occurrences.push(i);
		}

		// Type up to (and including) the first char of the target, then miss the second.
		const start = occurrences[0];
		await page.keyboard.type(passage.slice(0, start + 1));
		await page.keyboard.type(target![1] === 'z' ? 'q' : 'z');

		await expect(chip).toHaveAttribute('data-state', 'damaged');
		const meter = page.getByTestId('debt-change');
		await expect(meter).toBeVisible();
		// The mistake added debt the drill has not paid back — the meter is red.
		const afterMistake = Number(await meter.getAttribute('aria-valuenow'));
		expect(afterMistake).toBeLessThan(0);

		// Correct the miss, then type through two more clean occurrences: each one
		// pays a repeat back, so the meter climbs even though the chip still owes.
		await page.keyboard.press('Backspace');
		const repaid = occurrences[2] + 2;
		await page.keyboard.type(passage.slice(start + 1, repaid));
		await expect
			.poll(async () => Number(await meter.getAttribute('aria-valuenow')))
			.toBeGreaterThan(afterMistake);

		await page.keyboard.type(passage.slice(repaid));
		await page.waitForURL(/\/session\/[^/]+\/summary$/);
		await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
	}
);
