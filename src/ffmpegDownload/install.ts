import { execFile } from 'child_process';
import { constants as fsConstants } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { downloadVerified } from './download';
import { MANAGED_FFMPEG_TAG, ManagedFfmpegAsset } from './pins';
import { formatBytes, managedFfmpegUnsupportedReason, resolveManagedAsset } from './support';

const execFileAsync = promisify(execFile);

/** Subdirectory of the extension's global storage that holds managed installs. */
const INSTALL_DIR = 'ffmpeg';

/**
 * Resolved from the extension context at activation so that
 * `checkFfmpegAvailable()` — called from the playback server and stream routes,
 * none of which hold a context — can still find a managed install.
 */
let installRoot: string | undefined;

export function initManagedFfmpeg(context: vscode.ExtensionContext): void {
	installRoot = path.join(context.globalStorageUri.fsPath, INSTALL_DIR);
}

/** Test seam: point the managed install at a scratch directory. */
export function setManagedFfmpegRoot(root: string | undefined): void {
	installRoot = root;
}

export function getManagedFfmpegRoot(): string | undefined {
	return installRoot;
}

function versionDirName(asset: ManagedFfmpegAsset): string {
	return `${MANAGED_FFMPEG_TAG}-${asset.arch}`;
}

/**
 * Where a managed ffmpeg for this host would live, whether or not it is
 * installed. `undefined` when the platform is unsupported or activation has not
 * run yet.
 */
export function managedFfmpegPath(): string | undefined {
	const asset = resolveManagedAsset();
	if (!asset || !installRoot) {
		return undefined;
	}

	return path.join(installRoot, versionDirName(asset), 'ffmpeg');
}

/** The managed ffmpeg path if it is installed and executable, else `undefined`. */
export async function findManagedFfmpeg(): Promise<string | undefined> {
	const candidate = managedFfmpegPath();
	if (!candidate) {
		return undefined;
	}

	try {
		await fs.access(candidate, fsConstants.X_OK);
		return candidate;
	} catch {
		return undefined;
	}
}

function throwIfCancelled(token: vscode.CancellationToken | undefined): void {
	if (token?.isCancellationRequested) {
		throw new vscode.CancellationError();
	}
}

/**
 * Unpacks just the two executables the extension runs. Named members are used
 * instead of `--strip-components` so the command stays within what busybox tar
 * (common in slim containers) supports.
 */
export async function extractExecutables(
	archivePath: string,
	stagingDir: string,
	asset: ManagedFfmpegAsset,
): Promise<void> {
	try {
		await execFileAsync(
			'tar',
			['-xJf', archivePath, '-C', stagingDir, asset.entries.ffmpeg, asset.entries.ffprobe],
			{ timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
		);
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		const missingXz = /xz|lzma/i.test(detail);
		throw new Error(
			missingXz
				? `Could not unpack the FFmpeg archive because xz decompression is unavailable. ` +
					`Install xz (apt-get install xz-utils, apk add xz, dnf install xz) and try again, ` +
					`or set cp-nice-player.ffmpegPath to an existing ffmpeg. (${detail})`
				: `Could not unpack the FFmpeg archive: ${detail}`,
		);
	}

	// Flatten <root>/bin/{ffmpeg,ffprobe} to the top of the staging directory.
	for (const [name, entry] of Object.entries(asset.entries)) {
		await fs.rename(path.join(stagingDir, entry), path.join(stagingDir, name));
		await fs.chmod(path.join(stagingDir, name), 0o755);
	}

	const archiveRoot = asset.entries.ffmpeg.split('/')[0];
	await fs.rm(path.join(stagingDir, archiveRoot), { recursive: true, force: true });
}

/**
 * Runs the freshly unpacked binary once so an incompatible build (a musl-only
 * host, say) fails here with a clear message rather than later as a vague
 * "ffmpeg was not found".
 */
async function verifyRuns(ffmpegPath: string): Promise<void> {
	try {
		await execFileAsync(ffmpegPath, ['-version'], { timeout: 15_000 });
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new Error(
			`The downloaded FFmpeg could not run on this host: ${detail} ` +
				'Install FFmpeg with your package manager and set cp-nice-player.ffmpegPath instead.',
		);
	}
}

/** Drops installs from earlier pins once a new one is in place. */
async function pruneOtherInstalls(root: string, keep: string): Promise<void> {
	const entries = await fs.readdir(root).catch(() => [] as string[]);
	await Promise.all(
		entries
			.filter((entry) => entry !== keep && entry.startsWith('autobuild-'))
			.map((entry) => fs.rm(path.join(root, entry), { recursive: true, force: true })),
	);
}

export interface InstallProgress {
	report(value: { message?: string; increment?: number }): void;
}

/**
 * Downloads, verifies, and installs the pinned FFmpeg build, returning the path
 * to the installed executable. Safe to call when a matching install already
 * exists — it reinstalls rather than assuming the existing copy is intact.
 */
export async function installManagedFfmpeg(
	progress?: InstallProgress,
	token?: vscode.CancellationToken,
): Promise<string> {
	const asset = resolveManagedAsset();
	if (!asset) {
		throw new Error(managedFfmpegUnsupportedReason() ?? 'Managed FFmpeg is unavailable here.');
	}
	if (!installRoot) {
		throw new Error('Managed FFmpeg storage is not initialised.');
	}

	// Global storage is shared by every window on this host, so scratch paths are
	// per-process: two windows installing at once must not write one archive.
	const targetDir = path.join(installRoot, versionDirName(asset));
	const stagingDir = `${targetDir}.staging-${process.pid}`;
	const archivePath = path.join(installRoot, `${asset.archiveName}.${process.pid}.part`);

	await fs.mkdir(installRoot, { recursive: true });
	await fs.rm(stagingDir, { recursive: true, force: true });
	await fs.mkdir(stagingDir, { recursive: true });

	try {
		let reportedPercent = 0;
		await downloadVerified({
			url: asset.url,
			destination: archivePath,
			expectedSha256: asset.sha256,
			token,
			onProgress: (received, total) => {
				const size = total ?? asset.sizeBytes;
				const percent = Math.min(99, Math.floor((received / size) * 100));
				if (percent === reportedPercent) {
					return;
				}
				progress?.report({
					increment: percent - reportedPercent,
					message: `Downloading FFmpeg — ${formatBytes(received)} of ${formatBytes(size)}`,
				});
				reportedPercent = percent;
			},
		});

		throwIfCancelled(token);
		progress?.report({ message: 'Unpacking FFmpeg…' });
		await extractExecutables(archivePath, stagingDir, asset);
		await verifyRuns(path.join(stagingDir, 'ffmpeg'));

		await fs.rm(targetDir, { recursive: true, force: true });
		await fs.rename(stagingDir, targetDir);
		await pruneOtherInstalls(installRoot, versionDirName(asset));

		return path.join(targetDir, 'ffmpeg');
	} finally {
		await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
		await fs.rm(archivePath, { force: true }).catch(() => undefined);
	}
}
