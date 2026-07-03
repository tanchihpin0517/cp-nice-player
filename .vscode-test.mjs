import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	exclude: 'out/test/media/**/*.test.js',
});
