export interface MockAudioBufferOptions {
	length?: number;
	channels?: number;
	sampleRate?: number;
}

export function createMockAudioBuffer(options: MockAudioBufferOptions = {}): AudioBuffer {
	const length = options.length ?? 44100;
	const channels = options.channels ?? 2;
	const sampleRate = options.sampleRate ?? 44100;
	const channelData: Float32Array[] = [];

	for (let ch = 0; ch < channels; ch += 1) {
		const data = new Float32Array(length);
		for (let i = 0; i < length; i += 1) {
			data[i] = Math.sin(i / 100);
		}
		channelData.push(data);
	}

	return {
		duration: length / sampleRate,
		length,
		numberOfChannels: channels,
		sampleRate,
		getChannelData: (ch: number) => channelData[ch],
	} as AudioBuffer;
}

export function createMockAudioContext(sampleRate = 44100) {
	const context = {
		state: 'suspended' as AudioContextState,
		currentTime: 0,
		sampleRate,
		destination: {},
		audioWorklet: {
			addModule: async () => undefined,
		},
		createGain: () => ({
			gain: { value: 1 },
			connect: () => undefined,
			disconnect: () => undefined,
		}),
		async resume() {
			context.state = 'running';
		},
		async suspend() {
			context.state = 'suspended';
		},
		async close() {
			context.state = 'closed';
		},
		decodeAudioData: async () => createMockAudioBuffer({ sampleRate, channels: 2 }),
	};

	return context;
}

export class MockWorkletScheduler {
	channelCount = 0;
	sampleRate = 0;
	framesAvailable = 0;
	freeFrames = 0;
	underrunFrames = 0;
	totalFramesWritten = 0;
	capacityFrames = 0;
	initialized = false;

	get framesConsumed() {
		return this.totalFramesWritten - this.framesAvailable;
	}

	async init(_ctx: unknown, channelCount: number, sampleRate: number) {
		this.channelCount = channelCount;
		this.sampleRate = sampleRate;
		this.capacityFrames = sampleRate * 10;
		this.freeFrames = this.capacityFrames;
		this.initialized = true;
	}

	async play() {
		return undefined;
	}

	async pause() {
		return undefined;
	}

	reset() {
		this.framesAvailable = 0;
		this.totalFramesWritten = 0;
		this.freeFrames = this.capacityFrames;
	}

	setVolume(_value: number) {
		return undefined;
	}

	dispose() {
		return undefined;
	}

	async writePcm(_buffer: AudioBuffer, _offset: number, frameCount: number) {
		this.totalFramesWritten += frameCount;
		return frameCount;
	}
}

export async function setupEngineGlobals(): Promise<new () => EventTarget> {
	const { LruMap } = await import('../../../../media/engine/lruMap.js');
	const { PcmRing } = await import('../../../../media/engine/pcmRing.js');
	const chunkUtils = await import('../../../../media/engine/chunkUtils.js');
	const crossfade = await import('../../../../media/engine/crossfade.js');

	const globalScope = globalThis as Record<string, unknown>;
	globalScope.LruMap = LruMap;
	globalScope.PcmRing = PcmRing;
	Object.assign(globalScope, chunkUtils);
	Object.assign(globalScope, crossfade);
	globalScope.WorkletScheduler = MockWorkletScheduler;

	const existing = document.querySelector('meta[name="cp-worklet-module-url"]');
	if (!existing) {
		const meta = document.createElement('meta');
		meta.name = 'cp-worklet-module-url';
		meta.content = 'https://test.example/pcmWorkletProcessor.js';
		document.head.appendChild(meta);
	}

	globalScope.AudioContext = function AudioContext(this: unknown, options?: { sampleRate?: number }) {
		return createMockAudioContext(options?.sampleRate ?? 44100);
	};

	const engineModule = await import('../../../../media/engine/streamingAudioEngine.js');
	return engineModule.StreamingAudioEngine as new () => EventTarget;
}
