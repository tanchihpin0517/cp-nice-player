import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
	getChunkDurationSec,
	getCrossfadeMs,
	getPlaybackOggQuality,
} from '../config';
import { getEffectiveEncodeFormat } from '../ffmpegHost';
import { computeStreamCacheHash, computeStreamKey } from '../playback/stream/streamKey';

suite('Stream key helpers', () => {
	test('computeStreamCacheHash changes when inputs change', () => {
		const base = computeStreamCacheHash('/tmp/a.flac', 100, 200, 'ogg', 6, 1, 50);
		assert.notStrictEqual(
			computeStreamCacheHash('/tmp/b.flac', 100, 200, 'ogg', 6, 1, 50),
			base,
		);
		assert.notStrictEqual(
			computeStreamCacheHash('/tmp/a.flac', 101, 200, 'ogg', 6, 1, 50),
			base,
		);
		assert.notStrictEqual(
			computeStreamCacheHash('/tmp/a.flac', 100, 200, 'flac', 6, 1, 50),
			base,
		);
		assert.notStrictEqual(
			computeStreamCacheHash('/tmp/a.flac', 100, 200, 'mp3', 6, 1, 50),
			base,
		);
		assert.notStrictEqual(
			computeStreamCacheHash('/tmp/a.flac', 100, 200, 'ogg', 6, 1, 100),
			base,
		);
	});

	test('computeStreamKey matches hash of file stat and settings', async () => {
		const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cp-nice-player-streamkey-'));
		const filePath = path.join(workDir, 'sample.bin');

		try {
			await fs.writeFile(filePath, 'test-data');

			const key = await computeStreamKey(filePath);
			const stat = await fs.stat(filePath);
			const expected = computeStreamCacheHash(
				filePath,
				stat.mtimeMs,
				stat.size,
				getEffectiveEncodeFormat(),
				getPlaybackOggQuality(),
				getChunkDurationSec(),
				getCrossfadeMs(),
			);

			assert.strictEqual(key, expected);
		} finally {
			await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
		}
	});
});
