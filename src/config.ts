import * as vscode from 'vscode';

export type UnsupportedPlayback = 'cache' | 'stream';

export type CacheFormat = 'ogg' | 'flac';

export function getUnsupportedPlayback(): UnsupportedPlayback {
	return vscode.workspace
		.getConfiguration('cp-nice-player')
		.get<UnsupportedPlayback>('unsupportedPlayback', 'cache');
}

export function getCacheFormat(): CacheFormat {
	const value = vscode.workspace
		.getConfiguration('cp-nice-player')
		.get<CacheFormat>('playbackCache.format', 'flac');
	return value === 'ogg' ? 'ogg' : 'flac';
}

export function getCacheOggQuality(): number {
	const value = vscode.workspace
		.getConfiguration('cp-nice-player')
		.get<number>('playbackCache.oggQuality', 6);
	return Math.min(10, Math.max(0, Math.round(value)));
}
