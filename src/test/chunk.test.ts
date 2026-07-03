import * as assert from 'assert';
import * as path from 'path';
import { ChunkOutOfRangeError, getOrCreateChunk } from '../playback/stream/chunk';
import { clearStreamIndexCache, getOrCreateIndex } from '../playback/stream/indexBuilder';
import { computeStreamKey } from '../playback/stream/streamKey';
import {
	createTempWorkDir,
	generateTestInputWav,
	removeTempWorkDir,
	requireFfmpeg,
} from './helpers/ffmpegTestHelpers';

suite('Chunk delivery', () => {
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

		workDir = await createTempWorkDir('cp-nice-player-chunk-');
		inputPath = path.join(workDir, 'input.wav');
		await generateTestInputWav(ffmpegPath, inputPath);
	});

	suiteTeardown(async () => {
		clearStreamIndexCache();
		await removeTempWorkDir(workDir);
	});

	setup(() => {
		clearStreamIndexCache();
	});

	async function buildContext() {
		const key = await computeStreamKey(inputPath);
		const streamCtx = { fsPath: inputPath, key };
		const ffmpeg = { available: true, path: ffmpegPath };
		const manifest = await getOrCreateIndex(streamCtx, ffmpeg);
		return { streamCtx, ffmpeg, manifest };
	}

	test('getOrCreateChunk returns transcoded bytes and metadata', async () => {
		const { streamCtx, ffmpeg, manifest } = await buildContext();
		const chunk = await getOrCreateChunk(streamCtx, ffmpeg, 0, manifest);

		assert.ok(chunk.buffer.length > 0);
		assert.ok(chunk.contentType.startsWith('audio/'));
		assert.strictEqual(chunk.index, 0);
		assert.strictEqual(chunk.startSec, manifest.chunking.chunks[0].startSec);
		assert.ok(chunk.durationSec > 0);
	});

	test('getOrCreateChunk throws ChunkOutOfRangeError for invalid indices', async () => {
		const { streamCtx, ffmpeg, manifest } = await buildContext();

		await assert.rejects(
			() => getOrCreateChunk(streamCtx, ffmpeg, -1, manifest),
			(err: unknown) => err instanceof ChunkOutOfRangeError,
		);
		await assert.rejects(
			() => getOrCreateChunk(streamCtx, ffmpeg, 99, manifest),
			(err: unknown) => err instanceof ChunkOutOfRangeError,
		);
		await assert.rejects(
			() => getOrCreateChunk(streamCtx, ffmpeg, 1.5, manifest),
			(err: unknown) => err instanceof ChunkOutOfRangeError,
		);
	});

	test('getOrCreateChunk deduplicates in-flight transcodes', async () => {
		const { streamCtx, ffmpeg, manifest } = await buildContext();

		const [first, second] = await Promise.all([
			getOrCreateChunk(streamCtx, ffmpeg, 0, manifest),
			getOrCreateChunk(streamCtx, ffmpeg, 0, manifest),
		]);

		assert.strictEqual(first, second);
	});
});
