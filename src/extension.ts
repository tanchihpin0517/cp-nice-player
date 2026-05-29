import * as vscode from 'vscode';
import { checkFfmpegAvailable } from './ffmpeg';
import { getMediaType, MEDIA_FILE_FILTERS, MediaPlayerPanel } from './playerPanel';

export function activate(context: vscode.ExtensionContext) {
	const openCommand = vscode.commands.registerCommand(
		'cp-nice-player.open',
		async (uri?: vscode.Uri) => {
			let mediaUri = uri;

			if (!mediaUri) {
				const selected = await vscode.window.showOpenDialog({
					canSelectMany: false,
					openLabel: 'Open in CP Nice Player',
					filters: MEDIA_FILE_FILTERS,
				});
				mediaUri = selected?.[0];
			}

			if (!mediaUri) {
				return;
			}

			if (!getMediaType(mediaUri)) {
				void vscode.window.showErrorMessage(
					'CP Nice Player does not support this file type.',
				);
				return;
			}

			const ffmpeg = await checkFfmpegAvailable();
			if (!ffmpeg.available) {
				void vscode.window.showErrorMessage(
					`CP Nice Player requires FFmpeg. ${ffmpeg.error ?? 'Install ffmpeg and ensure it is on your PATH.'}`,
				);
				return;
			}

			const panel = MediaPlayerPanel.createOrShow(context.extensionUri, mediaUri);
			panel.loadMedia(mediaUri, ffmpeg);
		},
	);

	context.subscriptions.push(openCommand);
}

export function deactivate() {}
