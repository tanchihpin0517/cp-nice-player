import * as assert from 'assert';
import { execFile } from 'child_process';
import { constants as fsConstants } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as https from 'https';
import {
	MANAGED_FFMPEG_ASSETS,
	MANAGED_FFMPEG_PROBE_ASSET,
	MANAGED_FFMPEG_TAG,
	ManagedFfmpegAsset,
} from '../ffmpegDownload/pins';
import { downloadVerified } from '../ffmpegDownload/download';
import {
	extractExecutables,
	findManagedFfmpeg,
	managedFfmpegPath,
	setManagedFfmpegRoot,
} from '../ffmpegDownload/install';
import {
	formatBytes,
	managedFfmpegUnsupportedReason,
	resolveManagedAsset,
} from '../ffmpegDownload/support';

const execFileAsync = promisify(execFile);

const FIXTURE_ASSET: ManagedFfmpegAsset = {
	arch: 'x64',
	archiveName: 'fixture.tar.xz',
	url: 'https://example.invalid/fixture.tar.xz',
	sha256: '0'.repeat(64),
	sizeBytes: 1,
	entries: { ffmpeg: 'root/bin/ffmpeg', ffprobe: 'root/bin/ffprobe' },
};

async function makeTempDir(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), 'cp-nice-player-test-'));
}

suite('Managed FFmpeg pins', () => {
	test('every pinned asset is an HTTPS URL from the pinned release tag', () => {
		assert.ok(MANAGED_FFMPEG_ASSETS.length > 0);
		for (const asset of MANAGED_FFMPEG_ASSETS) {
			assert.ok(asset.url.startsWith('https://'), `${asset.arch} url is not HTTPS`);
			assert.ok(
				asset.url.includes(`/download/${MANAGED_FFMPEG_TAG}/`),
				`${asset.arch} url does not point at ${MANAGED_FFMPEG_TAG}`,
			);
			assert.ok(asset.url.endsWith(asset.archiveName));
		}
	});

	test('every pinned asset carries a full SHA-256 and a plausible size', () => {
		for (const asset of MANAGED_FFMPEG_ASSETS) {
			assert.match(asset.sha256, /^[0-9a-f]{64}$/, `${asset.arch} sha256 is malformed`);
			assert.ok(asset.sizeBytes > 1_000_000, `${asset.arch} size looks wrong`);
		}
	});

	test('ffmpeg and ffprobe entries share one directory inside the archive', () => {
		for (const asset of MANAGED_FFMPEG_ASSETS) {
			assert.ok(asset.entries.ffmpeg.endsWith('/bin/ffmpeg'));
			assert.ok(asset.entries.ffprobe.endsWith('/bin/ffprobe'));
			assert.strictEqual(
				path.posix.dirname(asset.entries.ffmpeg),
				path.posix.dirname(asset.entries.ffprobe),
				`${asset.arch} entries are in different directories`,
			);
		}
	});

	test('the pinned tag is dated, not the rewritable "latest" tag', () => {
		assert.match(MANAGED_FFMPEG_TAG, /^autobuild-\d{4}-\d{2}-\d{2}/);
	});
});

suite('Managed FFmpeg platform support', () => {
	test('resolves a build for supported Linux architectures', () => {
		assert.ok(resolveManagedAsset('linux', 'x64'));
		assert.ok(resolveManagedAsset('linux', 'arm64'));
	});

	test('offers nothing on macOS or Windows', () => {
		assert.strictEqual(resolveManagedAsset('darwin', 'arm64'), undefined);
		assert.strictEqual(resolveManagedAsset('win32', 'x64'), undefined);
	});

	test('offers nothing for an unpinned Linux architecture', () => {
		assert.strictEqual(resolveManagedAsset('linux', 'ppc64'), undefined);
	});

	test('explains an unsupported platform by naming it', () => {
		const reason = managedFfmpegUnsupportedReason('darwin', 'arm64');
		assert.ok(reason);
		assert.ok(reason.includes('Linux'));
		assert.ok(reason.includes('darwin'));
	});

	test('explains an unsupported architecture by listing the pinned ones', () => {
		const reason = managedFfmpegUnsupportedReason('linux', 'ppc64');
		assert.ok(reason);
		assert.ok(reason.includes('ppc64'));
		assert.ok(reason.includes('x64'));
	});

	test('gives no reason when a build is available', () => {
		assert.strictEqual(managedFfmpegUnsupportedReason('linux', 'x64'), undefined);
	});

	test('formats download sizes for the prompt', () => {
		assert.strictEqual(formatBytes(1024 * 1024), '1.0 MB');
		assert.strictEqual(formatBytes(112453296), '107 MB');
	});
});

