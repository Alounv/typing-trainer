import { beforeEach, describe, expect, it } from 'vitest';
import { stashPlannedSession, consumePlannedSession } from './handoff';
import type { PlannedSession } from './types';

/**
 * Minimal fixture. The hand-off just round-trips JSON; it doesn't
 * inspect fields beyond `config.type`, so we only fill in what that
 * check needs plus a distinguishing target bigram.
 */
function plan(type: 'diagnostic' | 'bigram-drill' | 'real-text'): PlannedSession {
	return {
		config: { type, wordBudget: 15, bigramsTargeted: ['th'] },
		reason: 'default-drill',
		label: 'Test'
	};
}

/**
 * sessionStorage is shared across tests — wipe between cases so a
 * stale stash can't leak into the next test.
 */
beforeEach(() => {
	sessionStorage.clear();
});

describe('stash + consume round-trip', () => {
	it('consume returns the plan that was stashed', () => {
		stashPlannedSession(plan('bigram-drill'));
		const got = consumePlannedSession();
		expect(got?.config.type).toBe('bigram-drill');
	});

	it('consume clears the stash (single-use)', () => {
		stashPlannedSession(plan('real-text'));
		consumePlannedSession();
		expect(consumePlannedSession()).toBeUndefined();
	});

	it('no stash → consume returns undefined', () => {
		expect(consumePlannedSession()).toBeUndefined();
	});
});

describe('expectedType guard', () => {
	it('returns the plan when types match', () => {
		stashPlannedSession(plan('bigram-drill'));
		expect(consumePlannedSession('bigram-drill')?.config.type).toBe('bigram-drill');
	});

	it('returns undefined when types mismatch', () => {
		stashPlannedSession(plan('bigram-drill'));
		expect(consumePlannedSession('real-text')).toBeUndefined();
	});

	it('mismatched read still clears the stash', () => {
		// Spec: consume is single-use regardless of type-guard outcome,
		// so a cross-route nav doesn't leave stale plans behind.
		stashPlannedSession(plan('bigram-drill'));
		consumePlannedSession('real-text');
		expect(consumePlannedSession()).toBeUndefined();
	});
});

describe('corrupt stash', () => {
	it('malformed JSON → undefined, storage cleared', () => {
		sessionStorage.setItem('scheduler.pendingPlannedSession', 'not-json');
		expect(consumePlannedSession()).toBeUndefined();
		expect(sessionStorage.getItem('scheduler.pendingPlannedSession')).toBeNull();
	});
});
