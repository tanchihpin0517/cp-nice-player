import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	baseDiagnostics,
	createMockEngine,
	loadMediaMessage,
	serverStatusMessage,
	setupPlayerDom,
	stubCanvasEnvironment,
	type MockEngine,
} from './helpers/setupPlayerDom';

describe('player.js', () => {
	let mockEngine: MockEngine;
	let mockVscode: {
		postMessage: ReturnType<typeof vi.fn>;
		getState: ReturnType<typeof vi.fn>;
		setState: ReturnType<typeof vi.fn>;
	};

	const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

	beforeAll(async () => {
		stubCanvasEnvironment();
		setupPlayerDom();
		mockEngine = createMockEngine();
		mockVscode = {
			postMessage: vi.fn(),
			getState: vi.fn(() => null),
			setState: vi.fn(),
		};

		(globalThis as Record<string, unknown>).acquireVsCodeApi = () => mockVscode;
		(globalThis as Record<string, unknown>).StreamingAudioEngine = class {
			constructor() {
				return mockEngine;
			}
		};

		await import('../../../media/player/formatUtils.js');
		await import('../../../media/player/waveform.js');
		await import('../../../media/player/playerView.js');
		await import('../../../media/player/player.js');
		expect(mockVscode.postMessage).toHaveBeenCalledWith({ type: 'ready' });
	});

	beforeEach(() => {
		mockEngine.load.mockClear();
		mockEngine.play.mockClear();
		mockEngine.pause.mockClear();
		mockEngine.seek.mockClear();
		mockEngine.getDiagnostics.mockReturnValue(baseDiagnostics());
	});

	async function loadTrack() {
		window.dispatchEvent(new MessageEvent('message', { data: loadMediaMessage }));
		await vi.waitFor(() => expect(mockEngine.load).toHaveBeenCalled());
	}

	it('handles loadMedia message', async () => {
		await loadTrack();

		expect(mockEngine.load).toHaveBeenCalledWith(
			loadMediaMessage.serverUrl,
			loadMediaMessage.audioId,
			expect.objectContaining({ name: 'track.mp3' }),
		);
		expect(el('trackName').textContent).toBe('track.mp3');
		expect(el<HTMLButtonElement>('playPause').disabled).toBe(false);
		expect(el('player').dataset.state).toBe('ready');
		expect(el('chipFormat').textContent).toBe('OGG');
		expect(el('chipLayout').textContent).toBe('2ch @ 44100 Hz');
	});

	it('toggles play and pause from the transport button', async () => {
		mockEngine.getDiagnostics.mockReturnValue(baseDiagnostics({ paused: true }));

		el('playPause').click();
		await vi.waitFor(() => expect(mockEngine.play).toHaveBeenCalled());

		mockEngine.getDiagnostics.mockReturnValue(baseDiagnostics({ paused: false }));
		el('playPause').click();
		await vi.waitFor(() => expect(mockEngine.pause).toHaveBeenCalled());
	});

	it('marks the playing state from engine events', () => {
		mockEngine.dispatchEngineEvent('playing');
		expect(el('player').dataset.playing).toBe('true');
		expect(el('trackStatus').dataset.tone).toBe('live');

		mockEngine.dispatchEngineEvent('pause');
		expect(el('player').dataset.playing).toBe('false');
	});

	it('skips forward and back by ten seconds', async () => {
		mockEngine.getCurrentTime.mockReturnValue(30);
		el('skipForward').click();
		await vi.waitFor(() => expect(mockEngine.seek).toHaveBeenCalledWith(40));

		mockEngine.seek.mockClear();
		el('skipBack').click();
		await vi.waitFor(() => expect(mockEngine.seek).toHaveBeenCalledWith(20));
	});

	it('clamps skipping to the bounds of the track', async () => {
		mockEngine.getCurrentTime.mockReturnValue(2);
		el('skipBack').click();
		await vi.waitFor(() => expect(mockEngine.seek).toHaveBeenCalledWith(0));

		mockEngine.seek.mockClear();
		mockEngine.getCurrentTime.mockReturnValue(115);
		el('skipForward').click();
		await vi.waitFor(() => expect(mockEngine.seek).toHaveBeenCalledWith(120));
	});

	it('toggles mute', () => {
		el('muteBtn').click();
		expect(el('player').dataset.muted).toBe('true');
		expect(mockEngine.setMuted).toHaveBeenCalledWith(true);

		el('muteBtn').click();
		expect(el('player').dataset.muted).toBe('false');
		expect(mockEngine.setMuted).toHaveBeenCalledWith(false);
	});

	it('does not move the playhead readout while scrubbing the waveform', () => {
		const wave = el('wave');
		wave.setAttribute('aria-disabled', 'false');
		// clientY has to land in the tape register: the ruler marks locators instead.
		wave.dispatchEvent(new PointerEvent('pointerdown', { clientX: 400, clientY: 70, bubbles: true }));
		const scrubbed = el('currentTime').textContent;

		mockEngine.dispatchEngineEvent('timeupdate', { currentTime: 10, duration: 120 });
		expect(el('currentTime').textContent).toBe(scrubbed);

		wave.dispatchEvent(new PointerEvent('pointerup', { clientX: 400, clientY: 70, bubbles: true }));
	});

	it('shows the counter to the millisecond', () => {
		mockEngine.dispatchEngineEvent('timeupdate', { currentTime: 83.4567, duration: 120 });
		expect(el('currentTime').textContent).toBe('1:23.456');
	});

	describe('locators and looping', () => {
		const wave = () => el('wave');

		function markRuler(fromX: number, toX: number) {
			wave().setAttribute('aria-disabled', 'false');
			// clientY inside the ruler register, which is where a region is marked.
			wave().dispatchEvent(new PointerEvent('pointerdown', { clientX: fromX, clientY: 4, bubbles: true }));
			wave().dispatchEvent(new PointerEvent('pointerup', { clientX: toX, clientY: 4, bubbles: true }));
		}

		beforeEach(() => {
			el('player').dataset.state = 'ready';
			document.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', bubbles: true }));
		});

		it('marks a region by dragging the ruler and enables the loop key', () => {
			expect(el<HTMLButtonElement>('loopToggle').disabled).toBe(true);

			// The canvas is stubbed 800px wide over a 120s track: 100px is 15s.
			markRuler(100, 300);

			expect(el<HTMLButtonElement>('loopToggle').disabled).toBe(false);
			expect(el('loopReadout').textContent).toContain('In 0:15.000');
			expect(el('loopReadout').textContent).toContain('Out 0:45.000');
		});

		it('clears the region on a ruler click, which disables the loop key', () => {
			markRuler(100, 300);
			markRuler(200, 200);

			expect(el<HTMLButtonElement>('loopToggle').disabled).toBe(true);
			expect(el('loopReadout').textContent).toBe('');
		});

		it('sets each edge from the playhead with the bracket keys', () => {
			mockEngine.getCurrentTime.mockReturnValue(12);
			document.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }));
			mockEngine.getCurrentTime.mockReturnValue(18);
			document.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }));

			expect(el('loopReadout').textContent).toContain('In 0:12.000');
			expect(el('loopReadout').textContent).toContain('Out 0:18.000');
			expect(el<HTMLButtonElement>('loopToggle').disabled).toBe(false);
		});

		it('latches the loop and wraps the playhead back to the in point', async () => {
			markRuler(100, 300);
			mockEngine.getCurrentTime.mockReturnValue(20);
			el('loopToggle').click();
			await vi.waitFor(() => expect(el('loopToggle').dataset.lit).toBe('true'));

			mockEngine.seek.mockClear();
			mockEngine.dispatchEngineEvent('timeupdate', { currentTime: 45.2, duration: 120 });
			await vi.waitFor(() => expect(mockEngine.seek).toHaveBeenCalledWith(15));
		});

		it('leaves the playhead alone inside the region', async () => {
			markRuler(100, 300);
			mockEngine.getCurrentTime.mockReturnValue(20);
			el('loopToggle').click();
			await vi.waitFor(() => expect(el('loopToggle').dataset.lit).toBe('true'));

			mockEngine.seek.mockClear();
			mockEngine.dispatchEngineEvent('timeupdate', { currentTime: 30, duration: 120 });
			expect(mockEngine.seek).not.toHaveBeenCalled();
		});
	});

	it('renders playback diagnostics', async () => {
		await loadTrack();
		mockEngine.dispatchEngineEvent('ready', { duration: 120 });

		const grid = el('playbackGrid');
		expect(grid.innerHTML).toContain('2ch @ 44100 Hz');
		expect(grid.innerHTML).toContain('index.chunkCount');
		expect(grid.innerHTML).toContain('/music/track.mp3');
	});

	it('logs fetch and decode events', () => {
		mockEngine.dispatchEngineEvent('chunkfinished', { chunkIndex: 2, bytes: 2048 });
		mockEngine.dispatchEngineEvent('decodefinished', {
			chunkIndex: 2,
			elapsedMs: 12.5,
			wsolaShiftSamples: 441,
			peaks: new Float32Array(16).fill(0.5),
		});

		const log = el('eventLog');
		expect(log.innerHTML).toContain('chunk=2');
		expect(log.innerHTML).toContain('bytes=2.0KB');
		expect(log.innerHTML).toContain('decode');
		expect(log.innerHTML).toContain('wsola=');
	});

	it('shows an unknown server state before the extension reports one', () => {
		// Rendered at startup, so the panel is never blank even if no status arrives.
		expect(el('serverGrid').innerHTML).toContain('unknown');
	});

	it('renders server status from the extension', () => {
		window.dispatchEvent(new MessageEvent('message', { data: serverStatusMessage }));

		const grid = el('serverGrid');
		expect(grid.innerHTML).toContain('listening');
		expect(grid.innerHTML).toContain('https://abc.vscode-cdn.net:8765');
		expect(grid.innerHTML).toContain('forwarded');
		expect(grid.innerHTML).toContain('ok (12ms)');
		expect(grid.innerHTML).toContain('/usr/bin/ffmpeg');
		expect(grid.innerHTML).toContain('ogg');
	});

	it('marks an unreachable server and its error', () => {
		window.dispatchEvent(new MessageEvent('message', {
			data: {
				type: 'serverStatus',
				status: {
					...serverStatusMessage.status,
					state: 'failed',
					lastError: 'bind failed',
					hostReachable: { ok: false, error: 'ECONNREFUSED', checkedAt: 1 },
				},
			},
		}));

		const grid = el('serverGrid');
		expect(grid.innerHTML).toContain('failed: ECONNREFUSED');
		expect(grid.innerHTML).toContain('bind failed');
		expect(grid.innerHTML).toContain('class="bad"');
	});

	it('reports engine errors to the extension, throttled', () => {
		mockVscode.postMessage.mockClear();
		mockEngine.dispatchEngineEvent('error', { message: 'Failed to fetch' });
		mockEngine.dispatchEngineEvent('error', { message: 'Failed to fetch again' });

		const streamErrors = mockVscode.postMessage.mock.calls.filter(
			([message]) => (message as { type?: string }).type === 'streamError',
		);
		expect(streamErrors).toHaveLength(1);
		expect(streamErrors[0][0]).toEqual({ type: 'streamError', message: 'Failed to fetch' });
	});

	it('shows the error card only when the index is missing entirely', () => {
		mockEngine.getDiagnostics.mockReturnValue(baseDiagnostics({ manifestChunkCount: undefined }));
		mockEngine.dispatchEngineEvent('error', { message: 'index unreachable' });

		expect(el('player').dataset.state).toBe('error');
		expect(el('errorMessage').textContent).toBe('index unreachable');

		// A chunk failing mid-track is recoverable: log it, keep playing.
		mockEngine.getDiagnostics.mockReturnValue(baseDiagnostics());
		el('player').dataset.state = 'ready';
		mockEngine.dispatchEngineEvent('error', { message: 'chunk 4 failed' });
		expect(el('player').dataset.state).toBe('ready');
		expect(el('eventLog').innerHTML).toContain('chunk 4 failed');
	});

	it('requests status and restart from the inspector buttons', () => {
		mockVscode.postMessage.mockClear();
		el('serverRefresh').click();
		el('serverRestart').click();

		expect(mockVscode.postMessage).toHaveBeenCalledWith({ type: 'requestServerStatus' });
		expect(mockVscode.postMessage).toHaveBeenCalledWith({ type: 'restartServer' });
	});

	it('persists inspector open state via the vscode API', () => {
		el('inspectorToggle').click();
		expect(mockVscode.setState).toHaveBeenCalledWith(
			expect.objectContaining({ inspectorOpen: true }),
		);
		expect(el('inspector').hidden).toBe(false);

		el('inspectorToggle').click();
		expect(mockVscode.setState).toHaveBeenCalledWith(
			expect.objectContaining({ inspectorOpen: false }),
		);
	});
});
