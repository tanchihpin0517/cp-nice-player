import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { UnsupportedPlayback } from './config';
import { FfmpegCheckResult } from './ffmpeg';
import { isSupportedAudio } from './mediaTypes';

export { isSupportedAudio, MEDIA_FILE_FILTERS } from './mediaTypes';

interface LoadMediaMessage {
	type: 'loadMedia';
	name: string;
	source: string;
	debug: {
		fsPath: string;
		scheme: string;
		resourceRoots: string[];
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

export class MediaPlayerSession implements vscode.Disposable {
	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly resourceRoots: vscode.Uri[];
	private readonly extensionUri: vscode.Uri;
	private currentMedia: vscode.Uri | undefined;
	private currentFfmpeg: FfmpegCheckResult | undefined;
	private currentUnsupportedPlayback: UnsupportedPlayback | undefined;

	constructor(
		panel: vscode.WebviewPanel,
		extensionUri: vscode.Uri,
		resourceRoots: vscode.Uri[],
	) {
		this.panel = panel;
		this.extensionUri = extensionUri;
		this.resourceRoots = resourceRoots;
		this.panel.webview.html = this.getHtml(this.panel.webview);

		this.panel.webview.onDidReceiveMessage((message) => {
			if (message?.type === 'ready' && this.currentMedia && this.currentFfmpeg && this.currentUnsupportedPlayback) {
				this.postMedia(this.currentMedia, this.currentFfmpeg, this.currentUnsupportedPlayback);
			}
		}, undefined, this.disposables);

		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
	}

	loadMedia(mediaUri: vscode.Uri, ffmpeg: FfmpegCheckResult, unsupportedPlayback: UnsupportedPlayback): void {
		this.currentMedia = mediaUri;
		this.currentFfmpeg = ffmpeg;
		this.currentUnsupportedPlayback = unsupportedPlayback;
		this.postMedia(mediaUri, ffmpeg, unsupportedPlayback);
	}

	dispose(): void {
		while (this.disposables.length > 0) {
			const disposable = this.disposables.pop();
			disposable?.dispose();
		}
	}

	private postMedia(mediaUri: vscode.Uri, ffmpeg: FfmpegCheckResult, unsupportedPlayback: UnsupportedPlayback): void {
		if (!isSupportedAudio(mediaUri)) {
			return;
		}

		const message: LoadMediaMessage = {
			type: 'loadMedia',
			name: mediaUri.path.split('/').pop() ?? mediaUri.fsPath,
			source: this.panel.webview.asWebviewUri(mediaUri).toString(),
			debug: {
				fsPath: mediaUri.fsPath,
				scheme: mediaUri.scheme,
				resourceRoots: this.resourceRoots.map((root) => root.fsPath),
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

export function getResourceRoots(extensionUri: vscode.Uri, mediaUri?: vscode.Uri): vscode.Uri[] {
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
