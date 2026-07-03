import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { getResourceRoots } from '../../playerPanel/playerSession';

suite('getResourceRoots', () => {
	test('always includes extension URI', () => {
		const extensionUri = vscode.Uri.file('/extensions/cp-nice-player');
		const roots = getResourceRoots(extensionUri);

		assert.ok(roots.some((root) => root.toString() === extensionUri.toString()));
	});

	test('includes workspace folders when present', () => {
		const extensionUri = vscode.Uri.file('/extensions/cp-nice-player');
		const workspaceFolder = vscode.Uri.file('/workspace/project');
		const originalFolders = vscode.workspace.workspaceFolders;

		Object.defineProperty(vscode.workspace, 'workspaceFolders', {
			configurable: true,
			value: [{ uri: workspaceFolder, name: 'project', index: 0 }],
		});

		try {
			const roots = getResourceRoots(extensionUri);
			assert.ok(roots.some((root) => root.toString() === workspaceFolder.toString()));
		} finally {
			Object.defineProperty(vscode.workspace, 'workspaceFolders', {
				configurable: true,
				value: originalFolders,
			});
		}
	});

	test('includes media parent directory and deduplicates', () => {
		const extensionUri = vscode.Uri.file('/extensions/cp-nice-player');
		const mediaUri = vscode.Uri.file('/workspace/project/audio/track.mp3');
		const roots = getResourceRoots(extensionUri, mediaUri);
		const mediaDirectory = vscode.Uri.file(path.dirname(mediaUri.fsPath));

		assert.ok(roots.some((root) => root.toString() === mediaDirectory.toString()));
		const unique = new Set(roots.map((root) => root.toString()));
		assert.strictEqual(unique.size, roots.length);
	});
});
