import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { PlaybackService } from '../../playback/playbackService';
import { WebviewPlayerSession } from '../../playerPanel/playerSession';
import { createMockWebviewPanel } from '../helpers/mockWebviewPanel';

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
	let originalShowError: typeof vscode.window.showErrorMessage;

	setup(() => {
		registeredAudioIds = [];
		showErrorMessages = [];
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

	test('loadMedia when FFmpeg unavailable shows error and does not post', async () => {
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
		assert.strictEqual(postedMessages.length, 0);
		assert.ok(showErrorMessages.some((msg) => msg.includes('ffmpeg missing')));
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
