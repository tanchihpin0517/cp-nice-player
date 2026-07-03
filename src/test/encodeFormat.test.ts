import * as assert from 'assert';
import {
	codecForEncodeFormat,
	contentTypeForEncodeFormat,
	outputExtForEncodeFormat,
	resolveEncodeFormat,
} from '../encodeFormat';

suite('Encode format resolution', () => {
	test('uses ogg when libvorbis is available', () => {
		assert.strictEqual(
			resolveEncodeFormat('ogg', { libvorbis: true, libmp3lame: true, flac: true }),
			'ogg',
		);
	});

	test('falls back to mp3 when libvorbis is missing', () => {
		assert.strictEqual(
			resolveEncodeFormat('ogg', { libvorbis: false, libmp3lame: true, flac: true }),
			'mp3',
		);
	});

	test('throws when ogg preference has no vorbis or mp3 encoder', () => {
		assert.throws(
			() => resolveEncodeFormat('ogg', { libvorbis: false, libmp3lame: false, flac: true }),
			/libvorbis or libmp3lame/,
		);
	});

	test('uses flac when flac encoder is available', () => {
		assert.strictEqual(
			resolveEncodeFormat('flac', { libvorbis: true, libmp3lame: true, flac: true }),
			'flac',
		);
	});

	test('falls back to wav when flac encoder is missing', () => {
		assert.strictEqual(
			resolveEncodeFormat('flac', { libvorbis: true, libmp3lame: true, flac: false }),
			'wav',
		);
	});

	test('maps encode format to file extension and content type', () => {
		assert.strictEqual(outputExtForEncodeFormat('mp3'), 'mp3');
		assert.strictEqual(outputExtForEncodeFormat('wav'), 'wav');
		assert.strictEqual(contentTypeForEncodeFormat('mp3'), 'audio/mpeg');
		assert.strictEqual(contentTypeForEncodeFormat('wav'), 'audio/wav');
		assert.strictEqual(codecForEncodeFormat('mp3'), 'libmp3lame');
		assert.strictEqual(codecForEncodeFormat('wav'), 'pcm_s16le');
	});
});
