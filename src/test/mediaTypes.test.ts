import * as assert from 'assert';
import * as vscode from 'vscode';
import { isSupportedAudio, MEDIA_FILE_FILTERS } from '../mediaTypes';

suite('Media types', () => {
	test('isSupportedAudio accepts known audio extensions', () => {
		assert.strictEqual(isSupportedAudio(vscode.Uri.file('/music/track.mp3')), true);
		assert.strictEqual(isSupportedAudio(vscode.Uri.file('/music/track.flac')), true);
		assert.strictEqual(isSupportedAudio(vscode.Uri.file('/music/track.MKV')), true);
	});

	test('isSupportedAudio rejects unsupported extensions', () => {
		assert.strictEqual(isSupportedAudio(vscode.Uri.file('/docs/readme.txt')), false);
		assert.strictEqual(isSupportedAudio(vscode.Uri.file('/docs/readme')), false);
	});

	test('MEDIA_FILE_FILTERS lists supported audio extensions', () => {
		const extensions = MEDIA_FILE_FILTERS.Audio;
		assert.ok(extensions.includes('mp3'));
		assert.ok(extensions.includes('flac'));
		assert.ok(extensions.includes('mkv'));
		assert.strictEqual(extensions.length, 10);
	});
});
