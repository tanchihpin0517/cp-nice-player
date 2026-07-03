import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import { EncodeFormat } from '../encodeFormat';
import { transcodeChunk, transcodeChunkToBuffer } from '../playback/stream/ffmpegChunk';
import { ffprobePathFromFfmpeg } from '../playback/stream/probe';
import {
	createTempWorkDir,
	DURATION_TOLERANCE_SEC,
	encodeFormatAvailability,
	generateTestInputWav,
	probeDuration,
	probeInstalledEncoders,
	removeTempWorkDir,
	requireFfmpeg,
	skipUnlessEncodeAvailable,
} from './helpers/ffmpegTestHelpers';

suite('FFmpeg transcode', () => {
	let ffmpegPath: string;
	let encodeAvailable: Record<EncodeFormat, boolean>;
	let workDir: string;
	let inputPath: string;

	suiteSetup(async () => {
		ffmpegPath = await requireFfmpeg();
		encodeAvailable = encodeFormatAvailability(await probeInstalledEncoders(ffmpegPath));
		workDir = await createTempWorkDir('cp-nice-player-transcode-');
		inputPath = path.join(workDir, 'input.wav');
		await generateTestInputWav(ffmpegPath, inputPath);
	});

	suiteTeardown(async () => {
		await removeTempWorkDir(workDir);
	});

	test('produces an ogg chunk for the requested time range', async function () {
		skipUnlessEncodeAvailable(this, encodeAvailable, 'ogg');

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
		skipUnlessEncodeAvailable(this, encodeAvailable, 'flac');

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
		skipUnlessEncodeAvailable(this, encodeAvailable, 'ogg');

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
		skipUnlessEncodeAvailable(this, encodeAvailable, 'flac');

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
		skipUnlessEncodeAvailable(this, encodeAvailable, 'mp3');

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
		skipUnlessEncodeAvailable(this, encodeAvailable, 'wav');

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
			skipUnlessEncodeAvailable(this, encodeAvailable, format);

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
