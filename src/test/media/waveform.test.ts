import { beforeAll, describe, expect, it } from 'vitest';

interface Bar {
	fill: string;
	x: number;
	height: number;
}

/**
 * Canvas stub that records the bars the waveform draws, so the drawing rules can
 * be asserted without a real 2D context.
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
		stroke: () => undefined,
		arc: () => undefined,
		save: () => undefined,
		restore: () => undefined,
		clip: () => undefined,
		fillRect: () => undefined,
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
		timeAtX(x: number): number;
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
					'--cp-rail-inflight': 'RAIL_INFLIGHT',
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
		view.setBuffer({ chunkCount: 0, decoded: [], inflight: [] });
		view.setPeaks(peaks);

		// Every setter repaints, so keep only the last frame — and only the
		// waveform bars, not the rail or playhead drawn alongside them.
		bars.length = 0;
		view.setProgress(currentTime);
		return bars.filter((bar) => WAVE_COLORS.includes(bar.fill));
	}

	it('draws undecoded regions in the ghost colour', () => {
		const peaks = new Float32Array(64).fill(-1);
		const bars = drawWith(peaks);
		expect(bars.every((bar) => bar.fill === 'GHOST')).toBe(true);
	});

	it('draws measured silence flat but in the waveform colour, not the ghost colour', () => {
		const silent = drawWith(new Float32Array(64).fill(0));
		const undecoded = drawWith(new Float32Array(64).fill(-1));

		// Same height — silence and "not seen yet" are both flat...
		expect(silent[0].height).toBe(undecoded[0].height);
		// ...and told apart by colour alone.
		expect(silent.every((bar) => bar.fill === 'FUTURE')).toBe(true);
		expect(undecoded.every((bar) => bar.fill === 'GHOST')).toBe(true);
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

	it('maps a pointer position to a time in the track', () => {
		const { canvas } = recordingCanvas();
		const view = new WaveformView(canvas);
		view.setDuration(100);
		expect(view.timeAtX(200)).toBeCloseTo(50);
		expect(view.timeAtX(-40)).toBe(0);
		expect(view.timeAtX(9999)).toBe(100);
	});
});
