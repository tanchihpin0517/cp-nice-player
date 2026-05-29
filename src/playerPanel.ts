import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FfmpegCheckResult } from './ffmpeg';

export type MediaType = 'audio' | 'video';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv']);

export function getMediaType(uri: vscode.Uri): MediaType | undefined {
	const extension = uri.path.slice(uri.path.lastIndexOf('.')).toLowerCase();
	if (AUDIO_EXTENSIONS.has(extension)) {
		return 'audio';
	}
	if (VIDEO_EXTENSIONS.has(extension)) {
		return 'video';
	}
	return undefined;
}

export const MEDIA_FILE_FILTERS: Record<string, string[]> = {
	'Audio': ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'],
	'Video': ['mp4', 'webm', 'mov', 'mkv'],
};

interface LoadMediaMessage {
	type: 'loadMedia';
	name: string;
	source: string;
	mediaType: MediaType;
	debug: {
		fsPath: string;
		scheme: string;
		resourceRoots: string[];
		ffmpeg: {
			available: boolean;
			path: string;
			version?: string;
		};
	};
}

export class MediaPlayerPanel {
	private static currentPanel: MediaPlayerPanel | undefined;

	static createOrShow(extensionUri: vscode.Uri, mediaUri: vscode.Uri): MediaPlayerPanel {
		const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
		const resourceRoots = getResourceRoots(extensionUri, mediaUri);

		if (MediaPlayerPanel.currentPanel) {
			if (!rootsCoverMedia(MediaPlayerPanel.currentPanel.resourceRoots, mediaUri)) {
				MediaPlayerPanel.currentPanel.dispose();
				MediaPlayerPanel.currentPanel = undefined;
			} else {
				MediaPlayerPanel.currentPanel.panel.reveal(column);
				return MediaPlayerPanel.currentPanel;
			}
		}

		const panel = vscode.window.createWebviewPanel(
			'cpNicePlayer',
			'CP Nice Player',
			column,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: resourceRoots,
			},
		);

		MediaPlayerPanel.currentPanel = new MediaPlayerPanel(panel, resourceRoots, extensionUri);
		return MediaPlayerPanel.currentPanel;
	}

	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly resourceRoots: vscode.Uri[];
	private readonly extensionUri: vscode.Uri;
	private currentMedia: vscode.Uri | undefined;
	private currentFfmpeg: FfmpegCheckResult | undefined;

	private constructor(panel: vscode.WebviewPanel, resourceRoots: vscode.Uri[], extensionUri: vscode.Uri) {
		this.panel = panel;
		this.resourceRoots = resourceRoots;
		this.extensionUri = extensionUri;
		this.panel.webview.html = this.getHtml(this.panel.webview);

		this.panel.webview.onDidReceiveMessage((message) => {
			if (message?.type === 'ready' && this.currentMedia && this.currentFfmpeg) {
				this.postMedia(this.currentMedia, this.currentFfmpeg);
			}
		}, undefined, this.disposables);

		this.panel.onDidDispose(() => this.cleanup(), null, this.disposables);
	}

	loadMedia(mediaUri: vscode.Uri, ffmpeg: FfmpegCheckResult): void {
		this.currentMedia = mediaUri;
		this.currentFfmpeg = ffmpeg;
		this.postMedia(mediaUri, ffmpeg);
		this.panel.reveal(this.panel.viewColumn);
	}

	dispose(): void {
		this.panel.dispose();
	}

	private cleanup(): void {
		MediaPlayerPanel.currentPanel = undefined;
		while (this.disposables.length > 0) {
			const disposable = this.disposables.pop();
			disposable?.dispose();
		}
	}

	private postMedia(mediaUri: vscode.Uri, ffmpeg: FfmpegCheckResult): void {
		const mediaType = getMediaType(mediaUri);
		if (!mediaType) {
			return;
		}

		const message: LoadMediaMessage = {
			type: 'loadMedia',
			name: mediaUri.path.split('/').pop() ?? mediaUri.fsPath,
			source: this.panel.webview.asWebviewUri(mediaUri).toString(),
			mediaType,
			debug: {
				fsPath: mediaUri.fsPath,
				scheme: mediaUri.scheme,
				resourceRoots: this.resourceRoots.map((root) => root.fsPath),
				ffmpeg: {
					available: ffmpeg.available,
					path: ffmpeg.path,
					version: ffmpeg.version,
				},
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

function getResourceRoots(extensionUri: vscode.Uri, mediaUri?: vscode.Uri): vscode.Uri[] {
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

function rootsCoverMedia(roots: vscode.Uri[], mediaUri: vscode.Uri): boolean {
	const mediaPath = mediaUri.fsPath;
	return roots.some((root) => {
		const rootPath = root.fsPath;
		return mediaPath === rootPath || mediaPath.startsWith(`${rootPath}${path.sep}`);
	});
}
