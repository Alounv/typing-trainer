import { expect, test, type Page } from '@playwright/test';

/**
 * Drill-mix UI: verifies that the priority/exposure split from the planner
 * surfaces correctly on both the dashboard card and the in-session header —
 * the "explicit to the user" requirement.
 *
 * Seeds `sessionStorage` with a crafted `PlannedSession` rather than running
 * a full diagnostic, because (a) we need a deterministic mix and (b) the
 * diagnostic's classifier lands all Playwright-typed bigrams as `healthy`,
 * producing an empty priority list with no exposure either. The drill
 * route's hand-off is the seam this test exploits.
 */

const HANDOFF_KEY = 'scheduler.pendingPlannedSession';

interface SeededMix {
	priority: string[];
	exposure: string[];
}

async function stashDrillPlan(page: Page, mix: SeededMix): Promise<void> {
	const planned = {
		config: {
			type: 'bigram-drill',
			wordBudget: 20,
			bigramsTargeted: [...mix.priority, ...mix.exposure]
		},
		reason: 'default-drill',
		label: 'Bigram drill',
		rationale: 'test',
		drillMix: mix
	};
	// sessionStorage is origin-scoped, so we must land on a page before writing.
	await page.goto('/');
	await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [
		HANDOFF_KEY,
		JSON.stringify(planned)
	] as const);
}

test('mixed drill: priority chips filled, exposure chips dashed, legend visible', async ({
	page
}) => {
	await stashDrillPlan(page, {
		priority: ['th', 'he'],
		exposure: ['an', 'in']
	});

	await page.goto('/session/bigram-drill');

	// Header copy flags the mixed nature — "flagged as weak" + "need more data".
	const what = page.getByText(/flagged as weak/i);
	await expect(what).toBeVisible();

	// Chips surface aria-labels per source — the semantic hook the UI uses to
	// carry the priority/exposure distinction to assistive tech.
	const drillList = page.getByRole('list', { name: 'Drill targets' });
	await expect(drillList.getByLabel('th, diagnosed weakness')).toBeVisible();
	await expect(drillList.getByLabel('he, diagnosed weakness')).toBeVisible();
	await expect(drillList.getByLabel('an, new bigram for exposure practice')).toBeVisible();
	await expect(drillList.getByLabel('in, new bigram for exposure practice')).toBeVisible();

	// Legend appears only in mixed cases; pin the copy so a refactor that
	// renames "new bigram" in one place and not the other breaks this test.
	await expect(page.getByText(/new bigram — not enough data yet/i)).toBeVisible();
});

test('exposure-only drill: exposure-only copy, no legend (no weakness chips to contrast)', async ({
	page
}) => {
	await stashDrillPlan(page, {
		priority: [],
		exposure: ['th', 'he', 'in']
	});

	await page.goto('/session/bigram-drill');

	// Exposure-only copy is distinct from the mixed copy: it has to admit
	// "not enough data yet" rather than claim "flagged as weak".
	await expect(
		page.getByText(/not enough data yet to diagnose specific weaknesses/i)
	).toBeVisible();

	const drillList = page.getByRole('list', { name: 'Drill targets' });
	// All three chips carry the exposure label.
	await expect(drillList.getByLabel('th, new bigram for exposure practice')).toBeVisible();
	await expect(drillList.getByLabel('he, new bigram for exposure practice')).toBeVisible();
	await expect(drillList.getByLabel('in, new bigram for exposure practice')).toBeVisible();
	// No priority chips exist, so no chip carries the "diagnosed weakness" label.
	await expect(drillList.getByLabel(/diagnosed weakness/)).toHaveCount(0);

	// Legend suppressed: it would claim two styles are on screen when only one is.
	// Targets the legend's "ab" sample specifically to avoid matching arbitrary prose.
	await expect(page.getByText(/diagnosed weakness ·/)).toHaveCount(0);
});
