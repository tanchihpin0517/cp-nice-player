import * as assert from 'assert';
import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { codecForEncodeFormat, EncodeFormat } from '../encodeFormat';
import { transcodeChunk, transcodeChunkToBuffer } from '../playback/stream/ffmpegChunk';
import { ffprobePathFromFfmpeg } from '../playback/stream/probe';

const execFileAsync = promisify(execFile);

const DURATION_TOLERANCE_SEC = 0.08;

async function requireFfmpeg(): Promise<string> {
	try {
		await execFileAsync('ffmpeg', ['-version'], { timeout: 5000 });
		return 'ffmpeg';
	} catch {
		throw new Error('ffmpeg was not found on PATH.');
	}
}

async function probeDuration(ffprobePath: string, filePath: string): Promise<number> {
	const { stdout } = await execFileAsync(
		ffprobePath,
		['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
		{ timeout: 30000 },
	);
	const duration = Number.parseFloat(stdout.trim());
	if (!Number.isFinite(duration) || duration <= 0) {
		throw new Error(`Could not read duration for ${filePath}`);
	}
	return duration;
}

async function probeInstalledEncoders(ffmpegPath: string): Promise<Set<string>> {
	const { stdout } = await execFileAsync(ffmpegPath, ['-hide_banner', '-encoders'], {
		timeout: 10000,
	});
	const encoders = new Set<string>();
	for (const line of stdout.split('\n')) {
		const match = line.trim().match(/^[AVS][\w.]+\s+(\S+)/);
		if (match) {
			encoders.add(match[1]);
		}
	}
	return encoders;
}

function encodeFormatAvailability(encoders: Set<string>): Record<EncodeFormat, boolean> {
	return {
		ogg: encoders.has(codecForEncodeFormat('ogg')),
		mp3: encoders.has(codecForEncodeFormat('mp3')),
		flac: encoders.has(codecForEncodeFormat('flac')),
		wav: encoders.has(codecForEncodeFormat('wav')),
	};
}

async function generateTestInputWav(ffmpegPath: string, outputPath: string): Promise<void> {
	await execFileAsync(
		ffmpegPath,
		[
			'-y',
			'-nostats',
			'-loglevel',
			'quiet',
			'-f',
			'lavfi',
			'-i',
			'sine=frequency=440:duration=3',
			'-ac',
			'2',
			'-ar',
			'44100',
			outputPath,
		],
		{ timeout: 30000 },
	);
}

suite('FFmpeg transcode', () => {
	let ffmpegPath: string;
	let encodeAvailable: Record<EncodeFormat, boolean>;
	let workDir: string;
	let inputPath: string;

	suiteSetup(async () => {
		ffmpegPath = await requireFfmpeg();
		encodeAvailable = encodeFormatAvailability(await probeInstalledEncoders(ffmpegPath));
		workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cp-nice-player-transcode-'));
		inputPath = path.join(workDir, 'input.wav');
		await generateTestInputWav(ffmpegPath, inputPath);
	});

	suiteTeardown(async () => {
		await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
	});

	function skipUnlessAvailable(context: Mocha.Context, format: EncodeFormat): void {
		if (!encodeAvailable[format]) {
			context.skip();
		}
	}

	test('produces an ogg chunk for the requested time range', async function () {
		skipUnlessAvailable(this, 'ogg');

		const outputPath = path.join(workDir, 'chunk_0.ogg');
		await transcodeChunk(ffmpegPath, inputPath, outputPath, {
			startSec: 0,
			endSec: 1,
			format: 'ogg',
			oggQuality: 6,
		});

		const stat = await fs.stat(outputPath);
		assert.ok(stat.size > 0);

		const duration = await probeDuration(ffprobePathFromFfmpeg(ffmpegPath), outputPath);
		assert.ok(Math.abs(duration - 1) <= DURATION_TOLERANCE_SEC);
	});

	test('produces a flac chunk for a later time range', async function () {
		skipUnlessAvailable(this, 'flac');

		const outputPath = path.join(workDir, 'chunk_1.flac');
		await transcodeChunk(ffmpegPath, inputPath, outputPath, {
			startSec: 1,
			endSec: 2,
			format: 'flac',
			oggQuality: 6,
		});

		const stat = await fs.stat(outputPath);
		assert.ok(stat.size > 0);

		const duration = await probeDuration(ffprobePathFromFfmpeg(ffmpegPath), outputPath);
		assert.ok(Math.abs(duration - 1) <= DURATION_TOLERANCE_SEC);
	});

	test('honors encode end beyond chunk body end for crossfade overlap', async function () {
		skipUnlessAvailable(this, 'ogg');

		const outputPath = path.join(workDir, 'chunk_overlap.ogg');
		await transcodeChunk(ffmpegPath, inputPath, outputPath, {
			startSec: 0,
			endSec: 1.05,
			format: 'ogg',
			oggQuality: 6,
		});

		const duration = await probeDuration(ffprobePathFromFfmpeg(ffmpegPath), outputPath);
		assert.ok(Math.abs(duration - 1.05) <= DURATION_TOLERANCE_SEC);
	});

	test('honors encode end beyond chunk body end for flac crossfade overlap', async function () {
		skipUnlessAvailable(this, 'flac');

		const outputPath = path.join(workDir, 'chunk_overlap.flac');
		await transcodeChunk(ffmpegPath, inputPath, outputPath, {
			startSec: 0,
			endSec: 1.05,
			format: 'flac',
			oggQuality: 6,
		});

		const duration = await probeDuration(ffprobePathFromFfmpeg(ffmpegPath), outputPath);
		assert.ok(Math.abs(duration - 1.05) <= DURATION_TOLERANCE_SEC);
	});

	test('produces an mp3 chunk for the requested time range', async function () {
		skipUnlessAvailable(this, 'mp3');

		const outputPath = path.join(workDir, 'chunk_0.mp3');
		await transcodeChunk(ffmpegPath, inputPath, outputPath, {
			startSec: 0,
			endSec: 1,
			format: 'mp3',
			oggQuality: 6,
		});

		const stat = await fs.stat(outputPath);
		assert.ok(stat.size > 0);

		const duration = await probeDuration(ffprobePathFromFfmpeg(ffmpegPath), outputPath);
		assert.ok(Math.abs(duration - 1) <= DURATION_TOLERANCE_SEC);
	});

	test('produces a wav chunk for the requested time range', async function () {
		skipUnlessAvailable(this, 'wav');

		const outputPath = path.join(workDir, 'chunk_0.wav');
		await transcodeChunk(ffmpegPath, inputPath, outputPath, {
			startSec: 0,
			endSec: 1,
			format: 'wav',
			oggQuality: 6,
		});

		const stat = await fs.stat(outputPath);
		assert.ok(stat.size > 0);

		const duration = await probeDuration(ffprobePathFromFfmpeg(ffmpegPath), outputPath);
		assert.ok(Math.abs(duration - 1) <= DURATION_TOLERANCE_SEC);
	});

	for (const format of ['ogg', 'flac', 'mp3', 'wav'] as const) {
		test(`transcodeChunkToBuffer produces a ${format} chunk via stdout`, async function () {
			skipUnlessAvailable(this, format);

			const buffer = await transcodeChunkToBuffer(ffmpegPath, inputPath, {
				startSec: 0,
				endSec: 1,
				format,
				oggQuality: 6,
			});
			assert.ok(buffer.length > 0);

			if (format === 'flac') {
				assert.strictEqual(buffer.subarray(0, 4).toString('ascii'), 'fLaC');
				return;
			}

			const ext = format === 'ogg' ? 'ogg' : format;
			const outputPath = path.join(workDir, `pipe_chunk_0.${ext}`);
			await fs.writeFile(outputPath, buffer);
			const duration = await probeDuration(ffprobePathFromFfmpeg(ffmpegPath), outputPath);
			assert.ok(Math.abs(duration - 1) <= DURATION_TOLERANCE_SEC);
		});
	}
});
