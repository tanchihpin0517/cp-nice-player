import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	resolve: {
		alias: {
			'@media': path.resolve(__dirname, 'media'),
		},
	},
	test: {
		environment: 'jsdom',
		include: ['src/test/media/**/*.test.ts'],
		fakeTimers: {
			toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
		},
	},
});
