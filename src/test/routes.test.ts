import * as assert from 'assert';
import * as vscode from 'vscode';
import { createRouteHandlers, matchRoute } from '../playback/stream/routes';
import { Registry } from '../playback/stream/registry';

suite('Route matching', () => {
	const handlers = createRouteHandlers(
		new Registry(),
		{} as unknown as vscode.ExtensionContext,
	);

	test('matches /index exactly', () => {
		assert.ok(matchRoute(handlers, '/index'));
	});

	test('matches parameterized chunk routes', () => {
		assert.ok(matchRoute(handlers, '/chunk/0'));
		assert.ok(matchRoute(handlers, '/chunk/42'));
	});

	test('rejects unknown paths', () => {
		assert.strictEqual(matchRoute(handlers, '/audio'), undefined);
		assert.strictEqual(matchRoute(handlers, '/chunk/foo'), undefined);
		assert.strictEqual(matchRoute(handlers, '/chunk/-1'), undefined);
	});
});
