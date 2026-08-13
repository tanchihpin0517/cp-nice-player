import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	getChunkBufferCount,
	getChunkDurationSec,
	getMaxEncodedChunks,
	getPlaybackOggQuality,
} from '../config';
import { EncodeFormat } from '../encodeFormat';
import { FfmpegCheckResult, getEffectiveEncodeFormat } from '../ffmpegHost';
import { isSupportedAudio } from '../mediaTypes';
import { PlaybackService } from '../playback/playbackService';
import { PlaybackServerStatus } from '../playback/serverStatus';
import { PlayerSession } from './types';

interface LoadMediaMessage {
	type: 'loadMedia';
	name: string;
	serverUrl: string;
	audioId: string;
	debug: {
		fsPath: string;
		playbackFormat: EncodeFormat;
		playbackOggQuality: number;
		chunkDurationSec: number;
		chunkBufferCount: number;
		maxEncodedChunks: number;
	};
}

interface ServerStatusMessage {
	type: 'serverStatus';
	status: PlaybackServerStatus;
}

interface WebviewMessage {
	type?: string;
	message?: string;
}

export class WebviewPlayerSession implements PlayerSession {
	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly extensionUri: vscode.Uri;
	private readonly playbackService: PlaybackService;
	private currentMedia: vscode.Uri | undefined;
	private currentFfmpeg: FfmpegCheckResult | undefined;
	private currentAudioId: string | undefined;
	private loadGeneration = 0;
	private restarting = false;
	private disposed = false;

