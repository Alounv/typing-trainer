import { describe, expect, it } from 'vitest';
import {
	annotateFirstInputs,
	assessPacing,
	computeAllBigramDebts,
	buildLivePriorityTargets,
	buildLiveUndertrained,
	computeBigramDebts,
	decodeStream,
	encodeStream,
	extractBigramAggregates,
	generateDiagnosticReport,
	hydrateSession,
	summarizeBigrams,
	type AnnotatedKeystrokeEvent,
	type PacingInput,
	type PacingVerdict
} from './index';
import {
	BIGRAM_CLASSIFICATION_WINDOW,
	DEFAULT_THRESHOLDS,
	ERROR_TIME_BUDGET_MS,
	MIN_OCCURRENCES_FOR_CLASSIFICATION,
	PACING_COMPARISON_WINDOW
} from '../support/core';
import type {
	BigramAggregate,
	BigramClassification,
	BigramSample,
	KeystrokeEvent,
	SessionSummary,
	StoredSession
} from '../support/core';

/**
 * Annotated by construction — `extractBigramAggregates` takes first-input
 * events, and a lone keystroke is trivially the first input at its position.
 * Tests that care about burst semantics build raw events and run them through
 * `annotateFirstInputs` themselves.
 */
function ev(
	position: number,
	expected: string,
	actual: string,
	timestamp: number
): AnnotatedKeystrokeEvent {
	return {
		position,
		expected,
		actual,
		timestamp,
		wordIndex: 0,
		positionInWord: position,
		corrected: false,
		correctionDelay: 0,
		burstFollowUp: false
	};
}

function agg(
	bigram: string,
	sessionId: string,
	overrides: Partial<BigramAggregate> = {}
): BigramAggregate {
	return {
		bigram,
		sessionId,
		occurrences: 15,
		meanTime: 200,
		stdTime: 30,
		errorCount: 0,
		errorRate: 0,
		classification: 'healthy' as BigramClassification,
		...overrides
	};
}

function cleanSamples(n: number, timing: number): BigramSample[] {
	return Array.from({ length: n }, () => ({ correct: true, timing }));
}

function session(
	id: string,
	timestamp: number,
	aggregates: BigramAggregate[] = []
): SessionSummary {
	return {
		id,
		timestamp,
		type: 'real-text',
		durationMs: 60_000,
		wpm: 50,
		errorRate: 0,
		bigramAggregates: aggregates
	};
}

// Single session with one struggling acquisition bigram ('th') and one healthy
// one ('er'). Used by priority-ordering tests that need a clear winner.
function acquisitionVsHealthyFixture(): SessionSummary[] {
	return [
		session('s1', 100, [
			agg('th', 's1', {
				meanTime: 400,
				errorRate: 0.2,
				classification: 'acquisition',
				samples: Array.from({ length: 20 }, () => ({ correct: false, timing: 400 }))
			}),
			agg('er', 's1', {
				meanTime: 120,
				errorRate: 0,
				classification: 'healthy',
				samples: cleanSamples(20, 120)
			})
		])
	];
}

