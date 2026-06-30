import * as vscode from 'vscode';

export type PlaybackFormat = 'ogg' | 'flac';

export function getPlaybackFormat(): PlaybackFormat {
	const value = vscode.workspace
		.getConfiguration('cp-nice-player')
		.get<PlaybackFormat>('playback.format', 'ogg');
	return value === 'flac' ? 'flac' : 'ogg';
}

export function getPlaybackOggQuality(): number {
	const value = vscode.workspace
		.getConfiguration('cp-nice-player')
		.get<number>('playback.oggQuality', 6);
	return Math.min(10, Math.max(0, Math.round(value)));
}

export function getChunkDurationSec(): number {
	const value = vscode.workspace
		.getConfiguration('cp-nice-player')
		.get<number>('playback.chunkDurationSec', 1);
	return Math.min(10, Math.max(0.5, value));
}

export function getCrossfadeMs(): number {
	const value = vscode.workspace
		.getConfiguration('cp-nice-player')
		.get<number>('playback.crossfadeMs', 50);
	return Math.min(500, Math.max(0, Math.round(value)));
}

export function getChunkBufferCount(): number {
	const value = vscode.workspace
		.getConfiguration('cp-nice-player')
		.get<number>('playback.chunkBufferCount', 5);
	return Math.min(20, Math.max(1, Math.round(value)));
}

export function getDebugLogging(): boolean {
	return vscode.workspace
		.getConfiguration('cp-nice-player')
		.get<boolean>('playback.debugLogging', false);
}
