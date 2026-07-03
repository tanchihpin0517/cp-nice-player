import * as assert from 'assert';
import * as path from 'path';
import { ffprobePathFromFfmpeg, scanAudioFrames } from '../playback/stream/probe';
import {
	createTempWorkDir,
	generateTestInputWav,
	INDEX_DURATION_TOLERANCE_SEC,
	removeTempWorkDir,
	requireFfmpeg,
} from './helpers/ffmpegTestHelpers';

suite('FFprobe path derivation', () => {
	test('ffprobePathFromFfmpeg replaces ffmpeg suffix on Unix paths', () => {
		assert.strictEqual(ffprobePathFromFfmpeg('/usr/bin/ffmpeg'), '/usr/bin/ffprobe');
	});

	test('ffprobePathFromFfmpeg replaces ffmpeg.exe suffix on Windows paths', () => {
		assert.strictEqual(ffprobePathFromFfmpeg('/usr/bin/ffmpeg.exe'), '/usr/bin/ffprobe.exe');
	});

	test('ffprobePathFromFfmpeg falls back to ffprobe for non-standard paths', () => {
		assert.strictEqual(ffprobePathFromFfmpeg('/custom/tool'), 'ffprobe');
	});

	test('ffprobePathFromFfmpeg handles bare ffmpeg executable name', () => {
		assert.strictEqual(ffprobePathFromFfmpeg('ffmpeg'), 'ffprobe');
	});
});

suite('Audio frame scan', () => {
	let ffmpegPath: string;
	let workDir: string;
	let inputPath: string;

	suiteSetup(async function () {
		try {
			ffmpegPath = await requireFfmpeg();
		} catch {
			this.skip();
			return;
		}

		workDir = await createTempWorkDir('cp-nice-player-probe-');
		inputPath = path.join(workDir, 'input.wav');
		await generateTestInputWav(ffmpegPath, inputPath);
	});

	suiteTeardown(async () => {
		await removeTempWorkDir(workDir);
	});

	test('scanAudioFrames returns probe metadata and packets', async () => {
		const result = await scanAudioFrames(ffmpegPath, inputPath);

		assert.ok(result.packets.length > 0);
		assert.strictEqual(result.probe.channels, 2);
		assert.strictEqual(result.probe.sampleRate, 44100);
		assert.ok(Math.abs(result.probe.durationSec - 3) <= INDEX_DURATION_TOLERANCE_SEC);
		assert.ok(result.fileSize > 0);
	});
});