describe('extractBigramAggregates', () => {
	it('returns empty for < 2 events', () => {
		expect(extractBigramAggregates([], 's1')).toEqual([]);
		expect(extractBigramAggregates([ev(0, 'a', 'a', 0)], 's1')).toEqual([]);
	});

	it('averages timing only across clean pairs; errors attributed to right char', () => {
		// "th" clean (Δ=100), "th" with wrong 't' (Δ ignored, error counted).
		const result = extractBigramAggregates(
			[ev(0, 't', 't', 100), ev(1, 'h', 'h', 200), ev(2, 't', 'x', 300), ev(3, 'h', 'h', 400)],
			's1'
		);
		const th = result.find((r) => r.bigram === 'th')!;
		expect(th.occurrences).toBe(2);
		expect(th.meanTime).toBe(100);
		expect(th.errorCount).toBe(0); // right char ('h') was always correct
	});

	describe('burst follow-ups', () => {
		// Pipeline test: raw events → annotateFirstInputs → extractBigramAggregates.
		// Only the first wrong key in a run should produce a bigram error sample;
		// subsequent wrongs are dropped entirely (no occurrence, no error).
		it('drops follow-up wrongs in a burst from bigram stats', () => {
			// Expected "hello"; user typed "hxyzlo". Positions 1,2,3 wrong in a row.
			const raw: KeystrokeEvent[] = [
				ev(0, 'h', 'h', 0),
				ev(1, 'e', 'x', 100),
				ev(2, 'l', 'y', 200),
				ev(3, 'l', 'z', 300),
				ev(4, 'o', 'o', 400)
			];
			const result = extractBigramAggregates(annotateFirstInputs(raw), 's1');

			// "he": right (e) wrong, first in burst → kept as 1 occurrence, 1 error.
			const he = result.find((r) => r.bigram === 'he')!;
			expect(he.occurrences).toBe(1);
			expect(he.errorCount).toBe(1);

			// "el" and "ll": right chars (l, l) are burst follow-ups → fully dropped.
			expect(result.find((r) => r.bigram === 'el')).toBeUndefined();
			expect(result.find((r) => r.bigram === 'll')).toBeUndefined();

			// "lo": right (o) is correct, not in burst → kept (1 occurrence, 0 error).
			// Left (l) wrong so timing is null but the occurrence still counts.
			const lo = result.find((r) => r.bigram === 'lo')!;
			expect(lo.occurrences).toBe(1);
			expect(lo.errorCount).toBe(0);
		});

		it('non-consecutive wrongs are not bursts', () => {
			// "abcde" typed "axcye": wrongs at positions 1 and 3, separated by a correct 'c'.
			const raw: KeystrokeEvent[] = [
				ev(0, 'a', 'a', 0),
				ev(1, 'b', 'x', 100),
				ev(2, 'c', 'c', 200),
				ev(3, 'd', 'y', 300),
				ev(4, 'e', 'e', 400)
			];
			const result = extractBigramAggregates(annotateFirstInputs(raw), 's1');

			// Both 'b' and 'd' wrongs should produce errors against their right-char bigrams.
			expect(result.find((r) => r.bigram === 'ab')!.errorCount).toBe(1);
			expect(result.find((r) => r.bigram === 'cd')!.errorCount).toBe(1);
		});
	});

	it('classifies with enough occurrences and clean timing', () => {
		// Feed 10 clean "th" pairs fast enough to be healthy.
		const events: AnnotatedKeystrokeEvent[] = [];
		for (let i = 0; i < 10; i++) {
			events.push(ev(i * 2, 't', 't', i * 1000));
			events.push(ev(i * 2 + 1, 'h', 'h', i * 1000 + 50));
		}
		const [th] = extractBigramAggregates(events, 's1');
		expect(th.bigram).toBe('th');
		expect(th.classification).toBe('healthy');
	});
});

describe('generateDiagnosticReport', () => {
	it('derives baseline WPM from wall-clock event span', () => {
		// 61 distinct positions spanning 0 to 60_000ms → 61/5/(60/60) ≈ 12.2 WPM.
		const events: KeystrokeEvent[] = [];
		for (let i = 0; i < 61; i++) events.push(ev(i, 'a', 'a', i * 1000));
		const report = generateDiagnosticReport({ events });
		expect(report.baselineWPM).toBeCloseTo(12.2, 1);
	});

	it('returns 0 baseline for degenerate inputs', () => {
		expect(generateDiagnosticReport({ events: [] }).baselineWPM).toBe(0);
		expect(generateDiagnosticReport({ events: [ev(0, 'a', 'a', 0)] }).baselineWPM).toBe(0);
	});
});

