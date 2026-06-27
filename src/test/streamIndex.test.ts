import * as assert from 'assert';
import { isValidStreamIndexManifest } from '../playback/stream/indexBuilder';

function validManifest() {
	return {
		version: 1,
		durationSec: 2.0,
		channels: 2,
		sampleRate: 44100,
		encode: {
			format: 'ogg',
			codec: 'ogg',
			contentType: 'audio/ogg',
		},
		chunking: {
			targetDurationSec: 1,
			count: 2,
			strategy: 'frame-aligned',
			chunks: [
				{
					index: 0,
					startSec: 0,
					endSec: 1,
					startByte: 0,
					endByte: 99,
					startFrame: 0,
					endFrame: 10,
				},
				{
					index: 1,
					startSec: 1,
					endSec: 2,
					startByte: 100,
					endByte: 199,
					startFrame: 11,
					endFrame: 20,
				},
			],
		},
	};
}

suite('Stream index manifest validation', () => {
	test('accepts a well-formed manifest', () => {
		assert.strictEqual(isValidStreamIndexManifest(validManifest()), true);
	});

	test('rejects wrong version', () => {
		const manifest = validManifest();
		manifest.version = 2 as 1;
		assert.strictEqual(isValidStreamIndexManifest(manifest), false);
	});

	test('rejects non-monotonic chunk frames', () => {
		const manifest = validManifest();
		manifest.chunking.chunks[1].startFrame = 5;
		assert.strictEqual(isValidStreamIndexManifest(manifest), false);
	});

	test('rejects empty chunk list', () => {
		const manifest = validManifest();
		manifest.chunking.chunks = [];
		manifest.chunking.count = 0;
		assert.strictEqual(isValidStreamIndexManifest(manifest), false);
	});
});