suite('Managed FFmpeg install location', function () {
	const isLinux = process.platform === 'linux';
	let root: string | undefined;

	setup(async function () {
		if (!isLinux) {
			// The install path only resolves on platforms with a pinned build.
			this.skip();
		}
		root = await makeTempDir();
		setManagedFfmpegRoot(root);
	});

	teardown(async () => {
		setManagedFfmpegRoot(undefined);
		if (root) {
			await fs.rm(root, { recursive: true, force: true });
			root = undefined;
		}
	});

	test('scopes the install directory to the pinned tag and architecture', () => {
		const resolved = managedFfmpegPath();
		assert.ok(resolved);
		assert.ok(resolved.startsWith(root!));
		assert.ok(resolved.includes(MANAGED_FFMPEG_TAG));
		assert.ok(resolved.includes(process.arch));
		assert.strictEqual(path.basename(resolved), 'ffmpeg');
	});

	test('reports nothing installed until the executable exists', async () => {
		assert.strictEqual(await findManagedFfmpeg(), undefined);
	});

	test('finds the executable once it is installed', async () => {
		const target = managedFfmpegPath()!;
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.writeFile(target, '#!/bin/sh\nexit 0\n');
		await fs.chmod(target, 0o755);

		assert.strictEqual(await findManagedFfmpeg(), target);
	});

	test('ignores a non-executable file at the install path', async () => {
		const target = managedFfmpegPath()!;
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.writeFile(target, 'not executable');
		await fs.chmod(target, 0o644);

		assert.strictEqual(await findManagedFfmpeg(), undefined);
	});
});

suite('Managed FFmpeg extraction', function () {
	let workDir: string;
	let archivePath: string;

	suiteSetup(async function () {
		this.timeout(30_000);
		workDir = await makeTempDir();
		archivePath = path.join(workDir, 'fixture.tar.xz');

		const sourceDir = path.join(workDir, 'src');
		const binDir = path.join(sourceDir, 'root', 'bin');
		await fs.mkdir(binDir, { recursive: true });
		for (const name of ['ffmpeg', 'ffprobe']) {
			await fs.writeFile(path.join(binDir, name), `#!/bin/sh\necho ${name}\n`);
		}
		await fs.writeFile(path.join(sourceDir, 'root', 'README.txt'), 'docs we do not want\n');

		try {
			await execFileAsync('tar', ['-cJf', archivePath, '-C', sourceDir, 'root']);
		} catch {
			// No xz-capable tar here; the extraction path cannot be exercised.
			this.skip();
		}
	});

	suiteTeardown(async () => {
		if (workDir) {
			await fs.rm(workDir, { recursive: true, force: true });
		}
	});

	test('flattens both executables to the top of the staging directory', async () => {
		const staging = path.join(workDir, 'staging-flatten');
		await fs.mkdir(staging, { recursive: true });

		await extractExecutables(archivePath, staging, FIXTURE_ASSET);

		assert.deepStrictEqual((await fs.readdir(staging)).sort(), ['ffmpeg', 'ffprobe']);
	});

	test('marks the extracted executables runnable', async () => {
		const staging = path.join(workDir, 'staging-mode');
		await fs.mkdir(staging, { recursive: true });

		await extractExecutables(archivePath, staging, FIXTURE_ASSET);

		for (const name of ['ffmpeg', 'ffprobe']) {
			await fs.access(path.join(staging, name), fsConstants.X_OK);
		}
	});

	test('extracts only the two executables, not the rest of the archive', async () => {
		const staging = path.join(workDir, 'staging-subset');
		await fs.mkdir(staging, { recursive: true });

		await extractExecutables(archivePath, staging, FIXTURE_ASSET);

		await assert.rejects(() => fs.access(path.join(staging, 'root')));
		await assert.rejects(() => fs.access(path.join(staging, 'README.txt')));
	});

	test('reports a usable error when the archive is missing', async () => {
		const staging = path.join(workDir, 'staging-missing');
		await fs.mkdir(staging, { recursive: true });

		await assert.rejects(
			() => extractExecutables(path.join(workDir, 'absent.tar.xz'), staging, FIXTURE_ASSET),
			/Could not unpack the FFmpeg archive/,
		);
	});
});