describe('summarizeBigrams', () => {
	it('uses the rolling window for classification and lifetime sum for occurrences', () => {
		const sessions = [
			session('s1', 100, [
				agg('th', 's1', {
					classification: 'hasty',
					occurrences: 12,
					errorRate: 0.15,
					samples: cleanSamples(12, 100)
				})
			]),
			session('s2', 200, [
				agg('th', 's2', {
					classification: 'healthy',
					occurrences: 20,
					errorRate: 0,
					samples: cleanSamples(20, 100)
				})
			])
		];
		const rows = summarizeBigrams(sessions, undefined, DEFAULT_THRESHOLDS);
		const th = rows.find((r) => r.bigram === 'th')!;
		expect(th.classification).toBe('healthy');
		expect(th.occurrences).toBe(32);
	});

	it('sorts by priority score (time lost × corpus frequency) descending', () => {
		const rows = summarizeBigrams(
			acquisitionVsHealthyFixture(),
			{ th: 10, er: 10 },
			DEFAULT_THRESHOLDS
		);
		expect(rows[0].bigram).toBe('th');
	});

	it('charges errors at the declared time budget when nothing was timed', () => {
		// All samples wrong → no timings at all → loss is purely the error budget,
		// scaled by the confidence factor n/(n+10) = 20/30.
		const sessions = [
			session('s1', 100, [
				agg('th', 's1', {
					errorRate: 1,
					samples: Array.from({ length: 20 }, () => ({ correct: false, timing: null }))
				})
			])
		];
		const th = summarizeBigrams(sessions, undefined, DEFAULT_THRESHOLDS)[0];
		expect(th.timeLossMs).toBeCloseTo(ERROR_TIME_BUDGET_MS * (20 / 30), 5);
	});

	/** Three filler bigrams at a steady pace, so the pooled median (the baseline)
	 *  stays put no matter how many samples the bigram under test contributes. */
	function withBaseline(...extra: BigramAggregate[]): SessionSummary[] {
		return [
			session('s1', 100, [
				agg('b1', 's1', { occurrences: 20, samples: cleanSamples(20, 100) }),
				agg('b2', 's1', { occurrences: 20, samples: cleanSamples(20, 100) }),
				agg('b3', 's1', { occurrences: 20, samples: cleanSamples(20, 100) }),
				...extra
			])
		];
	}

	it.each([{ n: 2 }, { n: 6 }, { n: 20 }])(
		'scales the reported cost with confidence at $n samples',
		({ n }) => {
			const rows = summarizeBigrams(
				withBaseline(agg('xx', 's1', { occurrences: n, samples: cleanSamples(n, 800) })),
				undefined,
				DEFAULT_THRESHOLDS
			);
			const xx = rows.find((r) => r.bigram === 'xx')!;
			// Identical 800ms timings throughout; only the evidence differs.
			expect(xx.timeLossMs).toBeCloseTo(700 * (n / (n + 10)), 5);
		}
	);

	it('keeps a two-sample outlier below a well-observed weakness', () => {
		// The accuracy drill deliberately requests `unclassified` targets, so a pair
		// seen twice must not outrank a bigram that is reliably mediocre.
		const rows = summarizeBigrams(
			withBaseline(
				agg('xx', 's1', { occurrences: 2, samples: cleanSamples(2, 800) }),
				agg('yy', 's1', { occurrences: 20, samples: cleanSamples(20, 300) })
			),
			{ xx: 0.01, yy: 0.01 },
			DEFAULT_THRESHOLDS
		);
		const xx = rows.find((r) => r.bigram === 'xx')!;
		const yy = rows.find((r) => r.bigram === 'yy')!;
		expect(yy.priorityScore).toBeGreaterThan(xx.priorityScore);
	});

	it('prices a slow tail that the mean hides', () => {
		// 'sp' is fast 18 times out of 20 and very slow twice. Its mean (137ms) sits
		// below the pooled median, so `max(0, mean - baseline)` would score it zero —
		// averaging the per-sample excess must not.
		const sessions = [
			session('s1', 100, [
				agg('sp', 's1', {
					samples: [...cleanSamples(18, 80), ...cleanSamples(2, 650)]
				}),
				agg('ok', 's1', { samples: cleanSamples(20, 120) })
			])
		];
		const rows = summarizeBigrams(sessions, undefined, DEFAULT_THRESHOLDS);
		const sp = rows.find((r) => r.bigram === 'sp')!;
		const ok = rows.find((r) => r.bigram === 'ok')!;
		expect(sp.meanTime).toBeLessThan(150);
		expect(sp.timeLossMs).toBeGreaterThan(0);
		expect(sp.timeLossMs).toBeGreaterThan(ok.timeLossMs);
	});

	it('dampens frequency so severity is not drowned out by volume', () => {
		// 'rare' loses ~10x more time per occurrence; 'common' is 25x more frequent.
		// Under linear frequency volume wins; under the square root severity does.
		const sessions = [
			session('s1', 100, [
				agg('xq', 's1', { samples: cleanSamples(20, 700) }),
				agg('es', 's1', { samples: cleanSamples(20, 130) })
			])
		];
		const rows = summarizeBigrams(sessions, { xq: 0.001, es: 0.025 }, DEFAULT_THRESHOLDS);
		expect(rows[0].bigram).toBe('xq');
		// Frequency is reported untransformed so the table can show the real share.
		expect(rows.find((r) => r.bigram === 'es')!.frequency).toBe(0.025);
	});

	it('keeps a measured cost on healthy bigrams instead of zeroing it', () => {
		const rows = summarizeBigrams(
			acquisitionVsHealthyFixture(),
			{ th: 10, er: 10 },
			DEFAULT_THRESHOLDS
		);
		const er = rows.find((r) => r.bigram === 'er')!;
		expect(er.classification).toBe('healthy');
		expect(er.timeLossMs).toBeGreaterThanOrEqual(0);
		// ...but drill selection still filters it out.
		expect(
			buildLivePriorityTargets(acquisitionVsHealthyFixture(), { th: 10, er: 10 }).map(
				(t) => t.bigram
			)
		).toEqual(['th']);
	});
});

