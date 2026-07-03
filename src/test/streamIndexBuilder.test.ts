import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	clearStreamIndexCache,
	getOrCreateIndex,
	isValidStreamIndexManifest,
} from '../playback/stream/indexBuilder';
import { computeStreamKey } from '../playback/stream/streamKey';
import {
	createTempWorkDir,
	generateTestInputWav,
	INDEX_DURATION_TOLERANCE_SEC,
	removeTempWorkDir,
	requireFfmpeg,
} from './helpers/ffmpegTestHelpers';

suite('Stream index builder', () => {
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

		workDir = await createTempWorkDir('cp-nice-player-index-');
		inputPath = path.join(workDir, 'input.wav');
		await generateTestInputWav(ffmpegPath, inputPath);
	});

	suiteTeardown(async () => {
		clearStreamIndexCache();
		await removeTempWorkDir(workDir);
		await vscode.workspace
			.getConfiguration('cp-nice-player')
			.update('playback.maxIndexEntries', undefined, vscode.ConfigurationTarget.Global);
	});

	setup(() => {
		clearStreamIndexCache();
	});

	async function streamCtxFor(pathToFile: string) {
		return {
			fsPath: pathToFile,
			key: await computeStreamKey(pathToFile),
		};
	}

	test('getOrCreateIndex builds a valid manifest', async () => {
		const streamCtx = await streamCtxFor(inputPath);
		const manifest = await getOrCreateIndex(streamCtx, { available: true, path: ffmpegPath });

		assert.strictEqual(isValidStreamIndexManifest(manifest), true);
		assert.ok(Math.abs(manifest.durationSec - 3) <= INDEX_DURATION_TOLERANCE_SEC);
		assert.ok(manifest.chunking.count >= 1);
	});

	test('getOrCreateIndex returns cached manifest on second call', async () => {
		const streamCtx = await streamCtxFor(inputPath);

		const first = await getOrCreateIndex(streamCtx, { available: true, path: ffmpegPath });
		const second = await getOrCreateIndex(streamCtx, { available: true, path: ffmpegPath });

		assert.strictEqual(first, second);
	});

	test('clearStreamIndexCache forces rebuild', async () => {
		const streamCtx = await streamCtxFor(inputPath);

		const first = await getOrCreateIndex(streamCtx, { available: true, path: ffmpegPath });
		clearStreamIndexCache();
		const second = await getOrCreateIndex(streamCtx, { available: true, path: ffmpegPath });

		assert.notStrictEqual(first, second);
		assert.deepStrictEqual(first, second);
	});

	test('getOrCreateIndex rejects when FFmpeg is unavailable', async () => {
		const streamCtx = await streamCtxFor(inputPath);

		await assert.rejects(
			() =>
				getOrCreateIndex(streamCtx, {
					available: false,
					path: 'ffmpeg',
					error: 'FFmpeg is not available.',
				}),
			/FFmpeg is not available/,
		);
	});

	test('getOrCreateIndex deduplicates in-flight builds', async () => {
		const streamCtx = await streamCtxFor(inputPath);
		const ffmpeg = { available: true, path: ffmpegPath };

		const [first, second] = await Promise.all([
			getOrCreateIndex(streamCtx, ffmpeg),
			getOrCreateIndex(streamCtx, ffmpeg),
		]);

		assert.strictEqual(first, second);
	});

	test('getOrCreateIndex evicts oldest entry when maxIndexEntries exceeded', async () => {
		await vscode.workspace
			.getConfiguration('cp-nice-player')
			.update('playback.maxIndexEntries', 2, vscode.ConfigurationTarget.Global);

		const pathA = path.join(workDir, 'a.wav');
		const pathB = path.join(workDir, 'b.wav');
		const pathC = path.join(workDir, 'c.wav');
		await generateTestInputWav(ffmpegPath, pathA, 2);
		await generateTestInputWav(ffmpegPath, pathB, 2);
		await generateTestInputWav(ffmpegPath, pathC, 2);

		const ctxA = await streamCtxFor(pathA);
		const ctxB = await streamCtxFor(pathB);
		const ctxC = await streamCtxFor(pathC);
		const ffmpeg = { available: true, path: ffmpegPath };

		const manifestA = await getOrCreateIndex(ctxA, ffmpeg);
		const manifestB = await getOrCreateIndex(ctxB, ffmpeg);
		await getOrCreateIndex(ctxC, ffmpeg);

		const manifestBAgain = await getOrCreateIndex(ctxB, ffmpeg);
		assert.strictEqual(manifestBAgain, manifestB);

		const manifestAAgain = await getOrCreateIndex(ctxA, ffmpeg);
		assert.notStrictEqual(manifestAAgain, manifestA);
		assert.deepStrictEqual(manifestAAgain, manifestA);
	});
});
