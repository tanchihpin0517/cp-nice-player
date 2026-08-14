#!/usr/bin/env node
// Regenerates src/ffmpegDownload/pins.ts from a BtbN/FFmpeg-Builds release.
//
// The extension downloads FFmpeg on demand for Linux hosts, so every byte it
// fetches has to be pinned: a dated release tag (the `latest` tag rewrites its
// own assets), an exact filename, and a SHA-256 this script computes by
// actually downloading the archive.
//
// Usage:
//   node scripts/pin-ffmpeg.mjs                 # newest autobuild-* tag, 8.1 branch
//   node scripts/pin-ffmpeg.mjs --tag autobuild-2026-08-13-17-03
//   node scripts/pin-ffmpeg.mjs --branch 7.1
//   node scripts/pin-ffmpeg.mjs --cache /tmp/ffmpeg-pins   # reuse downloaded archives

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const REPO = 'BtbN/FFmpeg-Builds';
const ARCHES = [
	{ arch: 'x64', slug: 'linux64' },
	{ arch: 'arm64', slug: 'linuxarm64' },
];

const OUTPUT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../src/ffmpegDownload/pins.ts',
);

function parseArgs(argv) {
	const args = { tag: undefined, branch: '8.1', cache: undefined };
	for (let i = 0; i < argv.length; i += 1) {
		if (argv[i] === '--tag') {
			args.tag = argv[++i];
		} else if (argv[i] === '--branch') {
			args.branch = argv[++i];
		} else if (argv[i] === '--cache') {
			args.cache = argv[++i];
		}
	}
	return args;
}

async function fetchJson(url) {
	const response = await fetch(url, {
		headers: { accept: 'application/vnd.github+json', 'user-agent': 'cp-nice-player-pin' },
	});
	if (!response.ok) {
		throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
	}
	return response.json();
}

