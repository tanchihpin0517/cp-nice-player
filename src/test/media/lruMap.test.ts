import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { LruMap } from '../../../media/engine/lruMap.js';

describe('LruMap', () => {
	it('get refreshes LRU order for eviction', () => {
		const map = new LruMap(2);
		map.set('a', 1);
		map.set('b', 2);
		map.get('a');
		map.set('c', 3);
		map.evictWhileOverCapacity(() => false);

		expect(map.has('a')).toBe(true);
		expect(map.has('b')).toBe(false);
		expect(map.has('c')).toBe(true);
	});

	it('setMaxEntries clamps to at least 1', () => {
		const map = new LruMap(5);
		map.setMaxEntries(0);
		expect(map.maxEntries).toBe(1);
	});

	it('evictWhileOverCapacity removes oldest unpinned entry', () => {
		const map = new LruMap(2);
		map.set(0, 'a');
		map.set(1, 'b');
		map.set(2, 'c');

		map.evictWhileOverCapacity(() => false);
		expect(map.size).toBe(2);
		expect(map.has(0)).toBe(false);
		expect(map.has(1)).toBe(true);
		expect(map.has(2)).toBe(true);
	});

	it('evictWhileOverCapacity skips pinned keys', () => {
		const map = new LruMap(2);
		map.set(0, 'a');
		map.set(1, 'b');
		map.set(2, 'c');

		map.evictWhileOverCapacity((key) => key === 1);
		expect(map.size).toBe(2);
		expect(map.has(0)).toBe(false);
		expect(map.has(1)).toBe(true);
		expect(map.has(2)).toBe(true);
	});

	it('evictWhileOverCapacity stops when all entries are pinned', () => {
		const map = new LruMap(1);
		map.set(0, 'a');
		map.set(1, 'b');

		map.evictWhileOverCapacity(() => true);
		expect(map.size).toBe(2);
	});

	it('constructor clamps maxEntries to at least 1', () => {
		const map = new LruMap(0);
		expect(map.maxEntries).toBe(1);
	});
});
