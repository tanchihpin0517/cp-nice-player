import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validManifest } from './helpers/manifestFixtures';
import { setupEngineGlobals } from './helpers/mockAudioContext';

describe('StreamingAudioEngine', () => {
	type EngineInstance = {
		load: (serverUrl: string, audioId: string, options?: Record<string, unknown>) => Promise<void>;
		play: () => Promise<void>;
		pause: () => Promise<void>;
		seek: (seconds: number) => Promise<void>;
		close: () => Promise<void>;
		getDuration: () => number;
		getCurrentTime: () => number;
		getDiagnostics: () => Record<string, unknown>;
		addEventListener: (type: string, listener: (event: Event) => void) => void;
		encodedChunks: { set: (k: number, v: ArrayBuffer) => void; has: (k: number) => boolean; size: number };
		pausedAt: number;
		decodedChunks: Set<number>;
		_storeEncodedChunk: (index: number, bytes: ArrayBuffer) => void;
		_getPinnedChunkRange: () => { min: number; max: number };
		_decodeAndWriteChunk: (index: number, generation: number) => Promise<number | null>;
		loadGeneration: number;
	};

	let StreamingAudioEngine: new () => EngineInstance;
	let engine: EngineInstance;
	const manifest = validManifest();
	const serverUrl = 'http://127.0.0.1:9999';

	function createFetchMock(indexFails = 0) {
		let indexAttempts = 0;
		return vi.fn(async (input: string | URL) => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url.includes('/index')) {
				indexAttempts += 1;
				if (indexAttempts <= indexFails) {
					return {
						ok: false,
						status: 503,
						text: async () => 'unavailable',
					};
				}
				return {
					ok: true,
					json: async () => manifest,
				};
			}
			if (url.includes('/chunk/')) {
				return {
					ok: true,
					arrayBuffer: async () => new ArrayBuffer(128),
				};
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});
	}

	beforeEach(async () => {
		vi.useFakeTimers();
		StreamingAudioEngine = await setupEngineGlobals() as new () => EngineInstance;
		global.fetch = createFetchMock() as typeof fetch;
		engine = new StreamingAudioEngine();
	});

	afterEach(async () => {
		await engine.close();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('load emits loading then ready with duration', async () => {
		const events: string[] = [];
		engine.addEventListener('loading', () => events.push('loading'));
		engine.addEventListener('ready', () => events.push('ready'));

		await engine.load(serverUrl, 'abcd1234', { prefetchChunks: 3 });

		expect(events).toEqual(['loading', 'ready']);
		expect(engine.getDuration()).toBe(manifest.durationSec);
	});

	it('play and pause toggle playing state', async () => {
		await engine.load(serverUrl, 'abcd1234');

		const playing: string[] = [];
		engine.addEventListener('playing', () => playing.push('playing'));
		engine.addEventListener('pause', () => playing.push('pause'));

		await engine.play();
		expect(engine.getDiagnostics().paused).toBe(false);
		expect(playing).toContain('playing');

		await engine.pause();
		expect(engine.getDiagnostics().paused).toBe(true);
		expect(playing).toContain('pause');
	});

	it('seek aborts in-flight fetches and clears decoded chunks', async () => {
		await engine.load(serverUrl, 'abcd1234');

		engine.decodedChunks.add(0);
		engine.decodedChunks.add(1);
		const abortSpy = vi.spyOn(AbortController.prototype, 'abort');

		await engine.seek(2.5);
		expect(engine.getCurrentTime()).toBe(2.5);
		expect(engine.decodedChunks.size).toBe(0);
		expect(abortSpy).toHaveBeenCalled();
	});

	it('reports an amplitude envelope for every chunk it decodes', async () => {
		// The waveform overview is built from these: no second read of the source.
		await engine.load(serverUrl, 'abcd1234');

		const decoded: Array<{ chunkIndex: number; peaks: Float32Array }> = [];
		engine.addEventListener('decodefinished', (event) => {
			decoded.push((event as CustomEvent).detail);
		});

		engine._storeEncodedChunk(0, new ArrayBuffer(128));
		await engine._decodeAndWriteChunk(0, engine.loadGeneration);

		expect(decoded).toHaveLength(1);
		expect(decoded[0].chunkIndex).toBe(0);
		expect(decoded[0].peaks).toBeInstanceOf(Float32Array);
		expect(decoded[0].peaks.length).toBe(16);
		// The mock decodes to a full-scale sine, so every bucket carries signal.
		expect(Array.from(decoded[0].peaks).every((peak) => peak > 0 && peak <= 1)).toBe(true);
	});

	it('retries index fetch after failure', async () => {
		global.fetch = createFetchMock(1) as typeof fetch;
		const errors: string[] = [];
		engine.addEventListener('error', (event) => {
			errors.push((event as CustomEvent).detail.message);
		});

		const loadPromise = engine.load(serverUrl, 'abcd1234');
		await vi.advanceTimersByTimeAsync(1000);
		await loadPromise;

		expect(errors.length).toBeGreaterThan(0);
		expect(engine.getDuration()).toBe(manifest.durationSec);
	});

	it('encoded LRU eviction keeps pinned chunks', async () => {
		await engine.load(serverUrl, 'abcd1234', {
			prefetchChunks: 1,
			maxCachedChunks: 3,
		});

		engine.pausedAt = 2;
		const pinRange = engine._getPinnedChunkRange();
		expect(pinRange.min).toBe(0);
		expect(pinRange.max).toBe(2);

		for (let i = 0; i < 6; i += 1) {
			engine._storeEncodedChunk(i, new ArrayBuffer(16));
		}

		expect(engine.encodedChunks.size).toBeLessThanOrEqual(3);
		for (let i = pinRange.min; i <= pinRange.max; i += 1) {
			expect(engine.encodedChunks.has(i)).toBe(true);
		}
	});

	/**
	 * The chunk register draws this, so it has to read as a span of the track. The
	 * LRU hands its keys back in recency order, which is the order chunks were
	 * touched, not the order they sit in the file.
	 */
	it('reports the encoded cache as a sorted chunk span', async () => {
		await engine.load(serverUrl, 'abcd1234', { maxCachedChunks: 10 });

		for (const index of [3, 0, 1, 2, 5]) {
			engine._storeEncodedChunk(index, new ArrayBuffer(16));
		}

		expect(engine.getDiagnostics().bufferedChunks).toBe('0-3, 5');
	});

	it('maintains fetch window for current playhead chunk', async () => {
		await engine.load(serverUrl, 'abcd1234', { prefetchChunks: 3 });

		await vi.advanceTimersByTimeAsync(250);

		const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
			.map(([url]) => String(url))
			.filter((url) => url.includes('/chunk/'));
		expect(fetchCalls.length).toBeGreaterThan(0);
		expect(fetchCalls[0]).toContain('/chunk/0');
	});
});