describe('buildLivePriorityTargets', () => {
	it('excludes healthy and unclassified bigrams', () => {
		const targets = buildLivePriorityTargets(acquisitionVsHealthyFixture(), { th: 10, er: 10 });
		expect(targets.map((t) => t.bigram)).toEqual(['th']);
	});

	it('scopes by classification filter when supplied', () => {
		const sessions = [
			session('s1', 100, [
				agg('th', 's1', {
					meanTime: 100,
					errorRate: 0.2,
					classification: 'hasty',
					samples: Array.from({ length: 20 }, () => ({ correct: false, timing: 100 }))
				}),
				agg('er', 's1', {
					meanTime: 400,
					errorRate: 0,
					classification: 'fluency',
					samples: cleanSamples(20, 400)
				})
			])
		];
		const accuracyTargets = buildLivePriorityTargets(
			sessions,
			{ th: 10, er: 10 },
			undefined,
			undefined,
			['hasty', 'acquisition']
		);
		expect(accuracyTargets.map((t) => t.bigram)).toEqual(['th']);
	});
});

describe('buildLiveUndertrained', () => {
	it('returns corpus bigrams with fewer than the minimum lifetime occurrences', () => {
		// th has 5 occurrences (< 10); er has 20 (≥ 10); zz has 0.
		const sessions = [
			session('s1', 100, [
				agg('th', 's1', { occurrences: 5 }),
				agg('er', 's1', { occurrences: 20 })
			])
		];
		const under = buildLiveUndertrained(sessions, { th: 10, er: 8, zz: 1 });
		// Sorted by frequency desc: th (10) > zz (1). er is well-trained.
		expect(under).toEqual(['th', 'zz']);
	});

	it('returns empty when no corpus is supplied', () => {
		expect(buildLiveUndertrained([], undefined)).toEqual([]);
	});
});

describe('computeBigramDebts', () => {
	/** `samples` reads oldest-first, matching how a session records them. */
	function withSamples(bigram: string, pattern: string): SessionSummary[] {
		const samples: BigramSample[] = [...pattern].map((c) => ({
			correct: c !== 'x',
			timing: c === 'x' ? null : 100
		}));
		return [session('s1', 100, [agg(bigram, 's1', { samples })])];
	}

	it('owes nothing for a bigram with a clean window', () => {
		const debts = computeBigramDebts(withSamples('th', '.'.repeat(20)), ['th']);
		expect(debts.get('th')).toBe(0);
	});

	it('owes nothing for a bigram with no history at all', () => {
		expect(computeBigramDebts([], ['th']).get('th')).toBe(0);
	});

	it('owes a full window when the newest sample is the error', () => {
		const debts = computeBigramDebts(withSamples('th', '.'.repeat(19) + 'x'), ['th']);
		expect(debts.get('th')).toBe(BIGRAM_CLASSIFICATION_WINDOW);
	});

	it('owes one repeat when the error is about to age out', () => {
		const debts = computeBigramDebts(withSamples('th', 'x' + '.'.repeat(19)), ['th']);
		expect(debts.get('th')).toBe(1);
	});

	it('is set by the newest error, not by how many errors there are', () => {
		// Two errors; the newer one is the sixth-newest sample, so it takes 15
		// more clean repeats to push it out of a twenty-sample window.
		const debts = computeBigramDebts(withSamples('th', 'x' + '.'.repeat(13) + 'x' + '.....'), [
			'th'
		]);
		expect(debts.get('th')).toBe(15);
	});

	it('pools the window across sessions, newest first', () => {
		const sessions = [
			session('old', 100, [agg('th', 'old', { samples: [{ correct: false, timing: null }] })]),
			session('new', 200, [agg('th', 'new', { samples: cleanSamples(19, 100) })])
		];
		// 19 clean on top of the old error: one more repeat pushes it out.
		expect(computeBigramDebts(sessions, ['th']).get('th')).toBe(1);
	});
});

