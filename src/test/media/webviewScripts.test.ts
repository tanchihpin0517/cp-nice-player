import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The webview loads every file as a classic <script>, so they all share one
 * global lexical scope: two files declaring the same top-level `const` is a
 * SyntaxError that kills the second file outright. Nothing else catches it —
 * the other tests import these files as ES modules, where each gets its own
 * scope, so a collision passes every unit test and breaks the real player.
 */

const ROOT = join(__dirname, '..', '..', '..');

/** Placeholder in player.html -> the file the extension substitutes for it. */
const SCRIPT_SOURCES: Record<string, string> = {
	pcmRingUri: 'media/engine/pcmRing.js',
	workletSchedulerUri: 'media/engine/workletScheduler.js',
	lruMapUri: 'media/engine/lruMap.js',
	chunkUtilsUri: 'media/engine/chunkUtils.js',
	crossfadeUri: 'media/engine/crossfade.js',
	engineScriptUri: 'media/engine/streamingAudioEngine.js',
	formatUtilsUri: 'media/player/formatUtils.js',
	waveformUri: 'media/player/waveform.js',
	playerViewUri: 'media/player/playerView.js',
	scriptUri: 'media/player/player.js',
};

function scriptPlaceholders(): string[] {
	const html = readFileSync(join(ROOT, 'media', 'player', 'player.html'), 'utf8');
	return [...html.matchAll(/<script src="\{\{(\w+)\}\}"><\/script>/g)].map((match) => match[1]);
}

function topLevelDeclarations(relativePath: string): string[] {
	const source = readFileSync(join(ROOT, relativePath), 'utf8');
	// Column 0 only: anything indented is nested and cannot collide globally.
	return [...source.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)]
		.map((match) => match[1]);
}

describe('webview script loading', () => {
	it('knows about every script player.html loads', () => {
		// Forces this test to be updated when a script is added, so the collision
		// check below never silently stops covering part of the player.
		expect(scriptPlaceholders().sort()).toEqual(Object.keys(SCRIPT_SOURCES).sort());
	});

	it('declares no name in two files at once', () => {
		const owners = new Map<string, string[]>();
		for (const placeholder of scriptPlaceholders()) {
			const path = SCRIPT_SOURCES[placeholder];
			for (const name of new Set(topLevelDeclarations(path))) {
				owners.set(name, [...(owners.get(name) ?? []), path]);
			}
		}

		const collisions = [...owners.entries()]
			.filter(([, files]) => files.length > 1)
			.map(([name, files]) => `${name} declared in ${files.join(' and ')}`);

		expect(collisions).toEqual([]);
	});
});
