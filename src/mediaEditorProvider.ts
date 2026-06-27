import * as vscode from 'vscode';
import { checkFfmpegAvailable } from './ffmpegHost';
import { PlaybackService } from './playback/playbackService';
import { getResourceRoots, createPlayerSession } from './playerPanel';

export const MEDIA_EDITOR_VIEW_TYPE = 'cpNicePlayer.mediaPreview';

interface MediaCustomDocument extends vscode.CustomDocument {
	readonly uri: vscode.Uri;
}

export class MediaEditorProvider implements vscode.CustomReadonlyEditorProvider<MediaCustomDocument> {
	private readonly sessions = new WeakMap<vscode.WebviewPanel, ReturnType<typeof createPlayerSession>>();

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly playbackService: PlaybackService,
	) {}

	openCustomDocument(
		uri: vscode.Uri,
		_openContext: vscode.CustomDocumentOpenContext,
		_token: vscode.CancellationToken,
	): MediaCustomDocument {
		return {
			uri,
			dispose() {},
		};
	}

	async resolveCustomEditor(
		document: MediaCustomDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken,
	): Promise<void> {
		const existing = this.sessions.get(webviewPanel);
		existing?.dispose();

		const resourceRoots = getResourceRoots(
			this.context.extensionUri,
			document.uri,
			this.context,
		);
		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: resourceRoots,
		};

		const session = createPlayerSession(
			webviewPanel,
			this.context.extensionUri,
			resourceRoots,
			this.context,
			this.playbackService,
		);
		this.sessions.set(webviewPanel, session);

		webviewPanel.onDidDispose(() => {
			const current = this.sessions.get(webviewPanel);
			if (current === session) {
				current.dispose();
				this.sessions.delete(webviewPanel);
			}
		});

		const ffmpeg = await checkFfmpegAvailable();
		void session.loadMedia(document.uri, ffmpeg);
	}
}
