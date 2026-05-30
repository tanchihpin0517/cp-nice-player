import * as vscode from 'vscode';
import { getUnsupportedPlayback } from './config';
import { checkFfmpegAvailable } from './ffmpeg';
import { getResourceRoots, MediaPlayerSession } from './playerPanel';

export const MEDIA_EDITOR_VIEW_TYPE = 'cpNicePlayer.mediaPreview';

interface MediaCustomDocument extends vscode.CustomDocument {
	readonly uri: vscode.Uri;
}

export class MediaEditorProvider implements vscode.CustomReadonlyEditorProvider<MediaCustomDocument> {
	constructor(private readonly context: vscode.ExtensionContext) {}

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
		const resourceRoots = getResourceRoots(
			this.context.extensionUri,
			document.uri,
			this.context,
		);
		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: resourceRoots,
		};

		const session = new MediaPlayerSession(
			webviewPanel,
			this.context.extensionUri,
			resourceRoots,
			this.context,
		);

		const ffmpeg = await checkFfmpegAvailable();
		session.loadMedia(document.uri, ffmpeg, getUnsupportedPlayback());
	}
}
