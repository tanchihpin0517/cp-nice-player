import * as assert from 'assert';
import {
	chunkFilePath,
	computeStreamCacheHash,
	sanitizeFileStem,
	sanitizeSourceExt,
} from '../playback/stream/cache';
import { contentTypeForEncodeFormat } from '../encodeFormat';

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
			computeStreamCacheHash('/tmp/a.flac', 100, 200, 'mp3', 6, 1, 50),
			base,
		);
		assert.notStrictEqual(
			computeStreamCacheHash('/tmp/a.flac', 100, 200, 'ogg', 6, 1, 100),
			base,
		);
	});

	test('chunkFilePath and contentTypeForEncodeFormat match format', () => {
		assert.strictEqual(chunkFilePath('/cache', 3, 'ogg'), '/cache/chunk_3.ogg');
		assert.strictEqual(chunkFilePath('/cache', 0, 'flac'), '/cache/chunk_0.flac');
		assert.strictEqual(chunkFilePath('/cache', 2, 'mp3'), '/cache/chunk_2.mp3');
		assert.strictEqual(chunkFilePath('/cache', 1, 'wav'), '/cache/chunk_1.wav');
		assert.strictEqual(contentTypeForEncodeFormat('ogg'), 'audio/ogg');
		assert.strictEqual(contentTypeForEncodeFormat('flac'), 'audio/flac');
		assert.strictEqual(contentTypeForEncodeFormat('mp3'), 'audio/mpeg');
		assert.strictEqual(contentTypeForEncodeFormat('wav'), 'audio/wav');
	});
});
