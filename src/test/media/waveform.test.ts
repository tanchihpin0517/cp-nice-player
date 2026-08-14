import { beforeAll, describe, expect, it } from 'vitest';

interface Bar {
	fill: string;
	x: number;
	height: number;
}

/**
 * Canvas stub that records the bars the waveform draws, so the drawing rules can
 * be asserted without a real 2D context. Bars are fillRect calls — the tape is
 * drawn as square 1px columns rather than rounded ones — and roundRect is still
 * recorded so a future rounded mark does not silently escape these tests.
 */
function recordingCanvas() {
	const bars: Bar[] = [];
	let fillStyle = '';
	let pending: { x: number; height: number } | undefined;

	const context = {
		get fillStyle() {
			return fillStyle;
		},
		set fillStyle(value: string) {
			fillStyle = value;
		},
		setTransform: () => undefined,
		clearRect: () => undefined,
		beginPath: () => undefined,
		moveTo: () => undefined,
		lineTo: () => undefined,
		closePath: () => undefined,
		stroke: () => undefined,
		arc: () => undefined,
		save: () => undefined,
		restore: () => undefined,
		clip: () => undefined,
		measureText: () => ({ width: 24 }),
		fillText: () => undefined,
		font: '',
		textBaseline: '',
		fillRect: (x: number, _y: number, _w: number, h: number) => {
			bars.push({ fill: fillStyle, x, height: h });
		},
		roundRect: (x: number, _y: number, _w: number, h: number) => {
			pending = { x, height: h };
		},
		fill: () => {
			if (pending) {
				bars.push({ fill: fillStyle, ...pending });
				pending = undefined;
			}
		},
		globalAlpha: 1,
		lineWidth: 1,
		strokeStyle: '',
	};

	const canvas = {
		getContext: () => context,
		getBoundingClientRect: () => ({ width: 400, height: 132, left: 0, top: 0 }),
	} as unknown as HTMLCanvasElement;

	return { canvas, bars };
}

