import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { PlaybackService } from '../../playback/playbackService';
import { PlaybackServerStatus } from '../../playback/serverStatus';
import { WebviewPlayerSession } from '../../playerPanel/playerSession';
import { createMockWebviewPanel } from '../helpers/mockWebviewPanel';

function statusMessages(postedMessages: unknown[]): { status: PlaybackServerStatus }[] {
	return postedMessages.filter(
		(message) => (message as { type?: string }).type === 'serverStatus',
	) as { status: PlaybackServerStatus }[];
}

suite('WebviewPlayerSession', () => {
	const extensionUri = vscode.Uri.file(path.resolve(__dirname, '../../..'));
	let playbackService: PlaybackService;
	let mockServer: {
		registerAudio: (fsPath: string, ffmpeg: { available: boolean; path: string }) => Promise<{ audioId: string }>;
		unregisterAudio: (audioId: string) => void;
		getServerUrl: () => string;
	};
	let registeredAudioIds: string[];
	let showErrorMessages: string[];
	let restartCount: number;
	let serverStatus: PlaybackServerStatus;
	let originalShowError: typeof vscode.window.showErrorMessage;

	setup(() => {
		registeredAudioIds = [];
		showErrorMessages = [];
		restartCount = 0;
		serverStatus = {
			state: 'listening',
			port: 54321,
			localUrl: 'http://127.0.0.1:54321',
			externalUrl: 'http://127.0.0.1:54321',
			urlForwarded: false,
			registeredAudioCount: 0,
			ffmpeg: { available: true, path: '/usr/bin/ffmpeg' },
			hostReachable: { ok: true, httpStatus: 200, elapsedMs: 3, checkedAt: 1 },
		};
		mockServer = {
			registerAudio: async (_fsPath: string) => {
				const audioId = 'a1b2c3d4';
				registeredAudioIds.push(audioId);
				return { audioId };
			},
			unregisterAudio: (audioId: string) => {
				const index = registeredAudioIds.indexOf(audioId);
				if (index >= 0) {
					registeredAudioIds.splice(index, 1);
				}
			},
			getServerUrl: () => 'http://127.0.0.1:54321',
		};

		playbackService = {
			ensureStarted: async () => undefined,
			getServer: () => mockServer,
			getStatus: async () => serverStatus,
			restart: async () => {
				restartCount += 1;
			},
		} as unknown as PlaybackService;

		originalShowError = vscode.window.showErrorMessage;
		vscode.window.showErrorMessage = async (message: string) => {
			showErrorMessages.push(message);
			return undefined;
		};
	});

	teardown(() => {
		vscode.window.showErrorMessage = originalShowError;
	});

	test('loadMedia when FFmpeg unavailable shows error and reports it as server status', async () => {
		const { panel, postedMessages } = createMockWebviewPanel(extensionUri);
		const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
		const session = new WebviewPlayerSession(
			panel,
			extensionUri,
			[extensionUri],
			context,
			playbackService,
		);

		const mediaUri = vscode.Uri.file('/tmp/test.mp3');
		session.loadMedia(mediaUri, { available: false, path: '', error: 'ffmpeg missing' });

		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.strictEqual(
			postedMessages.filter((message) => (message as { type?: string }).type === 'loadMedia').length,
			0,
		);
		assert.ok(showErrorMessages.some((msg) => msg.includes('ffmpeg missing')));

		const statuses = statusMessages(postedMessages);
		assert.strictEqual(statuses.length, 1);
		assert.strictEqual(statuses[0].status.lastError, 'ffmpeg missing');
		assert.strictEqual(statuses[0].status.state, 'listening');
		session.dispose();
	});

	test('reports server status when the server fails to start', async () => {
		playbackService = {
			ensureStarted: async () => {
				throw new Error('bind failed');
			},
			getServer: () => undefined,
			getStatus: async () => ({ ...serverStatus, state: 'failed', lastError: 'bind failed' }),
			restart: async () => undefined,
		} as unknown as PlaybackService;

		const { panel, postedMessages } = createMockWebviewPanel(extensionUri);
		const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
		const session = new WebviewPlayerSession(
			panel,
			extensionUri,
			[extensionUri],
			context,
			playbackService,
		);

		session.loadMedia(vscode.Uri.file('/tmp/test.mp3'), { available: true, path: '/usr/bin/ffmpeg' });

		await new Promise((resolve) => setTimeout(resolve, 50));
		const statuses = statusMessages(postedMessages);
		assert.strictEqual(statuses.length, 1);
		assert.strictEqual(statuses[0].status.state, 'failed');
		assert.strictEqual(statuses[0].status.lastError, 'bind failed');
		session.dispose();
	});

	test('responds to requestServerStatus and streamError from the webview', async () => {
		const { panel, postedMessages, receiveMessage } = createMockWebviewPanel(extensionUri);
		const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
		const session = new WebviewPlayerSession(
			panel,
			extensionUri,
			[extensionUri],
			context,
			playbackService,
		);

		receiveMessage({ type: 'requestServerStatus' });
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.strictEqual(statusMessages(postedMessages).length, 1);

		receiveMessage({ type: 'streamError', message: 'Failed to fetch' });
		await new Promise((resolve) => setTimeout(resolve, 50));
		const statuses = statusMessages(postedMessages);
		assert.strictEqual(statuses.length, 2);
		assert.strictEqual(statuses[1].status.lastError, 'Failed to fetch');
		session.dispose();
	});

	test('ready posts server status even with no media loaded', async () => {
		const { panel, postedMessages, receiveMessage } = createMockWebviewPanel(extensionUri);
		const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
		const session = new WebviewPlayerSession(
			panel,
			extensionUri,
			[extensionUri],
			context,
			playbackService,
		);

		receiveMessage({ type: 'ready' });
		await new Promise((resolve) => setTimeout(resolve, 50));

		assert.strictEqual(
			postedMessages.filter((message) => (message as { type?: string }).type === 'loadMedia').length,
			0,
		);
		assert.strictEqual(statusMessages(postedMessages).length, 1);
		session.dispose();
	});

	test('restartServer restarts the service and re-registers current media', async () => {
		const { panel, postedMessages, receiveMessage } = createMockWebviewPanel(extensionUri);
		const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
		const session = new WebviewPlayerSession(
			panel,
			extensionUri,
			[extensionUri],
			context,
			playbackService,
		);

		const mediaUri = vscode.Uri.file(path.join(__dirname, '../../../package.json.mp3'));
		session.loadMedia(mediaUri, { available: true, path: '/usr/bin/ffmpeg' });
		await new Promise((resolve) => setTimeout(resolve, 100));

		receiveMessage({ type: 'restartServer' });
		await new Promise((resolve) => setTimeout(resolve, 100));

		assert.strictEqual(restartCount, 1);
		assert.strictEqual(
			postedMessages.filter((message) => (message as { type?: string }).type === 'loadMedia').length,
			2,
		);
		assert.ok(statusMessages(postedMessages).length >= 2);
		session.dispose();
	});

	test('loadMedia registers audio and posts loadMedia message', async () => {
		const { panel, postedMessages, receiveMessage } = createMockWebviewPanel(extensionUri);
		const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
		const session = new WebviewPlayerSession(
			panel,
			extensionUri,
			[extensionUri],
			context,
			playbackService,
		);

		const mediaUri = vscode.Uri.file(path.join(__dirname, '../../../package.json.mp3'));
		session.loadMedia(mediaUri, { available: true, path: '/usr/bin/ffmpeg' });

		await new Promise((resolve) => setTimeout(resolve, 100));

		const loadMessages = postedMessages.filter(
			(message) => (message as { type?: string }).type === 'loadMedia',
		);
		assert.strictEqual(loadMessages.length, 1);
		const loadMessage = loadMessages[0] as {
			serverUrl: string;
			audioId: string;
			debug: { fsPath: string; chunkBufferCount: number };
		};
		assert.strictEqual(loadMessage.serverUrl, 'http://127.0.0.1:54321');
		assert.strictEqual(loadMessage.audioId, 'a1b2c3d4');
		assert.strictEqual(loadMessage.debug.fsPath, mediaUri.fsPath);
		assert.ok(loadMessage.debug.chunkBufferCount > 0);

		receiveMessage({ type: 'ready' });
		assert.strictEqual(
			postedMessages.filter((message) => (message as { type?: string }).type === 'loadMedia').length,
			2,
		);

		session.dispose();
		assert.strictEqual(registeredAudioIds.length, 0);
	});

	test('rapid loadMedia unregisters superseded audio', async () => {
		let registrationCount = 0;
		mockServer.registerAudio = async () => {
			registrationCount += 1;
			return { audioId: `id-${registrationCount}` };
		};
		mockServer.unregisterAudio = (audioId: string) => {
			registeredAudioIds = registeredAudioIds.filter((id) => id !== audioId);
		};
		const unregistered: string[] = [];
		const originalUnregister = mockServer.unregisterAudio;
		mockServer.unregisterAudio = (audioId: string) => {
			unregistered.push(audioId);
			originalUnregister(audioId);
		};

		const { panel, postedMessages } = createMockWebviewPanel(extensionUri);
		const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
		const session = new WebviewPlayerSession(
			panel,
			extensionUri,
			[extensionUri],
			context,
			playbackService,
		);

		const mediaUri = vscode.Uri.file(path.join(__dirname, '../../../package.json.mp3'));
		session.loadMedia(mediaUri, { available: true, path: '/usr/bin/ffmpeg' });
		session.loadMedia(mediaUri, { available: true, path: '/usr/bin/ffmpeg' });

		await new Promise((resolve) => setTimeout(resolve, 150));
		assert.ok(unregistered.includes('id-1'));
		assert.strictEqual(
			postedMessages.filter((message) => (message as { type?: string }).type === 'loadMedia').length,
			1,
		);
		session.dispose();
	});

	test('loadHtml substitutes CSP and script placeholders', async () => {
		const { panel } = createMockWebviewPanel(extensionUri);
		const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
		const session = new WebviewPlayerSession(
			panel,
			extensionUri,
			[extensionUri],
			context,
			playbackService,
		);

		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.ok(panel.webview.html.length > 0);
		assert.ok(!panel.webview.html.includes('{{cspSource}}'));
		assert.ok(!panel.webview.html.includes('{{scriptUri}}'));
		assert.ok(panel.webview.html.includes('vscode-webview:'));
		assert.ok(panel.webview.html.includes('chunkUtils'));
		assert.ok(panel.webview.html.includes('formatUtils'));
		session.dispose();
	});
});