describe('computeAllBigramDebts', () => {
	it('discovers its own universe from history and drops what is settled', () => {
		// No bigram list to pass: the whole point is that the caller does not
		// have to know which pairs exist. Settled pairs are dropped so the map
		// holds only what is actually owed.
		const sessions = [
			session('s1', 100, [
				agg('th', 's1', { samples: cleanSamples(20, 100) }),
				agg('er', 's1', { samples: [...cleanSamples(19, 100), { correct: false, timing: null }] })
			])
		];

		const debts = computeAllBigramDebts(sessions);
		expect([...debts.keys()]).toEqual(['er']);
		expect(debts.get('er')).toBe(BIGRAM_CLASSIFICATION_WINDOW);
	});

	it('returns an empty map with no history', () => {
		expect(computeAllBigramDebts([]).size).toBe(0);
	});
});

describe('keystroke stream codec', () => {
	const TEXT = 'the cat';
	/** Word coordinates for `TEXT`, written out so the round-trip isn't self-confirming. */
	const COORDS: readonly [number, number][] = [
		[0, 0],
		[0, 1],
		[0, 2],
		[0, 3],
		[1, 0],
		[1, 1],
		[1, 2]
	];

	function stroke(position: number, actual: string, timestamp: number): KeystrokeEvent {
		const [wordIndex, positionInWord] = COORDS[position];
		return { position, actual, expected: TEXT[position], timestamp, wordIndex, positionInWord };
	}

	/** `TEXT` typed correctly, 100ms per key. */
	function cleanRun(): KeystrokeEvent[] {
		return [...TEXT].map((ch, i) => stroke(i, ch, i * 100));
	}

	it('round-trips a clean run, coordinates and all', () => {
		const raw = cleanRun();
		expect(decodeStream(encodeStream(raw), TEXT)).toEqual(raw);
	});

	it('round-trips a mistake and the retype at the same position', () => {
		// Position 4 typed twice — the second entry is a zero position delta.
		const raw = [
			stroke(0, 't', 0),
			stroke(1, 'h', 100),
			stroke(2, 'e', 200),
			stroke(3, ' ', 300),
			stroke(4, 'x', 400),
			stroke(4, 'c', 900),
			stroke(5, 'a', 1000),
			stroke(6, 't', 1100)
		];
		expect(decodeStream(encodeStream(raw), TEXT)).toEqual(raw);
	});

	it('round-trips a backspace that walks the cursor back a word', () => {
		const raw = [...cleanRun(), stroke(4, 'c', 800), stroke(5, 'a', 900), stroke(6, 't', 1000)];
		expect(decodeStream(encodeStream(raw), TEXT)).toEqual(raw);
	});

	it('rounds timestamps to whole ms, without accumulating the error', () => {
		const raw = [stroke(0, 't', 0.4), stroke(1, 'h', 100.4), stroke(2, 'e', 200.4)];
		// Each delta rounds to 100 rather than drifting 0.4ms per keystroke.
		expect(decodeStream(encodeStream(raw), TEXT).map((e) => e.timestamp)).toEqual([0, 100, 200]);
	});

	it.each([
		[
			'a short times column',
			{ positions: Int16Array.from([0, 1]), times: Uint32Array.from([0]), typed: 'th' }
		],
		[
			'a short typed column',
			{ positions: Int16Array.from([0, 1]), times: Uint32Array.from([0, 100]), typed: 't' }
		],
		[
			'a position past the end of the text',
			{ positions: Int16Array.from([99]), times: Uint32Array.from([0]), typed: 't' }
		],
		[
			'a position before the start of the text',
			{ positions: Int16Array.from([-1]), times: Uint32Array.from([0]), typed: 't' }
		]
	])('throws on %s', (_label, stream) => {
		expect(() => decodeStream(stream, TEXT)).toThrow(/Corrupt keystroke stream/);
	});
});