function githubReachable(): Promise<boolean> {
	return new Promise((resolve) => {
		const request = https.get('https://github.com', { timeout: 5000 }, (response) => {
			response.resume();
			resolve(true);
		});
		request.on('error', () => resolve(false));
		request.on('timeout', () => {
			request.destroy();
			resolve(false);
		});
	});
}

// Exercises the real redirect chain GitHub uses for release downloads, against
// the pinned release's own checksum manifest — a few KB rather than ~100 MB.
suite('Managed FFmpeg download', function () {
	this.timeout(60_000);
	let workDir: string;

	suiteSetup(async function () {
		if (!(await githubReachable())) {
			this.skip();
		}
	});

	setup(async () => {
		workDir = await makeTempDir();
	});

	teardown(async () => {
		if (workDir) {
			await fs.rm(workDir, { recursive: true, force: true });
		}
	});

	test('follows redirects and writes the verified bytes', async () => {
		const destination = path.join(workDir, 'checksums.sha256');

		await downloadVerified({
			url: MANAGED_FFMPEG_PROBE_ASSET.url,
			destination,
			expectedSha256: MANAGED_FFMPEG_PROBE_ASSET.sha256,
		});

		const written = await fs.stat(destination);
		assert.strictEqual(written.size, MANAGED_FFMPEG_PROBE_ASSET.sizeBytes);
	});

	test('reports progress while the body streams', async () => {
		const destination = path.join(workDir, 'progress.sha256');
		let lastReceived = 0;
		let calls = 0;

		await downloadVerified({
			url: MANAGED_FFMPEG_PROBE_ASSET.url,
			destination,
			expectedSha256: MANAGED_FFMPEG_PROBE_ASSET.sha256,
			onProgress: (received) => {
				calls += 1;
				assert.ok(received >= lastReceived, 'progress went backwards');
				lastReceived = received;
			},
		});

		assert.ok(calls > 0, 'progress was never reported');
		assert.strictEqual(lastReceived, MANAGED_FFMPEG_PROBE_ASSET.sizeBytes);
	});

	test('rejects a checksum mismatch and leaves no file behind', async () => {
		const destination = path.join(workDir, 'tampered.sha256');

		await assert.rejects(
			() =>
				downloadVerified({
					url: MANAGED_FFMPEG_PROBE_ASSET.url,
					destination,
					expectedSha256: 'f'.repeat(64),
				}),
			/Checksum mismatch/,
		);

		await assert.rejects(() => fs.access(destination), 'unverified bytes were kept');
	});

	test('refuses a non-HTTPS URL', async () => {
		await assert.rejects(
			() =>
				downloadVerified({
					url: 'http://github.com/BtbN/FFmpeg-Builds',
					destination: path.join(workDir, 'insecure'),
					expectedSha256: '0'.repeat(64),
				}),
			/non-HTTPS/,
		);
	});
});
