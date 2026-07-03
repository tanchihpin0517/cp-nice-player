import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockEngine, loadMediaMessage, setupPlayerDom, type MockEngine } from './helpers/setupPlayerDom';

describe('player.js', () => {
	let mockEngine: MockEngine;
	let mockVscode: {
		postMessage: ReturnType<typeof vi.fn>;
		getState: ReturnType<typeof vi.fn>;
		setState: ReturnType<typeof vi.fn>;
	};

	beforeAll(async () => {
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
		await import('../../../media/player/player.js');
		expect(mockVscode.postMessage).toHaveBeenCalledWith({ type: 'ready' });
	});

	beforeEach(() => {
		mockEngine.load.mockClear();
		mockEngine.play.mockClear();
		mockEngine.pause.mockClear();
		mockEngine.seek.mockClear();
		mockEngine.getDiagnostics.mockReturnValue({
			paused: true,
			manifestChannels: 2,
			manifestSampleRate: 44100,
			contextSampleRate: 44100,
			maxEncodedChunks: 64,
			encodedChunkCount: 2,
			bufferedChunks: '0-1',
			contextState: 'running',
			manifestChunkCount: 5,
			currentChunkIndex: 1,
			ringFramesAvailable: 1000,
			ringFreeFrames: 500,
			underrunFrames: 0,
			decodedChunks: '0',
			fetchInFlight: '—',
			currentTime: 30,
			duration: 120,
		});
	});

	it('handles loadMedia message', async () => {
		window.dispatchEvent(new MessageEvent('message', { data: loadMediaMessage }));
		await vi.waitFor(() => expect(mockEngine.load).toHaveBeenCalled());

		expect(mockEngine.load).toHaveBeenCalledWith(
			loadMediaMessage.serverUrl,
			loadMediaMessage.audioId,
			expect.objectContaining({ name: 'track.mp3' }),
		);
		expect(document.getElementById('trackName')?.textContent).toBe('track.mp3');
		expect((document.getElementById('playbackPlayPause') as HTMLButtonElement).disabled).toBe(false);
	});

	it('toggles play and pause from button', async () => {
		mockEngine.getDiagnostics.mockReturnValue({
			paused: true,
			manifestChannels: 2,
			manifestSampleRate: 44100,
			currentTime: 0,
			duration: 120,
		});

		const button = document.getElementById('playbackPlayPause') as HTMLButtonElement;
		button.disabled = false;
		button.click();
		await vi.waitFor(() => expect(mockEngine.play).toHaveBeenCalled());
		expect(button.textContent).toBe('Pause');

		mockEngine.getDiagnostics.mockReturnValue({
			paused: false,
			manifestChannels: 2,
			manifestSampleRate: 44100,
			currentTime: 0,
			duration: 120,
		});
		button.click();
		await vi.waitFor(() => expect(mockEngine.pause).toHaveBeenCalled());
	});

	it('does not update seek display during drag', () => {
		const seek = document.getElementById('playbackSeek') as HTMLInputElement;
		const currentTime = document.getElementById('playbackCurrentTime') as HTMLSpanElement;
		seek.disabled = false;

		seek.dispatchEvent(new PointerEvent('pointerdown'));
		seek.value = '0.5';
		seek.dispatchEvent(new Event('input'));
		expect(currentTime.textContent).toBe('1:00');

		mockEngine.dispatchEngineEvent('timeupdate', { currentTime: 10, duration: 120 });
		expect(currentTime.textContent).toBe('1:00');
	});

	it('renders debug panel from diagnostics', async () => {
		window.dispatchEvent(new MessageEvent('message', { data: loadMediaMessage }));
		await vi.waitFor(() => expect(mockEngine.load).toHaveBeenCalled());
		mockEngine.dispatchEngineEvent('ready', { duration: 120 });
		const grid = document.getElementById('debugGrid');
		expect(grid?.innerHTML).toContain('2ch @ 44100 Hz');
		expect(grid?.innerHTML).toContain('playheadSec');
	});

	it('logs fetch and decode events', () => {
		mockEngine.dispatchEngineEvent('chunkfinished', { chunkIndex: 2, bytes: 2048 });
		mockEngine.dispatchEngineEvent('decodefinished', {
			chunkIndex: 2,
			elapsedMs: 12.5,
			wsolaShiftSamples: 441,
		});

		const log = document.getElementById('debugLog');
		expect(log?.innerHTML).toContain('chunk=2');
		expect(log?.innerHTML).toContain('bytes=2.0KB');
		expect(log?.innerHTML).toContain('decode');
		expect(log?.innerHTML).toContain('wsola=');
	});

	it('persists debug panel open state via vscode API', () => {
		const panel = document.getElementById('debugPanel') as HTMLDetailsElement;
		panel.open = false;
		panel.dispatchEvent(new Event('toggle'));
		expect(mockVscode.setState).toHaveBeenCalledWith({ debugOpen: false });
	});
});
