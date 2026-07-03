export interface ChunkManifest {
	version: 1;
	durationSec: number;
	channels: number;
	sampleRate: number;
	encode: {
		format: string;
		codec: string;
		contentType: string;
	};
	chunking: {
		targetDurationSec: number;
		crossfadeMs: number;
		count: number;
		strategy: 'frame-aligned';
		chunks: Array<{
			index: number;
			startSec: number;
			endSec: number;
			startByte: number;
			endByte: number;
			startFrame: number;
			endFrame: number;
			crossfadeEndFrame: number;
			crossfadeEndSec: number;
		}>;
	};
}

export function validManifest(): ChunkManifest {
	return {
		version: 1,
		durationSec: 5.0,
		channels: 2,
		sampleRate: 44100,
		encode: {
			format: 'ogg',
			codec: 'ogg',
			contentType: 'audio/ogg',
		},
		chunking: {
			targetDurationSec: 1,
			crossfadeMs: 20,
			count: 5,
			strategy: 'frame-aligned',
			chunks: [
				{ index: 0, startSec: 0, endSec: 1, startByte: 0, endByte: 99, startFrame: 0, endFrame: 10, crossfadeEndFrame: 12, crossfadeEndSec: 1.02 },
				{ index: 1, startSec: 1, endSec: 2, startByte: 100, endByte: 199, startFrame: 11, endFrame: 20, crossfadeEndFrame: 22, crossfadeEndSec: 2.02 },
				{ index: 2, startSec: 2, endSec: 3, startByte: 200, endByte: 299, startFrame: 21, endFrame: 30, crossfadeEndFrame: 32, crossfadeEndSec: 3.02 },
				{ index: 3, startSec: 3, endSec: 4, startByte: 300, endByte: 399, startFrame: 31, endFrame: 40, crossfadeEndFrame: 42, crossfadeEndSec: 4.02 },
				{ index: 4, startSec: 4, endSec: 5, startByte: 400, endByte: 499, startFrame: 41, endFrame: 50, crossfadeEndFrame: 50, crossfadeEndSec: 5 },
			],
		},
	};
}
