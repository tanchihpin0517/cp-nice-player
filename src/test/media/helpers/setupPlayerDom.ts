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

/**
 * Mirrors the shipping markup in media/player/player.html. Only the ids and the
 * structure playerView.js reaches for are reproduced; styling is irrelevant here.
 */
export function setupPlayerDom(): void {
	document.body.innerHTML = `
    <div class="cp-root">
      <main class="cp-player" id="player" data-state="empty" data-playing="false" data-muted="false">
        <h1 id="trackName">No media loaded</h1>
        <span id="chipFormat"></span>
        <span id="chipLayout"></span>
        <span id="chipChunks"></span>
        <span class="cp-status" id="trackStatus" data-tone="idle">
          <span id="trackStatusText">Waiting for a file</span>
        </span>
        <button id="inspectorToggle" type="button" aria-expanded="false"></button>

        <div class="cp-wave" id="wave" role="slider" tabindex="0">
          <canvas id="waveCanvas"></canvas>
          <div id="waveSkeleton"></div>
          <div id="waveHover"><span id="waveHoverTime">0:00</span></div>
        </div>
        <span id="currentTime">0:00</span>
        <span id="durationTime">0:00</span>

        <button id="skipBack" type="button"></button>
        <button id="playPause" type="button" aria-label="Play"></button>
        <button id="skipForward" type="button"></button>
        <button id="muteBtn" type="button" aria-label="Mute"></button>
        <input type="range" id="volume" min="0" max="1" step="0.01" value="1">

        <div id="errorState"><div id="errorMessage"></div>
          <button id="errorRetry" type="button"></button>
          <button id="errorDiagnostics" type="button"></button>
        </div>
        <div id="emptyState"></div>

        <section id="inspector" hidden>
          <button id="serverRefresh" type="button">Refresh</button>
          <button id="serverRestart" type="button">Restart</button>
          <dl id="serverGrid"></dl>
          <dl id="playbackGrid"></dl>
          <ol id="eventLog"></ol>
        </section>
      </main>
    </div>
  `;
}

/** jsdom has no canvas or ResizeObserver; the waveform only needs them to exist. */
export function stubCanvasEnvironment(): void {
	(globalThis as Record<string, unknown>).ResizeObserver = class {
		observe() { /* no layout in jsdom */ }
		disconnect() { /* no layout in jsdom */ }
	};

	const noop = () => undefined;
	const context = new Proxy({}, { get: () => noop, set: () => true });
	HTMLCanvasElement.prototype.getContext = (() => context) as unknown as
		HTMLCanvasElement['getContext'];
	HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
		width: 800, height: 132, left: 0, top: 0, right: 800, bottom: 132, x: 0, y: 0,
		toJSON: () => ({}),
	});
	Element.prototype.setPointerCapture = noop;
	Element.prototype.releasePointerCapture = noop;
}

export function baseDiagnostics(overrides: Record<string, unknown> = {}) {
	return {
		paused: true,
		manifestChannels: 2,
		manifestSampleRate: 44100,
		contextSampleRate: 44100,
		maxEncodedChunks: 64,
		encodedChunkCount: 2,
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
		...overrides,
	};
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
		getDiagnostics: vi.fn(() => baseDiagnostics()),
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

export const serverStatusMessage = {
	type: 'serverStatus' as const,
	status: {
		state: 'listening',
		port: 8765,
		localUrl: 'http://127.0.0.1:8765',
		externalUrl: 'https://abc.vscode-cdn.net:8765',
		urlForwarded: true,
		registeredAudioCount: 1,
		startedAt: 1700000000000,
		ffmpeg: { available: true, path: '/usr/bin/ffmpeg', version: 'ffmpeg 7.1', encodeFormat: 'ogg' },
		hostReachable: { ok: true, httpStatus: 200, elapsedMs: 12, checkedAt: 1700000000000 },
	},
};

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
