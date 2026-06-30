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
		.get<number>('playback.crossfadeMs', 20);
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

export function logPlaybackSettings(): void {
	if (!getDebugLogging()) {
		return;
	}

	const configuredFfmpeg = vscode.workspace
		.getConfiguration('cp-nice-player')
		.get<string>('ffmpegPath')
		?.trim();

	console.log(
		'cp-nice-player: playback settings: '
			+ `ffmpegPath=${configuredFfmpeg ?? 'ffmpeg (PATH)'}, `
			+ `format=${getPlaybackFormat()}, `
			+ `oggQuality=${getPlaybackOggQuality()}, `
			+ `chunkDurationSec=${getChunkDurationSec()}, `
			+ `crossfadeMs=${getCrossfadeMs()}, `
			+ `chunkBufferCount=${getChunkBufferCount()}, `
			+ `debugLogging=${getDebugLogging()}`,
	);
}
