import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import {
	escapeHtml,
	formatAudioLayout,
	formatChunkBytes,
	formatTime,
	formatWsolaShift,
} from '../../../media/player/formatUtils.js';

describe('formatUtils', () => {
	describe('formatTime', () => {
		it('formats minutes and zero-padded seconds', () => {
			expect(formatTime(65)).toBe('1:05');
			expect(formatTime(0)).toBe('0:00');
		});

		it('returns em dash for non-finite values', () => {
			expect(formatTime(Number.NaN)).toBe('—');
			expect(formatTime(Number.POSITIVE_INFINITY)).toBe('—');
		});
	});

	describe('formatChunkBytes', () => {
		it('formats B, KB, and MB', () => {
			expect(formatChunkBytes(512)).toBe('512B');
			expect(formatChunkBytes(2048)).toBe('2.0KB');
			expect(formatChunkBytes(2 * 1024 * 1024)).toBe('2.0MB');
		});
	});

	describe('formatAudioLayout', () => {
		it('formats channel and sample rate', () => {
			expect(formatAudioLayout({ manifestChannels: 2, manifestSampleRate: 44100 })).toBe('2ch @ 44100 Hz');
		});

		it('includes context rate when different', () => {
			const layout = formatAudioLayout({
				manifestChannels: 2,
				manifestSampleRate: 44100,
				contextSampleRate: 48000,
			});
			expect(layout).toBe('2ch @ 44100 Hz (ctx 48000 Hz)');
		});

		it('returns em dash when layout missing', () => {
			expect(formatAudioLayout({})).toBe('—');
		});
	});

	describe('formatWsolaShift', () => {
		it('formats milliseconds and samples', () => {
			expect(formatWsolaShift(441, 44100)).toBe('10.0ms(441)');
		});

		it('formats negative shifts with sign', () => {
			expect(formatWsolaShift(-102, 44100)).toBe('-2.3ms(-102)');
		});

		it('returns em dash when inputs missing', () => {
			expect(formatWsolaShift(null, 44100)).toBe('—');
		});
	});

	describe('escapeHtml', () => {
		it('escapes HTML special characters', () => {
			expect(escapeHtml('<script>"\'&</script>')).toBe('&lt;script&gt;&quot;&#39;&amp;&lt;/script&gt;');
		});
	});
});
