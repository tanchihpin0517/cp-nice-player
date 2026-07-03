import * as assert from 'assert';
import { computeStreamCacheHash } from '../playback/stream/streamKey';

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
});
