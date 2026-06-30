import * as assert from 'assert';
import {
	chunkFilePath,
	computeStreamCacheHash,
	contentTypeForFormat,
	sanitizeFileStem,
	sanitizeSourceExt,
} from '../playback/stream/cache';

suite('Stream cache helpers', () => {
	test('sanitizeFileStem strips unsafe characters', () => {
		assert.strictEqual(sanitizeFileStem('my track (1).mp3'), 'my_track_1');
		assert.strictEqual(sanitizeFileStem(''), 'audio');
	});

	test('sanitizeSourceExt lowercases extension', () => {
		assert.strictEqual(sanitizeSourceExt('song.FLAC'), 'flac');
		assert.strictEqual(sanitizeSourceExt('noext'), 'bin');
	});

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
			computeStreamCacheHash('/tmp/a.flac', 100, 200, 'ogg', 6, 1, 100),
			base,
		);
	});

	test('chunkFilePath and contentTypeForFormat match format', () => {
		assert.strictEqual(chunkFilePath('/cache', 3, 'ogg'), '/cache/chunk_3.ogg');
		assert.strictEqual(chunkFilePath('/cache', 0, 'flac'), '/cache/chunk_0.flac');
		assert.strictEqual(contentTypeForFormat('ogg'), 'audio/ogg');
		assert.strictEqual(contentTypeForFormat('flac'), 'audio/flac');
	});
});