async function resolveRelease(tag) {
	if (tag) {
		return fetchJson(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`);
	}

	const releases = await fetchJson(`https://api.github.com/repos/${REPO}/releases?per_page=20`);
	const dated = releases.find((release) => release.tag_name.startsWith('autobuild-'));
	if (!dated) {
		throw new Error('No autobuild-* release found; pass --tag explicitly.');
	}
	return dated;
}

/**
 * BtbN publishes a checksums.sha256 alongside the archives. Cross-checking the
 * locally computed digests against it turns a corrupted or tampered download at
 * pin time into a hard failure instead of a bad pin nobody notices.
 */
function assertUpstreamChecksum(published, archiveName, sha256) {
	const line = published
		.split('\n')
		.map((entry) => entry.trim())
		.find((entry) => entry.endsWith(` ${archiveName}`));

	if (!line) {
		throw new Error(`checksums.sha256 has no entry for ${archiveName}.`);
	}

	const expected = line.split(/\s+/)[0];
	if (expected !== sha256) {
		throw new Error(
			`Checksum disagreement for ${archiveName}: upstream says ${expected}, download hashed to ${sha256}.`,
		);
	}
}

function pickAsset(release, slug, branch) {
	// LGPL, statically linked, release branch (not master) — e.g.
	// ffmpeg-n8.1.2-34-g9b6c8969e0-linux64-lgpl-8.1.tar.xz
	const pattern = new RegExp(`-${slug}-lgpl-${branch.replace('.', '\\.')}\\.tar\\.xz$`);
	const asset = release.assets.find((candidate) => pattern.test(candidate.name));
	if (!asset) {
		throw new Error(`No ${slug} LGPL ${branch} asset in release ${release.tag_name}.`);
	}
	return asset;
}

async function download(url, destination) {
	const cached = await readFile(destination).catch(() => undefined);
	if (cached) {
		return { bytes: cached, reused: true };
	}

	const response = await fetch(url, { redirect: 'follow' });
	if (!response.ok) {
		throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	await writeFile(destination, bytes);
	return { bytes, reused: false };
}

// The extension derives the ffprobe path from the ffmpeg path (see
// ffprobePathFromFfmpeg), so both executables must land in one directory.
async function archiveEntries(archivePath) {
	const { stdout } = await execFileAsync('tar', ['-tJf', archivePath], {
		maxBuffer: 64 * 1024 * 1024,
	});
	const lines = stdout.split('\n').map((line) => line.trim());

	const find = (name) => {
		const entry = lines.find((line) => line.endsWith(`/bin/${name}`));
		if (!entry) {
			throw new Error(`No bin/${name} entry inside ${path.basename(archivePath)}.`);
		}
		return entry;
	};

	return { ffmpeg: find('ffmpeg'), ffprobe: find('ffprobe') };
}

function render(release, branch, entries, probe) {
	const assets = entries
		.map(
			(entry) => `	{
		arch: '${entry.arch}',
		archiveName: '${entry.archiveName}',
		url: '${entry.url}',
		sha256: '${entry.sha256}',
		sizeBytes: ${entry.sizeBytes},
		entries: {
			ffmpeg: '${entry.entries.ffmpeg}',
			ffprobe: '${entry.entries.ffprobe}',
		},
	},`,
		)
		.join('\n');

	return `// Generated by scripts/pin-ffmpeg.mjs — do not edit by hand.
//
// FFmpeg binaries built by https://github.com/${REPO} under the LGPL. The
// extension never redistributes them; it downloads them from the upstream
// release on the user's own machine, after the user asks for it.

export type ManagedFfmpegArch = 'x64' | 'arm64';

export interface ManagedFfmpegAsset {
	/** Node's \`process.arch\` value this asset serves. */
	arch: ManagedFfmpegArch;
	archiveName: string;
	url: string;
	/** SHA-256 of the archive, verified before anything is extracted. */
	sha256: string;
	sizeBytes: number;
	/**
	 * Paths inside the archive of the two executables the extension runs. Both are
	 * extracted into one directory because ffprobe is located relative to ffmpeg.
	 */
	entries: { ffmpeg: string; ffprobe: string };
}

/** Dated release tag; \`latest\` is unusable because its assets are rewritten in place. */
export const MANAGED_FFMPEG_TAG = '${release.tag_name}';

/** FFmpeg release branch the pinned build tracks. */
export const MANAGED_FFMPEG_BRANCH = '${branch}';

export const MANAGED_FFMPEG_LICENSE_URL =
	'https://github.com/${REPO}#license';

export const MANAGED_FFMPEG_ASSETS: readonly ManagedFfmpegAsset[] = [
${assets}
];

/**
 * The release's own checksum manifest. It is small, lives behind the same
 * redirect chain as the archives, and is pinned here purely so tests can
 * exercise the download-and-verify path without pulling ~100 MB.
 */
export const MANAGED_FFMPEG_PROBE_ASSET = {
	url: '${probe.url}',
	sha256: '${probe.sha256}',
	sizeBytes: ${probe.sizeBytes},
};
`;
}

async function main() {
	const { tag, branch, cache } = parseArgs(process.argv.slice(2));
	const release = await resolveRelease(tag);
	console.log(`Release: ${release.tag_name} (${release.published_at})`);

	const workDir = cache ?? (await mkdtemp(path.join(tmpdir(), 'cp-nice-player-pin-')));
	await mkdir(workDir, { recursive: true });
	try {
		const checksumsAsset = release.assets.find((asset) => asset.name === 'checksums.sha256');
		if (!checksumsAsset) {
			throw new Error(`Release ${release.tag_name} publishes no checksums.sha256.`);
		}
		const { bytes: checksumBytes } = await download(
			checksumsAsset.browser_download_url,
			path.join(workDir, checksumsAsset.name),
		);
		const published = checksumBytes.toString('utf8');
		const probe = {
			url: checksumsAsset.browser_download_url,
			sha256: createHash('sha256').update(checksumBytes).digest('hex'),
			sizeBytes: checksumBytes.length,
		};

		const assets = [];
		for (const { arch, slug } of ARCHES) {
			const asset = pickAsset(release, slug, branch);
			const archivePath = path.join(workDir, asset.name);
			process.stdout.write(`  ${arch}: ${asset.name} … `);
			const { bytes, reused } = await download(asset.browser_download_url, archivePath);
			const sha256 = createHash('sha256').update(bytes).digest('hex');
			assertUpstreamChecksum(published, asset.name, sha256);
			const entries = await archiveEntries(archivePath);
			console.log(
				`${(bytes.length / 1024 / 1024).toFixed(1)} MB, ${sha256.slice(0, 12)}…${reused ? ' (cached)' : ''}`,
			);
			assets.push({
				arch,
				archiveName: asset.name,
				url: asset.browser_download_url,
				sha256,
				sizeBytes: bytes.length,
				entries,
			});
		}

		const next = render(release, branch, assets, probe);
		const previous = await readFile(OUTPUT, 'utf8').catch(() => undefined);
		if (previous === next) {
			console.log(`\nUnchanged: ${path.relative(process.cwd(), OUTPUT)}`);
			return;
		}
		await writeFile(OUTPUT, next);
		console.log(`\nWrote ${path.relative(process.cwd(), OUTPUT)}`);
	} finally {
		if (!cache) {
			await rm(workDir, { recursive: true, force: true });
		}
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
