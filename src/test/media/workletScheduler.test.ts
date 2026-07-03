import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockAudioBuffer, createMockAudioContext } from './helpers/mockAudioContext';

// @ts-expect-error plain JS module
import { WorkletScheduler } from '../../../media/engine/workletScheduler.js';
// @ts-expect-error plain JS module
import { PcmRing } from '../../../media/engine/pcmRing.js';

(globalThis as Record<string, unknown>).PcmRing = PcmRing;

describe('WorkletScheduler', () => {
	let scheduler: InstanceType<typeof WorkletScheduler>;
	let mockPort: {
		onmessage: ((event: { data: Record<string, unknown> }) => void) | null;
		postMessage: (msg: Record<string, unknown>) => void;
	};

	beforeEach(() => {
		vi.useRealTimers();
		mockPort = {
			onmessage: null,
			postMessage(msg) {
				const deliver = () => {
					if (msg.type === 'writeBlock') {
						const requested = (msg.channels as Float32Array[])[0]?.length ?? 0;
						const accepted = requested;
						this.onmessage?.({
							data: {
								type: 'writeAck',
								requested,
								accepted,
								framesAvailable: accepted,
								capacityFrames: 1000,
								freeFrames: 1000 - accepted,
								underrunFrames: 0,
							},
						});
					}
					if (msg.type === 'reset') {
						this.onmessage?.({
							data: {
								type: 'stats',
								framesAvailable: 0,
								capacityFrames: 1000,
								freeFrames: 1000,
								underrunFrames: 0,
							},
						});
					}
				};
				queueMicrotask(deliver);
			},
		};

		const ctx = createMockAudioContext(44100);
		ctx.audioWorklet.addModule = vi.fn(async () => undefined);
		(globalThis as { AudioWorkletNode: unknown }).AudioWorkletNode = class {
			port = mockPort;
			connect = vi.fn();
			disconnect = vi.fn();
			constructor(_ctx: unknown, _name: string) {
				return this;
			}
		};

		global.fetch = vi.fn(async () => ({
			ok: true,
			text: async () => 'class PcmRingReader {} registerProcessor();',
		})) as typeof fetch;

		scheduler = new WorkletScheduler({
			workletModuleUrl: 'https://test.example/pcmWorkletProcessor.js',
			ringCapacitySec: 1,
		});
		(globalThis as { __testCtx: unknown }).__testCtx = ctx;
	});

	it('init loads worklet module and creates nodes', async () => {
		const ctx = (globalThis as { __testCtx: ReturnType<typeof createMockAudioContext> }).__testCtx;
		await scheduler.init(ctx, 2, 44100);

		expect(ctx.audioWorklet.addModule).toHaveBeenCalled();
		expect(scheduler.channelCount).toBe(2);
		expect(scheduler.sampleRate).toBe(44100);
	});

	it('writePcm sends blocks and waits for writeAck', async () => {
		const ctx = (globalThis as { __testCtx: ReturnType<typeof createMockAudioContext> }).__testCtx;
		await scheduler.init(ctx, 1, 44100);
		scheduler.freeFrames = scheduler.capacityFrames;

		const buffer = createMockAudioBuffer({ length: 256, channels: 1, sampleRate: 44100 });
		const written = await scheduler.writePcm(buffer, 0, 128);

		expect(written).toBe(128);
		expect(scheduler.totalFramesWritten).toBe(128);
	});

	it('reset clears ring stats via port message', async () => {
		const ctx = (globalThis as { __testCtx: ReturnType<typeof createMockAudioContext> }).__testCtx;
		await scheduler.init(ctx, 1, 44100);
		scheduler.totalFramesWritten = 50;
		scheduler.framesAvailable = 10;

		scheduler.reset();
		expect(scheduler.totalFramesWritten).toBe(0);
		expect(scheduler.framesAvailable).toBe(0);
	});

	it('play resumes suspended context', async () => {
		const ctx = (globalThis as { __testCtx: ReturnType<typeof createMockAudioContext> }).__testCtx;
		await scheduler.init(ctx, 1, 44100);
		await scheduler.play();
		expect(ctx.state).toBe('running');
	});
});
