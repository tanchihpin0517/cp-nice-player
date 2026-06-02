import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getPlaybackFormat, getPlaybackOggQuality, PlaybackFormat } from './config';
import { FfmpegCheckResult } from './ffmpeg';
import { isSupportedAudio } from './mediaTypes';
import { PlaybackService } from './playback/playbackService';
import { getTranscodeDir } from './playback/transcode';

export { isSupportedAudio, MEDIA_FILE_FILTERS } from './mediaTypes';

type PlaybackCodec = 'flac' | 'ogg';

interface LoadMediaMessage {
	type: 'loadMedia';
	name: string;
	source: string;
	debug: {
		fsPath: string;
		scheme: string;
		resourceRoots: string[];
		transcodedFsPath?: string;
		transcodedFileName?: string;
		playbackFormat: PlaybackFormat;
		playbackOggQuality: number;
		playbackCodec: PlaybackCodec;
		contentType?: string;
		ffmpeg: {
			available: boolean;
			path: string;
			version?: string;
			error?: string;
		};
	};
}

interface PreparedPlayback {
	playbackUrl: string;
	transcodedFsPath: string;
	transcodedFileName: string;
}

function playbackCodecForFormat(format: PlaybackFormat): PlaybackCodec {
	return format === 'flac' ? 'flac' : 'ogg';
}

function codecToContentType(codec: PlaybackCodec): string {
	return codec === 'flac' ? 'audio/flac' : 'audio/ogg';
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
	private lastPrepared: PreparedPlayback | undefined;
	private transcodeAbort: AbortController | undefined;
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
			if (message?.type === 'ready' && this.currentMedia && this.currentFfmpeg && this.lastPrepared) {
				this.postMedia(this.currentMedia, this.currentFfmpeg, this.lastPrepared);
			}
		}, undefined, this.disposables);
	}

	loadMedia(mediaUri: vscode.Uri, ffmpeg: FfmpegCheckResult): void {
		this.currentMedia = mediaUri;
		this.currentFfmpeg = ffmpeg;
		this.lastPrepared = undefined;
		void this.prepareAndPlay(mediaUri, ffmpeg);
	}

	dispose(): void {
		this.transcodeAbort?.abort();
		this.transcodeAbort = undefined;
		while (this.disposables.length > 0) {
			const disposable = this.disposables.pop();
			disposable?.dispose();
		}
	}

	private async prepareAndPlay(mediaUri: vscode.Uri, ffmpeg: FfmpegCheckResult): Promise<void> {
		const generation = ++this.loadGeneration;

		this.transcodeAbort?.abort();
		this.transcodeAbort = new AbortController();
		const signal = this.transcodeAbort.signal;

		this.panel.webview.postMessage({ type: 'transcodeStatus', status: 'started' });

		if (!ffmpeg.available) {
			const message = ffmpeg.error ?? 'FFmpeg is not available.';
			this.panel.webview.postMessage({
				type: 'transcodeStatus',
				status: 'failed',
				error: message,
			});
			void vscode.window.showErrorMessage(`CP's Nice Player: ${message}`);
			return;
		}

		const server = this.playbackService.getServer();
		if (!server) {
			const message = 'Playback server is not running.';
			this.panel.webview.postMessage({
				type: 'transcodeStatus',
				status: 'failed',
				error: message,
			});
			return;
		}

		try {
			const prepared = await server.preparePlayback(mediaUri, ffmpeg, signal);
			if (generation !== this.loadGeneration || signal.aborted) {
				return;
			}

			const playback: PreparedPlayback = {
				playbackUrl: prepared.playbackUrl,
				transcodedFsPath: prepared.transcodedFsPath,
				transcodedFileName: prepared.transcodedFileName,
			};
			this.lastPrepared = playback;
			this.postMedia(mediaUri, ffmpeg, playback);
		} catch (err) {
			if (generation !== this.loadGeneration || signal.aborted) {
				return;
			}
			const message = err instanceof Error ? err.message : String(err);
			this.panel.webview.postMessage({
				type: 'transcodeStatus',
				status: 'failed',
				error: message,
			});
			void vscode.window.showErrorMessage(`CP's Nice Player: transcode failed. ${message}`);
		} finally {
			if (generation === this.loadGeneration) {
				this.transcodeAbort = undefined;
			}
		}
	}

	private postMedia(
		mediaUri: vscode.Uri,
		ffmpeg: FfmpegCheckResult,
		prepared: PreparedPlayback,
	): void {
		if (!isSupportedAudio(mediaUri)) {
			return;
		}

		const playbackFormat = getPlaybackFormat();
		const playbackCodec = playbackCodecForFormat(playbackFormat);

		const message: LoadMediaMessage = {
			type: 'loadMedia',
			name: mediaUri.path.split('/').pop() ?? mediaUri.fsPath,
			source: prepared.playbackUrl,
			debug: {
				fsPath: mediaUri.fsPath,
				scheme: mediaUri.scheme,
				resourceRoots: this.resourceRoots.map((root) => root.fsPath),
				transcodedFsPath: prepared.transcodedFsPath,
				transcodedFileName: prepared.transcodedFileName,
				playbackFormat,
				playbackOggQuality: getPlaybackOggQuality(),
				playbackCodec,
				contentType: codecToContentType(playbackCodec),
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
		const audioEngineUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'audioEngine.js'));
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'player.js'));

		return template
			.replaceAll('{{cspSource}}', webview.cspSource)
			.replaceAll('{{styleUri}}', styleUri.toString())
			.replaceAll('{{audioEngineUri}}', audioEngineUri.toString())
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
		const transcodeDir = getTranscodeDir(context);
		roots.set(transcodeDir.toString(), transcodeDir);
	}

	return [...roots.values()];
}
