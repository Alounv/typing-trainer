import { expect, test } from '@playwright/test';
import { runDiagnostic } from './fixtures';

/**
 * Accuracy drill feedback loop: mistyping a target bigram damages its chip and
 * slides the finish line out; later clean occurrences of the same bigram walk
 * progress towards it. Progress itself never goes backwards.
 */
test(
	'accuracy drill: a mistake moves the finish line, clean repeats close on it',
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
		// The mistake asks for repeats the drill wasn't asking for before, and
		// takes nothing away: progress is still zero, not negative.
		const track = page.getByTestId('debt-progress');
		await expect(track).toBeVisible();
		await expect(track).toHaveAttribute('data-paid', '0');
		const asked = Number(await track.getAttribute('data-target'));
		expect(asked).toBeGreaterThan(0);

		// Correct the miss, then type through two more clean occurrences: each one
		// walks progress towards a finish line that stays where it was put.
		await page.keyboard.press('Backspace');
		const repaidAt = occurrences[2] + 2;
		await page.keyboard.type(passage.slice(start + 1, repaidAt));
		await expect.poll(async () => Number(await track.getAttribute('data-paid'))).toBe(2);
		await expect(track).toHaveAttribute('data-target', String(asked));

		await page.keyboard.type(passage.slice(repaidAt));
		await page.waitForURL(/\/session\/[^/]+\/summary$/);
		await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
	}
);
