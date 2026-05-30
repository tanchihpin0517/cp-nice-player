import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CacheFormat, getCacheFormat, getCacheOggQuality, UnsupportedPlayback } from './config';
import { FfmpegCheckResult } from './ffmpeg';
import { isSupportedAudio } from './mediaTypes';
import { ensureCachedAudio, getTranscodeDir } from './transcodeCache';

export { isSupportedAudio, MEDIA_FILE_FILTERS } from './mediaTypes';

type SourceKind = 'native' | 'cache';

interface LoadMediaMessage {
	type: 'loadMedia';
	name: string;
	source: string;
	debug: {
		fsPath: string;
		scheme: string;
		resourceRoots: string[];
		sourceKind: SourceKind;
		cacheFsPath?: string;
		cacheFileName?: string;
		cacheFormat: CacheFormat;
		cacheOggQuality: number;
		ffmpeg: {
			available: boolean;
			path: string;
			version?: string;
			error?: string;
		};
		unsupportedPlayback: UnsupportedPlayback;
		unsupportedPlaybackEnabled: boolean;
	};
}

interface PostMediaOptions {
	sourceKind?: SourceKind;
	playbackUri?: vscode.Uri;
	cacheFsPath?: string;
	cacheFileName?: string;
}

export class MediaPlayerSession implements vscode.Disposable {
	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly resourceRoots: vscode.Uri[];
	private readonly extensionUri: vscode.Uri;
	private readonly context: vscode.ExtensionContext;
	private currentMedia: vscode.Uri | undefined;
	private currentFfmpeg: FfmpegCheckResult | undefined;
	private currentUnsupportedPlayback: UnsupportedPlayback | undefined;
	private fallbackAttempted = false;
	private transcodeAbort: AbortController | undefined;

	constructor(
		panel: vscode.WebviewPanel,
		extensionUri: vscode.Uri,
		resourceRoots: vscode.Uri[],
		context: vscode.ExtensionContext,
	) {
		this.panel = panel;
		this.extensionUri = extensionUri;
		this.resourceRoots = resourceRoots;
		this.context = context;
		this.panel.webview.html = this.getHtml(this.panel.webview);

		this.panel.webview.onDidReceiveMessage((message) => {
			if (message?.type === 'ready' && this.currentMedia && this.currentFfmpeg && this.currentUnsupportedPlayback) {
				this.postMedia(this.currentMedia, this.currentFfmpeg, this.currentUnsupportedPlayback);
				return;
			}
			if (message?.type === 'nativePlaybackFailed') {
				void this.handleNativePlaybackFailed(message.code);
			}
		}, undefined, this.disposables);

		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
	}

	loadMedia(mediaUri: vscode.Uri, ffmpeg: FfmpegCheckResult, unsupportedPlayback: UnsupportedPlayback): void {
		this.currentMedia = mediaUri;
		this.currentFfmpeg = ffmpeg;
		this.currentUnsupportedPlayback = unsupportedPlayback;
		this.fallbackAttempted = false;
		this.postMedia(mediaUri, ffmpeg, unsupportedPlayback);
	}

	dispose(): void {
		this.transcodeAbort?.abort();
		this.transcodeAbort = undefined;
		while (this.disposables.length > 0) {
			const disposable = this.disposables.pop();
			disposable?.dispose();
		}
	}

	private async handleNativePlaybackFailed(code: number): Promise<void> {
		if (
			this.fallbackAttempted ||
			!this.currentMedia ||
			!this.currentFfmpeg ||
			!this.currentUnsupportedPlayback
		) {
			return;
		}

		if (this.currentUnsupportedPlayback !== 'cache') {
			return;
		}

		if (!this.currentFfmpeg.available) {
			return;
		}

		if (code !== 3 && code !== 4) {
			return;
		}

		this.fallbackAttempted = true;
		this.panel.webview.postMessage({ type: 'transcodeStatus', status: 'started' });

		this.transcodeAbort?.abort();
		this.transcodeAbort = new AbortController();

		try {
			const cached = await ensureCachedAudio(
				this.context,
				this.currentMedia,
				this.currentFfmpeg,
				this.transcodeAbort.signal,
			);

			this.postMedia(this.currentMedia, this.currentFfmpeg, this.currentUnsupportedPlayback, {
				sourceKind: 'cache',
				playbackUri: cached.uri,
				cacheFsPath: cached.fsPath,
				cacheFileName: cached.fileName,
			});
		} catch (err) {
			if (this.transcodeAbort.signal.aborted) {
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
			this.transcodeAbort = undefined;
		}
	}

	private postMedia(
		mediaUri: vscode.Uri,
		ffmpeg: FfmpegCheckResult,
		unsupportedPlayback: UnsupportedPlayback,
		options: PostMediaOptions = {},
	): void {
		if (!isSupportedAudio(mediaUri)) {
			return;
		}

		const sourceKind = options.sourceKind ?? 'native';
		const playbackUri = options.playbackUri ?? mediaUri;

		const message: LoadMediaMessage = {
			type: 'loadMedia',
			name: mediaUri.path.split('/').pop() ?? mediaUri.fsPath,
			source: this.panel.webview.asWebviewUri(playbackUri).toString(),
			debug: {
				fsPath: mediaUri.fsPath,
				scheme: mediaUri.scheme,
				resourceRoots: this.resourceRoots.map((root) => root.fsPath),
				sourceKind,
				cacheFsPath: options.cacheFsPath,
				cacheFileName: options.cacheFileName,
				cacheFormat: getCacheFormat(),
				cacheOggQuality: getCacheOggQuality(),
				ffmpeg: {
					available: ffmpeg.available,
					path: ffmpeg.path,
					version: ffmpeg.version,
					error: ffmpeg.error,
				},
				unsupportedPlayback,
				unsupportedPlaybackEnabled: ffmpeg.available,
			},
		};

		this.panel.webview.postMessage(message);
	}

	private getHtml(webview: vscode.Webview): string {
		const templatePath = vscode.Uri.joinPath(this.extensionUri, 'media', 'player.html');
		const template = fs.readFileSync(templatePath.fsPath, 'utf8');
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'player.css'));
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'player.js'));

		return template
			.replaceAll('{{cspSource}}', webview.cspSource)
			.replaceAll('{{styleUri}}', styleUri.toString())
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
