import { expect, test } from '@playwright/test';

/**
 * Data import flow regression.
 *
 * The component path stores the parsed payload in `$state()`, which deeply
 * proxies the object for reactivity. Passing that proxy straight to Dexie
 * (and thus to IndexedDB's structured-clone) throws `DataCloneError`. The
 * fix is `$state.snapshot(pendingImport)` at the write boundary; this test
 * guards against someone removing it. Unit tests on `importAll` can't catch
 * the bug because the proxy only exists in a live Svelte component.
 *
 * The payload is small but realistic: one session with one mirrored bigram
 * record plus a profile singleton, exercising every table we write to.
 */

test('data import: a valid export round-trips through the UI without DataCloneError', async ({
	page
}) => {
	const payload = {
		app: 'typing-trainer',
		schemaVersion: 1,
		exportedAt: Date.now(),
		data: {
			sessions: [
				{
					id: 'e2e-import-1',
					timestamp: 1_700_000_000_000,
					type: 'bigram-drill',
					durationMs: 60_000,
					wpm: 65,
					errorRate: 0.02,
					bigramsTargeted: ['th'],
					bigramAggregates: [
						{
							bigram: 'th',
							sessionId: 'e2e-import-1',
							occurrences: 10,
							meanTime: 140,
							stdTime: 20,
							errorCount: 0,
							errorRate: 0,
							classification: 'healthy'
						}
					]
				}
			],
			bigramRecords: [
				{
					key: 'th::e2e-import-1',
					bigram: 'th',
					sessionId: 'e2e-import-1',
					occurrences: 10,
					meanTime: 140,
					stdTime: 20,
					errorCount: 0,
					errorRate: 0,
					classification: 'healthy'
				}
			],
			profile: { id: 'default', settings: { languages: ['en'], corpusIds: ['en'] } }
		}
	};

	await page.goto('/settings');
	await expect(page.getByTestId('data-import')).toBeVisible();

	// The file input is `display: none` — Playwright's setInputFiles works on
	// hidden inputs, which is exactly the shape the component relies on.
	await page.getByTestId('data-import-file').setInputFiles({
		name: 'regression-import.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(payload))
	});

	// Modal opens with counts populated from the payload.
	const modal = page.getByTestId('data-import-confirm');
	await expect(modal).toHaveAttribute('open', '');
	await expect(modal).toContainText('Sessions');
	await expect(modal).toContainText('Bigram records');

	await page.getByTestId('data-import-confirm-button').click();

	// Success reads "Import complete. Reloading…" for ~400 ms before the
	// component hard-reloads the page. A DataCloneError on the write path
	// would instead flip status to an [role=alert] error, which we fail on.
	await expect(page.getByText(/Import complete/i)).toBeVisible({ timeout: 1500 });
});
