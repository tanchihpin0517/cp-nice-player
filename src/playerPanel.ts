import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	getChunkBufferCount,
	getChunkDurationSec,
	getPlaybackFormat,
	getPlaybackOggQuality,
	PlaybackFormat,
} from './config';
import { FfmpegCheckResult } from './ffmpeg';
import { isSupportedAudio } from './mediaTypes';
import { PlaybackService } from './playback/playbackService';
import { getStreamCacheDir } from './playback/streamCache';

export { isSupportedAudio, MEDIA_FILE_FILTERS } from './mediaTypes';

interface LoadMediaMessage {
	type: 'loadMedia';
	name: string;
	serverUrl: string;
	audioId: string;
	debug: {
		fsPath: string;
		playbackFormat: PlaybackFormat;
		playbackOggQuality: number;
		chunkDurationSec: number;
		chunkBufferCount: number;
		ffmpeg: {
			available: boolean;
			path: string;
			version?: string;
			error?: string;
		};
	};
}

export class MediaPlayerSession implements vscode.Disposable {
	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly resourceRoots: vscode.Uri[];
	private readonly extensionUri: vscode.Uri;
	private readonly context: vscode.ExtensionContext;
	private readonly playbackService: PlaybackService;
	private currentMedia: vscode.Uri | undefined;
	private currentFfmpeg: FfmpegCheckResult | undefined;
	private currentAudioId: string | undefined;
	private loadGeneration = 0;

	constructor(
		panel: vscode.WebviewPanel,
		extensionUri: vscode.Uri,
		resourceRoots: vscode.Uri[],
		context: vscode.ExtensionContext,
		playbackService: PlaybackService,
	) {
		this.panel = panel;
		this.extensionUri = extensionUri;
		this.resourceRoots = resourceRoots;
		this.context = context;
		this.playbackService = playbackService;
		this.panel.webview.html = this.getHtml(this.panel.webview);

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
		const audioId = await server.registerAudio(mediaUri.fsPath, ffmpeg);
		if (generation !== this.loadGeneration) {
			server.unregisterAudio(audioId);
			return;
		}

		this.currentAudioId = audioId;
		this.postMedia(mediaUri, ffmpeg, audioId);
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

	private getHtml(webview: vscode.Webview): string {
		const templatePath = vscode.Uri.joinPath(this.extensionUri, 'media', 'player.html');
		const template = fs.readFileSync(templatePath.fsPath, 'utf8');
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'player.css'));
		const engineScriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'streamingAudioEngine.js'),
		);
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'player.js'));

		return template
			.replaceAll('{{cspSource}}', webview.cspSource)
			.replaceAll('{{styleUri}}', styleUri.toString())
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
