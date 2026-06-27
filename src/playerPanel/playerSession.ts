import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	getChunkBufferCount,
	getChunkDurationSec,
	getPlaybackFormat,
	getPlaybackOggQuality,
} from '../config';
import { FfmpegCheckResult } from '../ffmpegHost';
import { isSupportedAudio } from '../mediaTypes';
import { getStreamCacheDir } from '../playback/stream/cache';
import { PlaybackService } from '../playback/playbackService';
import { LoadMediaMessage, PlayerSession } from './types';

export class WebviewPlayerSession implements PlayerSession {
	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly extensionUri: vscode.Uri;
	private readonly playbackService: PlaybackService;
	private currentMedia: vscode.Uri | undefined;
	private currentFfmpeg: FfmpegCheckResult | undefined;
	private currentAudioId: string | undefined;
	private loadGeneration = 0;

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

		this.panel.webview.onDidReceiveMessage((message) => {
			if (
				message?.type === 'ready' &&
				this.currentMedia &&
				this.currentFfmpeg &&
				this.currentAudioId
			) {
				this.postMedia(this.currentMedia, this.currentFfmpeg, this.currentAudioId);
			}
		}, undefined, this.disposables);
	}

	loadMedia(mediaUri: vscode.Uri, ffmpeg: FfmpegCheckResult): void {
		this.currentMedia = mediaUri;
		this.currentFfmpeg = ffmpeg;
		void this.registerAndPost(mediaUri, ffmpeg);
	}

	dispose(): void {
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
			return;
		}

		try {
			await this.playbackService.ensureStarted();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			void vscode.window.showErrorMessage(`CP's Nice Player: ${message}`);
			return;
		}

		const server = this.playbackService.getServer();
		if (!server) {
			void vscode.window.showErrorMessage("CP's Nice Player: Playback server is not running.");
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
			this.postMedia(mediaUri, ffmpeg, audioId);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			void vscode.window.showErrorMessage(`CP's Nice Player: ${message}`);
		}
	}

	private postMedia(
		mediaUri: vscode.Uri,
		ffmpeg: FfmpegCheckResult,
		audioId: string,
	): void {
		if (!isSupportedAudio(mediaUri)) {
			return;
		}

		const server = this.playbackService.getServer();
		const serverUrl = server?.getServerUrl();
		if (!serverUrl) {
			return;
		}

		const message: LoadMediaMessage = {
			type: 'loadMedia',
			name: mediaUri.path.split('/').pop() ?? mediaUri.fsPath,
			serverUrl,
			audioId,
			debug: {
				fsPath: mediaUri.fsPath,
				playbackFormat: getPlaybackFormat(),
				playbackOggQuality: getPlaybackOggQuality(),
				chunkDurationSec: getChunkDurationSec(),
				chunkBufferCount: getChunkBufferCount(),
				ffmpeg: {
					available: ffmpeg.available,
					path: ffmpeg.path,
					version: ffmpeg.version,
					error: ffmpeg.error,
				},
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
		const workletProcessorUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'engine', 'pcmWorkletProcessor.js'),
		);
		const engineScriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'engine', 'streamingAudioEngine.js'),
		);
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'player', 'player.js'),
		);

		this.panel.webview.html = template
			.replaceAll('{{cspSource}}', webview.cspSource)
			.replaceAll('{{styleUri}}', styleUri.toString())
			.replaceAll('{{pcmRingUri}}', pcmRingUri.toString())
			.replaceAll('{{workletSchedulerUri}}', workletSchedulerUri.toString())
			.replaceAll('{{workletProcessorUri}}', workletProcessorUri.toString())
			.replaceAll('{{engineScriptUri}}', engineScriptUri.toString())
			.replaceAll('{{scriptUri}}', scriptUri.toString());
	}
}

export function getResourceRoots(
	extensionUri: vscode.Uri,
	mediaUri?: vscode.Uri,
	context?: vscode.ExtensionContext,
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

	if (context) {
		const streamCacheDir = getStreamCacheDir(context);
		roots.set(streamCacheDir.toString(), streamCacheDir);
	}

	return [...roots.values()];
}