describe('hydrateSession', () => {
	function row(overrides: Partial<StoredSession> = {}): StoredSession {
		return {
			id: 'sess',
			timestamp: 1_000,
			type: 'real-text',
			durationMs: 60_000,
			wpm: 50,
			errorRate: 0,
			...overrides
		};
	}

	/** `n` clean "th " repeats typed at `gapMs` per keystroke. */
	function repeatedTh(n: number, gapMs: number) {
		const text = 'th '.repeat(n);
		const events: KeystrokeEvent[] = [...text].map((ch, i) => ({
			position: i,
			expected: ch,
			actual: ch,
			timestamp: i * gapMs,
			wordIndex: Math.floor(i / 3),
			positionInWord: i % 3
		}));
		return { text, events };
	}

	it('measures the same bigrams the live pipeline would', () => {
		// Includes a mistake, its retype, and a fumble run — the three cases
		// where replay could plausibly diverge from live capture.
		const text = 'the cat sat';
		const typed = [
			[0, 't'],
			[1, 'h'],
			[2, 'e'],
			[3, ' '],
			[4, 'x'],
			[5, 'y'],
			[6, 't'],
			[4, 'c'],
			[7, ' '],
			[8, 's'],
			[9, 'a'],
			[10, 't']
		] as const;
		const raw: KeystrokeEvent[] = typed.map(([position, actual], i) => ({
			position,
			actual,
			expected: text[position],
			timestamp: i * 120,
			wordIndex: Math.floor(position / 4),
			positionInWord: position % 4
		}));

		const live = extractBigramAggregates(annotateFirstInputs(raw), 'sess');
		const hydrated = hydrateSession(row({ text, stream: encodeStream(raw) })).bigramAggregates;

		expect(live.length).toBeGreaterThan(0); // else the comparison proves nothing
		expect(hydrated).toEqual(live);
	});

	it('re-scores a stored session under changed thresholds', () => {
		// 10 clean "th" repeats at 150ms — fast under a 200ms bar, slow under 100ms.
		const { text, events } = repeatedTh(MIN_OCCURRENCES_FOR_CLASSIFICATION, 150);
		const stored = row({ text, stream: encodeStream(events) });

		const fast = hydrateSession(stored, { speedMs: 200, errorRate: 0.05 });
		const slow = hydrateSession(stored, { speedMs: 100, errorRate: 0.05 });

		expect(fast.bigramAggregates.find((a) => a.bigram === 'th')!.classification).toBe('healthy');
		expect(slow.bigramAggregates.find((a) => a.bigram === 'th')!.classification).toBe('fluency');
	});

	it('hands back a legacy row’s stored aggregates untouched', () => {
		// No text, no stream — nothing to re-measure from, so the frozen
		// session-time classification is all there is.
		const stored = row({ bigramAggregates: [agg('th', 'sess', { classification: 'hasty' })] });
		expect(hydrateSession(stored).bigramAggregates).toEqual(stored.bigramAggregates);
	});

	it('reports no bigrams for a row with neither stream nor aggregates', () => {
		expect(hydrateSession(row()).bigramAggregates).toEqual([]);
	});
});

