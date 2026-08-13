import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Boots the webview the way VS Code does: the real player.html markup, then every
 * script evaluated in one shared global scope, in order.
 *
 * The other media tests import these files as ES modules, which gives each its
 * own scope and hides anything that only breaks when they share one — a
 * duplicate top-level `const`, a global read before the file that defines it, an
 * id that no longer exists in the markup. Indirect eval reproduces classic
 * <script> semantics, so those surface here.
 */

const ROOT = join(__dirname, '..', '..', '..');

const SCRIPTS = [
	'media/engine/pcmRing.js',
	'media/engine/workletScheduler.js',
	'media/engine/lruMap.js',
	'media/engine/chunkUtils.js',
	'media/engine/crossfade.js',
	'media/engine/streamingAudioEngine.js',
	'media/player/formatUtils.js',
	'media/player/waveform.js',
	'media/player/playerView.js',
	'media/player/player.js',
];

const vscodeStub = {
	postMessage: vi.fn(),
	getState: vi.fn(() => null),
	setState: vi.fn(),
};

describe('webview boot', () => {
	let bootError: unknown;

	beforeAll(() => {
		const scope = globalThis as Record<string, unknown>;
		scope.ResizeObserver = class {
			observe() { /* jsdom does no layout */ }
			disconnect() { /* jsdom does no layout */ }
		};
		scope.acquireVsCodeApi = () => vscodeStub;
		scope.AudioContext = class { };
		const noop = () => undefined;
		const context = new Proxy({}, { get: () => noop, set: () => true });
		HTMLCanvasElement.prototype.getContext = (() => context) as unknown as
			HTMLCanvasElement['getContext'];

		const html = readFileSync(join(ROOT, 'media', 'player', 'player.html'), 'utf8');
		const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));

		document.head.innerHTML =
			'<meta name="cp-worklet-module-url" content="https://test.example/worklet.js">';
		// Scripts are run below by hand; the tags themselves are inert here.
		document.body.innerHTML = body.replace(/<script[^>]*><\/script>/g, '');

		// Evaluated as one unit on purpose. Separate evals would each get their own
		// scope for top-level const/let, which is exactly the isolation the webview
		// does NOT have — concatenating reproduces the shared scope, so a name
		// declared by two files fails to parse here just as it does in the browser.
		const source = SCRIPTS
			.map((relativePath) => readFileSync(join(ROOT, relativePath), 'utf8'))
			.join('\n;\n');

		try {
			(0, eval)(source);
		} catch (error) {
			bootError = error;
		}
	});

	it('loads every script into one shared scope without collisions', () => {
		expect(bootError).toBeUndefined();
	});

	it('wires the player up and tells the extension it is ready', () => {
		expect(vscodeStub.postMessage).toHaveBeenCalledWith({ type: 'ready' });
	});

	it('starts in the empty state with the transport disabled', () => {
		const player = document.getElementById('player');
		expect(player?.dataset.state).toBe('empty');
		expect((document.getElementById('playPause') as HTMLButtonElement).disabled).toBe(true);
		expect((document.getElementById('volume') as HTMLInputElement).disabled).toBe(true);
	});

	it('renders the server panel before any status has arrived', () => {
		// Every element playerView.js looks up has to exist in the real markup;
		// a renamed id would leave this empty or throw during boot.
		expect(document.getElementById('serverGrid')?.innerHTML).toContain('unknown');
		expect(document.getElementById('playbackGrid')?.innerHTML).toContain('no media loaded');
	});

	it('keeps the inspector closed until asked', () => {
		expect((document.getElementById('inspector') as HTMLElement).hidden).toBe(true);
	});
});
