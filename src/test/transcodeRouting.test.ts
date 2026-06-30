import * as assert from 'assert';
import { chunkTimingFromManifest } from '../playback/stream/chunk';
import { buildFfmpegChunkArgs, formatFfmpegChunkCommandTemplate } from '../playback/stream/ffmpegChunk';
import { StreamIndexManifest } from '../playback/stream/indexBuilder';

function fixtureManifest(): StreamIndexManifest {
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
			crossfadeMs: 50,
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
					crossfadeEndFrame: 12,
					crossfadeEndSec: 1.05,
				},
				{
					index: 1,
					startSec: 1,
					endSec: 2,
					startByte: 100,
					endByte: 199,
					startFrame: 11,
					endFrame: 20,
					crossfadeEndFrame: 20,
					crossfadeEndSec: 2,
				},
			],
		},
	};
}

suite('Transcode routing', () => {
	test('chunkTimingFromManifest uses crossfadeEndSec as encode end', () => {
		const manifest = fixtureManifest();
		const timing = chunkTimingFromManifest(0, manifest);

		assert.strictEqual(timing.startSec, 0);
		assert.strictEqual(timing.endSec, 1);
		assert.strictEqual(timing.encodeEndSec, 1.05);
		assert.strictEqual(timing.durationSec, 1);
	});

	test('buildFfmpegChunkArgs uses startSec and encode end for ogg', () => {
		const args = buildFfmpegChunkArgs('/input.flac', '/out/chunk_0.ogg', {
			startSec: 0,
			endSec: 1.05,
			format: 'ogg',
			oggQuality: 6,
		});

		assert.deepStrictEqual(args, [
			'-y',
			'-nostats',
			'-loglevel',
			'quiet',
			'-accurate_seek',
			'-ss',
			'0',
			'-to',
			'1.05',
			'-i',
			'/input.flac',
			'-vn',
			'-c:a',
			'libvorbis',
			'-q:a',
			'6',
			'/out/chunk_0.ogg',
		]);
	});

	test('buildFfmpegChunkArgs uses flac codec when requested', () => {
		const args = buildFfmpegChunkArgs('/input.flac', '/out/chunk_1.flac', {
			startSec: 1,
			endSec: 2,
			format: 'flac',
			oggQuality: 6,
		});

		assert.ok(args.includes('-c:a'));
		assert.ok(args.includes('flac'));
		assert.strictEqual(args[args.indexOf('-to') + 1], '2');
	});

	test('formatFfmpegChunkCommandTemplate uses placeholders for per-chunk values', () => {
		const template = formatFfmpegChunkCommandTemplate('/usr/bin/ffmpeg', {
			format: 'ogg',
			oggQuality: 6,
		});

		assert.ok(template.startsWith('/usr/bin/ffmpeg '));
		assert.ok(template.includes('{input}'));
		assert.ok(template.includes('{output}'));
		assert.ok(template.includes('{startSec}'));
		assert.ok(template.includes('{endSec}'));
		assert.ok(template.includes('-q:a 6'));
	});
});