describe('WaveformView', () => {
	let WaveformView: new (canvas: HTMLCanvasElement) => {
		setPeaks(peaks: Float32Array | null): void;
		setDuration(duration: number): void;
		setProgress(time: number): void;
		setBuffer(buffer: Record<string, unknown>): void;
		setLocators(locators: Record<string, number | null>): void;
		timeAtX(x: number): number;
		regionAtY(y: number): string;
	};

	beforeAll(async () => {
		(globalThis as Record<string, unknown>).ResizeObserver = class {
			observe() { /* jsdom does no layout */ }
			disconnect() { /* jsdom does no layout */ }
		};
		(globalThis as Record<string, unknown>).getComputedStyle = () => ({
			getPropertyValue: (name: string) => {
				const colors: Record<string, string> = {
					'--cp-wave-past': 'PAST',
					'--cp-wave-future': 'FUTURE',
					'--cp-wave-ghost': 'GHOST',
					'--cp-wave-playhead': 'HEAD',
					'--cp-rail-empty': 'RAIL_EMPTY',
					'--cp-rail-decoded': 'RAIL_DECODED',
					'--cp-rail-fetched': 'RAIL_FETCHED',
					'--cp-mark': 'MARK',
				};
				return colors[name] ?? '';
			},
		});

		await import('../../../media/player/waveform.js');
		WaveformView = (globalThis as Record<string, unknown>).WaveformView as typeof WaveformView;
	});

	const WAVE_COLORS = ['PAST', 'FUTURE', 'GHOST'];

	function drawWith(peaks: Float32Array | null, currentTime = 0) {
		const { canvas, bars } = recordingCanvas();
		const view = new WaveformView(canvas);
		view.setDuration(100);
		view.setBuffer({ chunkCount: 0, decoded: [], fetched: [] });
		view.setPeaks(peaks);

		// Every setter repaints, so keep only the last frame — and only the tape
		// columns, not the ruler, rails or chunk field drawn alongside them.
		bars.length = 0;
		view.setProgress(currentTime);
		return bars.filter((bar) => WAVE_COLORS.includes(bar.fill));
	}

	it('draws undecoded regions in the ghost colour', () => {
		const peaks = new Float32Array(64).fill(-1);
		const bars = drawWith(peaks);
		expect(bars.every((bar) => bar.fill === 'GHOST')).toBe(true);
	});

	/**
	 * Unread tape is a visible band rather than a flat line: drawing it at zero
	 * made a freshly opened file look like a player that had failed to load. It is
	 * a constant height, so it can never be mistaken for a measurement, and a
	 * decoded silence stays flat in the waveform colour.
	 */
	it('draws unread tape as a constant band and measured silence flat', () => {
		const silent = drawWith(new Float32Array(64).fill(0));
		const unread = drawWith(new Float32Array(64).fill(-1));

		expect(silent.every((bar) => bar.fill === 'FUTURE')).toBe(true);
		expect(unread.every((bar) => bar.fill === 'GHOST')).toBe(true);

		// Every unread column is the same height, and taller than real silence.
		expect(new Set(unread.map((bar) => bar.height)).size).toBe(1);
		expect(unread[0].height).toBeGreaterThan(silent[0].height);
	});

	it('scales bar height with the measured peak', () => {
		const quiet = drawWith(new Float32Array(64).fill(0.1));
		const loud = drawWith(new Float32Array(64).fill(1));
		expect(loud[0].height).toBeGreaterThan(quiet[0].height);
	});

	it('colours bars before the playhead as played', () => {
		const bars = drawWith(new Float32Array(64).fill(0.5), 50);
		const played = bars.filter((bar) => bar.fill === 'PAST');
		const upcoming = bars.filter((bar) => bar.fill === 'FUTURE');

		expect(played.length).toBeGreaterThan(0);
		expect(upcoming.length).toBeGreaterThan(0);
		// Everything played sits left of everything still to come.
		expect(Math.max(...played.map((bar) => bar.x)))
			.toBeLessThan(Math.min(...upcoming.map((bar) => bar.x)));
	});

	it('ghosts everything when no peaks have arrived at all', () => {
		const bars = drawWith(null);
		expect(bars.length).toBeGreaterThan(0);
		expect(bars.every((bar) => bar.fill === 'GHOST')).toBe(true);
	});

	/**
	 * The chunk register reads as a pipeline — unread, then fetched, then decoded
	 * — so a chunk whose bytes are held *and* decoded has to draw decoded. The
	 * fetched band is wider than the decoded one in normal operation, and painting
	 * it last would bury the decoded extent under it.
	 */
	it('draws decoded over fetched in the chunk register', () => {
		const { canvas, bars } = recordingCanvas();
		const view = new WaveformView(canvas);
		view.setDuration(100);
		bars.length = 0;
		view.setBuffer({ chunkCount: 10, fetched: [[0, 5]], decoded: [[0, 2]] });

		const decoded = bars.filter((bar) => bar.fill === 'RAIL_DECODED');
		const fetched = bars.filter((bar) => bar.fill === 'RAIL_FETCHED');

		// One run each: chunks 0-2 decoded, and 3-5 fetched but not yet decoded.
		expect(decoded).toHaveLength(1);
		expect(fetched).toHaveLength(1);
		expect(decoded[0].x).toBe(0);
		// 400px / 10 chunks = 40px each, so the fetched-only run starts at chunk 3.
		expect(fetched[0].x).toBe(120);
	});

	it('leaves the chunk register empty until the manifest reports a chunk count', () => {
		const { canvas, bars } = recordingCanvas();
		const view = new WaveformView(canvas);
		view.setDuration(100);
		bars.length = 0;
		view.setBuffer({ chunkCount: 0, fetched: [[0, 5]], decoded: [[0, 2]] });

		// Only the empty rail: with no chunk count there is no axis to place a
		// range on, so a stale buffer report cannot draw a band across the field.
		expect(bars.some((bar) => bar.fill === 'RAIL_DECODED')).toBe(false);
		expect(bars.some((bar) => bar.fill === 'RAIL_FETCHED')).toBe(false);
		expect(bars.some((bar) => bar.fill === 'RAIL_EMPTY')).toBe(true);
	});

	it('maps a pointer position to a time in the track', () => {
		const { canvas } = recordingCanvas();
		const view = new WaveformView(canvas);
		view.setDuration(100);
		expect(view.timeAtX(200)).toBeCloseTo(50);
		expect(view.timeAtX(-40)).toBe(0);
		expect(view.timeAtX(9999)).toBe(100);
	});

	/** The two gestures on this surface are split by register, so this has to be exact. */
	it('reports which register a pointer is over', () => {
		const { canvas } = recordingCanvas();
		const view = new WaveformView(canvas);
		expect(view.regionAtY(4)).toBe('ruler');
		expect(view.regionAtY(70)).toBe('tape');
		expect(view.regionAtY(130)).toBe('chunks');
	});

	it('marks the loop region with the marker colour', () => {
		const { canvas, bars } = recordingCanvas();
		const view = new WaveformView(canvas);
		view.setDuration(100);
		view.setBuffer({ chunkCount: 0, decoded: [], fetched: [] });
		bars.length = 0;
		view.setLocators({ in: 20, out: 40 });

		const marks = bars.filter((bar) => bar.fill === 'MARK');
		// One bar across the ruler, plus a hairline down the tape per edge.
		expect(marks.length).toBeGreaterThanOrEqual(3);
	});
});