describe('assessPacing', () => {
	function paced(overrides: Partial<PacingInput> = {}): PacingInput {
		return {
			id: 'now',
			timestamp: 10_000,
			type: 'real-text',
			wpm: 60,
			errorRate: 0.03,
			...overrides
		};
	}

	/** History of same-type sessions averaging 60 WPM, all older than `paced()`. */
	const sixtyWpmHistory: PacingInput[] = [
		paced({ id: 'h1', timestamp: 1_000, wpm: 55 }),
		paced({ id: 'h2', timestamp: 2_000, wpm: 65 })
	];

	// The whole 2x3 grid. `keepingPace` is expressed as the WPM the session hit
	// against a 60 WPM average, so the table reads the way the docs describe it.
	it.each<[string, number, number, PacingVerdict]>([
		['clean and quick — nothing to fix', 0.01, 70, 'well-paced'],
		['clean but slow — the one case that says speed up', 0.01, 50, 'too-careful'],
		['in band, quick', 0.03, 70, 'well-paced'],
		['in band, slow — still in band, so still fine', 0.03, 50, 'well-paced'],
		['messy but quick — back off', 0.12, 70, 'too-fast'],
		['messy and slow — still back off; slowness is not the excuse', 0.12, 50, 'too-fast']
	])('%s', (_label, errorRate, wpm, expected) => {
		const result = assessPacing(paced({ errorRate, wpm }), sixtyWpmHistory);
		expect(result.verdict).toBe(expected);
		expect(result.recentWpm).toBe(60);
	});

	// Both edges decide a verdict, so they are pinned rather than left to
	// whichever way the comparison happens to fall. Slow throughout, so the
	// cautious band resolves to `too-careful` and the boundary is visible.
	it.each<[number, PacingVerdict]>([
		[0.0199, 'too-careful'],
		[0.02, 'well-paced'],
		[0.05, 'well-paced'],
		[0.0501, 'too-fast']
	])('error rate %f reads as %s', (errorRate, expected) => {
		expect(assessPacing(paced({ errorRate, wpm: 50 }), sixtyWpmHistory).verdict).toBe(expected);
	});

	it('reports no baseline on a first session and assumes the pace was fine', () => {
		// Without history there is nothing to be slower than, so the clean-and-slow
		// cell must not fire — a first session would always read as too careful.
		const result = assessPacing(paced({ errorRate: 0.01, wpm: 5 }), []);
		expect(result.recentWpm).toBeUndefined();
		expect(result.verdict).toBe('well-paced');
	});

	it('ignores the session itself when it appears in its own history', () => {
		// The summary page reads recent sessions after the current one is saved.
		const session = paced({ id: 'now', errorRate: 0.01, wpm: 50 });
		expect(assessPacing(session, [...sixtyWpmHistory, session]).recentWpm).toBe(60);
	});

	it('compares against its own session type only', () => {
		// Drill passages are bigram-dense and type slower than prose; averaging
		// them in would read every real-text session as a personal best.
		const drills = [
			paced({ id: 'd1', timestamp: 1_000, type: 'bigram-drill', wpm: 20 }),
			paced({ id: 'd2', timestamp: 2_000, type: 'bigram-drill', wpm: 20 })
		];
		const result = assessPacing(paced({ errorRate: 0.01, wpm: 50 }), [
			...sixtyWpmHistory,
			...drills
		]);
		expect(result.recentWpm).toBe(60);
		expect(result.verdict).toBe('too-careful');
	});

	it('ignores sessions newer than the one being judged', () => {
		// Re-opening an old summary must give the verdict that session earned,
		// not one coloured by everything typed since.
		const later = paced({ id: 'later', timestamp: 99_000, wpm: 200 });
		expect(assessPacing(paced(), [...sixtyWpmHistory, later]).recentWpm).toBe(60);
	});

	it('averages only the most recent window', () => {
		// One ancient slow session must not drag the baseline down forever.
		const history: PacingInput[] = [
			paced({ id: 'ancient', timestamp: 1, wpm: 0 }),
			...Array.from({ length: PACING_COMPARISON_WINDOW }, (_, i) =>
				paced({ id: `w${i}`, timestamp: 1_000 + i, wpm: 60 })
			)
		];
		expect(assessPacing(paced(), history).recentWpm).toBe(60);
	});

	it('treats exactly matching the recent average as keeping pace', () => {
		// The other boundary that decides a verdict: at the average the typist is
		// not slower than usual, so a clean session is fine rather than timid.
		expect(assessPacing(paced({ errorRate: 0.01, wpm: 60 }), sixtyWpmHistory).verdict).toBe(
			'well-paced'
		);
	});
});
