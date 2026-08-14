import { MANAGED_FFMPEG_ASSETS, ManagedFfmpegAsset } from './pins';

/**
 * Platforms the managed download covers. macOS and Windows users install FFmpeg
 * themselves (`brew install ffmpeg`, `winget install ffmpeg`) — they own their
 * machine and a package manager. Linux is where the extension usually runs
 * without one: Remote SSH boxes, dev containers, and Codespaces frequently have
 * no FFmpeg and no root to install it.
 */
const SUPPORTED_PLATFORM = 'linux';

export function resolveManagedAsset(
	platform: string = process.platform,
	arch: string = process.arch,
): ManagedFfmpegAsset | undefined {
	if (platform !== SUPPORTED_PLATFORM) {
		return undefined;
	}

	return MANAGED_FFMPEG_ASSETS.find((asset) => asset.arch === arch);
}

/**
 * Why the managed download is unavailable here, phrased for a notification.
 * `undefined` means it is available.
 */
export function managedFfmpegUnsupportedReason(
	platform: string = process.platform,
	arch: string = process.arch,
): string | undefined {
	if (resolveManagedAsset(platform, arch)) {
		return undefined;
	}

	if (platform !== SUPPORTED_PLATFORM) {
		return `Automatic FFmpeg download is only available on Linux hosts (this one is ${platform}).`;
	}

	const supported = MANAGED_FFMPEG_ASSETS.map((asset) => asset.arch).join(', ');
	return `No pinned FFmpeg build for Linux ${arch} (available: ${supported}).`;
}

export function formatBytes(bytes: number): string {
	const mb = bytes / 1024 / 1024;
	return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}
