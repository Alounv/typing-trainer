import { beforeEach, describe, expect, it } from 'vitest';
import { consumePlannedSession } from './index';
import type { PlannedSession } from './types';

function plan(type: 'diagnostic' | 'bigram-drill' | 'real-text'): PlannedSession {
	return {
		config: { type, wordBudget: 15, bigramsTargeted: ['th'] },
		label: 'Test'
	};
}

function stash(p: PlannedSession): void {
	sessionStorage.setItem('scheduler.pendingPlannedSession', JSON.stringify(p));
}

describe('consumePlannedSession', () => {
	beforeEach(() => {
		sessionStorage.clear();
	});

	it('returns the plan once, then clears the stash', () => {
		stash(plan('bigram-drill'));
		expect(consumePlannedSession()?.config.type).toBe('bigram-drill');
		expect(consumePlannedSession()).toBeUndefined();
	});

	it('returns undefined when the type guard does not match, but still clears', () => {
		stash(plan('bigram-drill'));
		expect(consumePlannedSession('real-text')).toBeUndefined();
		expect(consumePlannedSession()).toBeUndefined();
	});

	it('returns undefined when the stash is malformed', () => {
		sessionStorage.setItem('scheduler.pendingPlannedSession', 'not-json');
		expect(consumePlannedSession()).toBeUndefined();
	});
});