	constructor(
		panel: vscode.WebviewPanel,
		extensionUri: vscode.Uri,
		_resourceRoots: vscode.Uri[],
		_context: vscode.ExtensionContext,
		playbackService: PlaybackService,
	) {
		this.panel = panel;
		this.extensionUri = extensionUri;
		this.playbackService = playbackService;

		void this.loadHtml(this.panel.webview);

		this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
			this.handleWebviewMessage(message);
		}, undefined, this.disposables);
	}

	private handleWebviewMessage(message: WebviewMessage): void {
		switch (message?.type) {
			case 'ready':
				if (this.currentMedia && this.currentFfmpeg && this.currentAudioId) {
					this.postMedia(this.currentMedia, this.currentAudioId);
				}
				void this.postServerStatus();
				return;

			case 'requestServerStatus':
				void this.postServerStatus();
				return;

			// The webview could not reach the server. Answer with a freshly probed status so the
			// player can tell a dead server from one it simply cannot reach.
			case 'streamError':
				void this.postServerStatus(message.message);
				return;

			case 'restartServer':
				void this.restartServer();
				return;

			default:
				return;
		}
	}

	loadMedia(mediaUri: vscode.Uri, ffmpeg: FfmpegCheckResult): void {
		this.currentMedia = mediaUri;
		this.currentFfmpeg = ffmpeg;
		void this.registerAndPost(mediaUri, ffmpeg);
	}

	/**
	 * Reports server state over the webview message channel, which is independent of the HTTP
	 * playback server — so this still arrives when the player's own fetches are failing.
	 * `latestError` takes precedence over the server's recorded error: it is the more recent and
	 * more specific failure (a failed registration, or an error the webview just reported).
	 */
	private async postServerStatus(latestError?: string): Promise<void> {
		if (this.disposed) {
			return;
		}

		try {
			const status = await this.playbackService.getStatus();
			if (this.disposed) {
				return;
			}

			const message: ServerStatusMessage = {
				type: 'serverStatus',
				status: latestError ? { ...status, lastError: latestError } : status,
			};
			this.panel.webview.postMessage(message);
		} catch (err) {
			console.error('cp-nice-player: failed to collect playback server status', err);
		}
	}

	private async restartServer(): Promise<void> {
		if (this.restarting || this.disposed) {
			return;
		}

		this.restarting = true;
		try {
			// The old registry is cleared by the restart, so the current audioId is already stale.
			this.currentAudioId = undefined;
			await this.playbackService.restart();

			if (this.disposed) {
				return;
			}

			if (this.currentMedia && this.currentFfmpeg) {
				await this.registerAndPost(this.currentMedia, this.currentFfmpeg);
			} else {
				await this.postServerStatus();
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			void vscode.window.showErrorMessage(`CP's Nice Player: ${message}`);
			await this.postServerStatus(message);
		} finally {
			this.restarting = false;
		}
	}

	dispose(): void {
		this.disposed = true;
		this.unregisterCurrentAudio();
		while (this.disposables.length > 0) {
			const disposable = this.disposables.pop();
			disposable?.dispose();
		}
	}

	private unregisterCurrentAudio(): void {
		if (!this.currentAudioId) {
			return;
		}

		const server = this.playbackService.getServer();
		server?.unregisterAudio(this.currentAudioId);
		this.currentAudioId = undefined;
	}

	private async registerAndPost(mediaUri: vscode.Uri, ffmpeg: FfmpegCheckResult): Promise<void> {
		const generation = ++this.loadGeneration;

		if (!ffmpeg.available) {
			const message = ffmpeg.error ?? 'FFmpeg is not available.';
			void vscode.window.showErrorMessage(`CP's Nice Player: ${message}`);
			await this.postServerStatus(message);
			return;
		}

		try {
			await this.playbackService.ensureStarted();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			void vscode.window.showErrorMessage(`CP's Nice Player: ${message}`);
			await this.postServerStatus(message);
			return;
		}

		const server = this.playbackService.getServer();
		if (!server) {
			const message = 'Playback server is not running.';
			void vscode.window.showErrorMessage(`CP's Nice Player: ${message}`);
			await this.postServerStatus(message);
			return;
		}

		this.unregisterCurrentAudio();
		try {
			const { audioId } = await server.registerAudio(mediaUri.fsPath, ffmpeg);
			if (generation !== this.loadGeneration) {
				server.unregisterAudio(audioId);
				return;
			}

			this.currentAudioId = audioId;
			this.postMedia(mediaUri, audioId);
			await this.postServerStatus();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			void vscode.window.showErrorMessage(`CP's Nice Player: ${message}`);
			await this.postServerStatus(message);
		}
	}

	private postMedia(
		mediaUri: vscode.Uri,
		audioId: string,
	): void {
		if (!isSupportedAudio(mediaUri)) {
			return;
		}

		const server = this.playbackService.getServer();
		const serverUrl = server?.getServerUrl();
		if (!serverUrl) {
			void this.postServerStatus('Playback server has no reachable URL yet.');
			return;
		}

		const message: LoadMediaMessage = {
			type: 'loadMedia',
			name: mediaUri.path.split('/').pop() ?? mediaUri.fsPath,
			serverUrl,
			audioId,
			debug: {
				fsPath: mediaUri.fsPath,
				playbackFormat: getEffectiveEncodeFormat(),
				playbackOggQuality: getPlaybackOggQuality(),
				chunkDurationSec: getChunkDurationSec(),
				chunkBufferCount: getChunkBufferCount(),
				maxEncodedChunks: getMaxEncodedChunks(),
			},
		};

		this.panel.webview.postMessage(message);
	}

	private async loadHtml(webview: vscode.Webview): Promise<void> {
		const templatePath = vscode.Uri.joinPath(
			this.extensionUri,
			'media',
			'player',
			'player.html',
		);
		const template = await fs.readFile(templatePath.fsPath, 'utf8');
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'player', 'player.css'),
		);
		const pcmRingUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'engine', 'pcmRing.js'),
		);
		const workletSchedulerUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'engine', 'workletScheduler.js'),
		);
		const lruMapUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'engine', 'lruMap.js'),
		);
		const chunkUtilsUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'engine', 'chunkUtils.js'),
		);
		const crossfadeUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'engine', 'crossfade.js'),
		);
		const workletProcessorUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'engine', 'pcmWorkletProcessor.js'),
		);
		const engineScriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'engine', 'streamingAudioEngine.js'),
		);
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'player', 'player.js'),
		);
		const formatUtilsUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'player', 'formatUtils.js'),
		);
		const waveformUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'player', 'waveform.js'),
		);
		const playerViewUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'player', 'playerView.js'),
		);

		this.panel.webview.html = template
			.replaceAll('{{cspSource}}', webview.cspSource)
			.replaceAll('{{styleUri}}', styleUri.toString())
			.replaceAll('{{pcmRingUri}}', pcmRingUri.toString())
			.replaceAll('{{workletSchedulerUri}}', workletSchedulerUri.toString())
			.replaceAll('{{lruMapUri}}', lruMapUri.toString())
			.replaceAll('{{chunkUtilsUri}}', chunkUtilsUri.toString())
			.replaceAll('{{crossfadeUri}}', crossfadeUri.toString())
			.replaceAll('{{workletProcessorUri}}', workletProcessorUri.toString())
			.replaceAll('{{engineScriptUri}}', engineScriptUri.toString())
			.replaceAll('{{formatUtilsUri}}', formatUtilsUri.toString())
			.replaceAll('{{waveformUri}}', waveformUri.toString())
			.replaceAll('{{playerViewUri}}', playerViewUri.toString())
			.replaceAll('{{scriptUri}}', scriptUri.toString());
	}
}

export function getResourceRoots(
	extensionUri: vscode.Uri,
	mediaUri?: vscode.Uri,
): vscode.Uri[] {
	const roots = new Map<string, vscode.Uri>();
	roots.set(extensionUri.toString(), extensionUri);

	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		roots.set(folder.uri.toString(), folder.uri);
	}

	if (mediaUri) {
		const mediaDirectory = vscode.Uri.file(path.dirname(mediaUri.fsPath));
		roots.set(mediaDirectory.toString(), mediaDirectory);
	}

	return [...roots.values()];
}
