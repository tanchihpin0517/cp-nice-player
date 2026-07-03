import { vi } from 'vitest';

export interface MockEngine {
	load: ReturnType<typeof vi.fn>;
	play: ReturnType<typeof vi.fn>;
	pause: ReturnType<typeof vi.fn>;
	seek: ReturnType<typeof vi.fn>;
	setVolume: ReturnType<typeof vi.fn>;
	setMuted: ReturnType<typeof vi.fn>;
	getDuration: ReturnType<typeof vi.fn>;
	getCurrentTime: ReturnType<typeof vi.fn>;
	getDiagnostics: ReturnType<typeof vi.fn>;
	addEventListener: (type: string, listener: (event: Event) => void) => void;
	dispatchEngineEvent: (type: string, detail?: Record<string, unknown>) => void;
}

export function setupPlayerDom(): void {
	document.body.innerHTML = `
    <div class="track-name" id="trackName">No media loaded</div>
    <div class="track-state" id="trackState">Waiting</div>
    <div class="empty" id="emptyState"></div>
    <button id="playbackPlayPause" disabled>Play</button>
    <span id="playbackCurrentTime">0:00</span>
    <span id="playbackDuration">0:00</span>
    <input id="playbackSeek" type="range" min="0" max="1" step="0.001" value="0" disabled>
    <input id="playbackVolume" type="range" min="0" max="1" step="0.01" value="1" disabled>
    <input id="playbackMuted" type="checkbox" disabled>
    <dl class="debug-grid" id="debugGrid"></dl>
    <ol class="debug-log" id="debugLog"></ol>
    <details class="debug-panel" id="debugPanel" open>
      <summary>Debug</summary>
    </details>
  `;
}

export function createMockEngine(): MockEngine {
	const listeners = new Map<string, Set<(event: Event) => void>>();

	const engine: MockEngine = {
		load: vi.fn(async () => undefined),
		play: vi.fn(async () => undefined),
		pause: vi.fn(async () => undefined),
		seek: vi.fn(async () => undefined),
		setVolume: vi.fn(),
		setMuted: vi.fn(),
		getDuration: vi.fn(() => 120),
		getCurrentTime: vi.fn(() => 30),
		getDiagnostics: vi.fn(() => ({
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
		})),
		addEventListener(type: string, listener: (event: Event) => void) {
			if (!listeners.has(type)) {
				listeners.set(type, new Set());
			}
			listeners.get(type)!.add(listener);
		},
		dispatchEngineEvent(type: string, detail: Record<string, unknown> = {}) {
			for (const listener of listeners.get(type) ?? []) {
				listener(new CustomEvent(type, { detail }));
			}
		},
	};

	return engine;
}

export const loadMediaMessage = {
	type: 'loadMedia' as const,
	name: 'track.mp3',
	serverUrl: 'http://127.0.0.1:8765',
	audioId: 'deadbeef',
	debug: {
		fsPath: '/music/track.mp3',
		playbackFormat: 'ogg',
		chunkBufferCount: 5,
		chunkDurationSec: 1,
		maxEncodedChunks: 64,
	},
};
