import { PlaybackFormat } from './config';

export type EncodeFormat = 'ogg' | 'mp3' | 'flac' | 'wav';

export interface EncoderCapabilities {
	libvorbis: boolean;
	libmp3lame: boolean;
	flac: boolean;
}

export function primaryEncodeFormat(preference: PlaybackFormat): EncodeFormat {
	return preference === 'flac' ? 'flac' : 'ogg';
}

export function resolveEncodeFormat(
	preference: PlaybackFormat,
	caps: EncoderCapabilities,
): EncodeFormat {
	if (preference === 'flac') {
		return caps.flac ? 'flac' : 'wav';
	}

	if (caps.libvorbis) {
		return 'ogg';
	}
	if (caps.libmp3lame) {
		return 'mp3';
	}

	throw new Error(
		'FFmpeg has no libvorbis or libmp3lame encoder; ogg playback is unavailable.',
	);
}

export function outputExtForEncodeFormat(format: EncodeFormat): string {
	switch (format) {
		case 'flac':
			return 'flac';
		case 'mp3':
			return 'mp3';
		case 'wav':
			return 'wav';
		default:
			return 'ogg';
	}
}

export function contentTypeForEncodeFormat(format: EncodeFormat): string {
	switch (format) {
		case 'flac':
			return 'audio/flac';
		case 'mp3':
			return 'audio/mpeg';
		case 'wav':
			return 'audio/wav';
		default:
			return 'audio/ogg';
	}
}

export function codecForEncodeFormat(format: EncodeFormat): string {
	switch (format) {
		case 'flac':
			return 'flac';
		case 'mp3':
			return 'libmp3lame';
		case 'wav':
			return 'pcm_s16le';
		default:
			return 'libvorbis';
	}
}

export function isEncodeFallback(
	preference: PlaybackFormat,
	encodeFormat: EncodeFormat,
): boolean {
	return primaryEncodeFormat(preference) !== encodeFormat;
}
