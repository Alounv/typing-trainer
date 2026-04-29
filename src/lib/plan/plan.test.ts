// `fake-indexeddb/auto` must come first — Dexie opens its connection at
// module-load time and we want it bound against the in-memory shim.
import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';
import { computePlan } from './index';
import { saveSessionFixture } from '../test-utils/fixtures';
import { saveProfile } from '../settings/profile';
import { clearAll } from '../support/storage/service';
import type { SessionSummary } from '../support/core';

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
	return {
		id: 's1',
		timestamp: Date.now(),
		type: 'bigram-drill',
		durationMs: 120_000,
		wpm: 40,
		errorRate: 0.05,
		bigramsTargeted: ['th'],
		bigramAggregates: [],
		...overrides
	};
}

describe('computePlan', () => {
	beforeEach(async () => {
		await clearAll();
	});

	it('returns a plan even with no prior sessions (cold start)', async () => {
		await saveProfile({ language: 'en' });
		const ctx = await computePlan();
		// Fresh user: plan should have at least one session to offer.
		expect(ctx.fullPlan.length).toBeGreaterThan(0);
		expect(ctx.lastSession).toBeUndefined();
		expect(ctx.allDoneForToday).toBe(false);
	});

	it('treats a session saved today as completed toward the plan', async () => {
		await saveProfile({ language: 'en' });
		await saveSessionFixture(makeSession({ id: 'just-now', timestamp: Date.now() }));
		const ctx = await computePlan();
		expect(ctx.lastSession?.id).toBe('just-now');
		const total = Object.values(ctx.completedToday).reduce((a, b) => a + (b ?? 0), 0);
		expect(total).toBeGreaterThan(0);
	});
});
