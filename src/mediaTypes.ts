import * as vscode from 'vscode';

export const AUDIO_EXTENSIONS = new Set([
	'.mp3',
	'.wav',
	'.ogg',
	'.opus',
	'.flac',
	'.m4a',
	'.aac',
	'.webm',
	'.mp4',
	'.mkv',
]);

/** Keep in sync with package.json customEditors selector. */
export const SUPPORTED_FILENAME_PATTERN =
	'*.{mp3,wav,ogg,opus,flac,m4a,aac,webm,mp4,mkv}';

export function isSupportedAudio(uri: vscode.Uri): boolean {
	const extension = uri.path.slice(uri.path.lastIndexOf('.')).toLowerCase();
	return AUDIO_EXTENSIONS.has(extension);
}

export const MEDIA_FILE_FILTERS: Record<string, string[]> = {
	Audio: ['mp3', 'wav', 'ogg', 'opus', 'flac', 'm4a', 'aac', 'webm', 'mp4', 'mkv'],
};
