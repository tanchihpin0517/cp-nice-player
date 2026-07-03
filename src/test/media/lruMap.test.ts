import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { LruMap } from '../../../media/engine/lruMap.js';

describe('LruMap', () => {
	it('get refreshes LRU order for eviction', () => {
		const map = new LruMap(5);
		for (let i = 0; i < 5; i++) {
			map.set(i, i);
		}
		map.get(0);
		map.get(2);
		map.set(5, 5);
		map.set(6, 6);
		map.evictWhileOverCapacity(() => false);

		expect(map.size).toBe(5);
		expect(map.has(0)).toBe(true);
		expect(map.has(2)).toBe(true);
		expect(map.has(1)).toBe(false);
		expect(map.has(3)).toBe(false);
		expect(map.has(4)).toBe(true);
		expect(map.has(5)).toBe(true);
		expect(map.has(6)).toBe(true);
	});

	it('setMaxEntries clamps to at least 1', () => {
		const map = new LruMap(20);
		for (let i = 0; i < 15; i++) {
			map.set(i, i);
		}
		map.setMaxEntries(0);
		expect(map.maxEntries).toBe(1);
	});

	it('evictWhileOverCapacity removes oldest unpinned entry', () => {
		const map = new LruMap(5);
		for (let i = 0; i < 8; i++) {
			map.set(i, `v${i}`);
		}

		map.evictWhileOverCapacity(() => false);
		expect(map.size).toBe(5);
		expect(map.has(0)).toBe(false);
		expect(map.has(1)).toBe(false);
		expect(map.has(2)).toBe(false);
		for (let i = 3; i < 8; i++) {
			expect(map.has(i)).toBe(true);
		}
	});

	it('evictWhileOverCapacity skips pinned keys', () => {
		const map = new LruMap(5);
		for (let i = 0; i < 8; i++) {
			map.set(i, `v${i}`);
		}

		map.evictWhileOverCapacity((key) => key === 1);
		expect(map.size).toBe(5);
		expect(map.has(0)).toBe(false);
		expect(map.has(1)).toBe(true);
		expect(map.has(2)).toBe(false);
		expect(map.has(3)).toBe(false);
		for (let i = 4; i < 8; i++) {
			expect(map.has(i)).toBe(true);
		}
	});

	it('evictWhileOverCapacity stops when all entries are pinned', () => {
		const map = new LruMap(3);
		for (let i = 0; i < 6; i++) {
			map.set(i, `v${i}`);
		}

		map.evictWhileOverCapacity(() => true);
		expect(map.size).toBe(6);
	});

	it('constructor clamps maxEntries to at least 1', () => {
		const map = new LruMap(0);
		expect(map.maxEntries).toBe(1);
	});

	it('get returns stored value', () => {
		const map = new LruMap(10);
		for (let i = 0; i < 8; i++) {
			map.set(i, i * 10);
		}
		expect(map.get(5)).toBe(50);
	});

	it('get returns undefined for missing key', () => {
		const map = new LruMap(10);
		for (let i = 0; i < 8; i++) {
			map.set(i, i);
		}
		expect(map.get(99)).toBeUndefined();
	});

	it('set updates existing key without increasing size', () => {
		const map = new LruMap(10);
		for (let i = 0; i < 6; i++) {
			map.set(i, i);
		}
		map.set(2, 200);
		expect(map.size).toBe(6);
		expect(map.get(2)).toBe(200);
	});

	it('set refreshes LRU order for existing key', () => {
		const map = new LruMap(5);
		for (let i = 0; i < 5; i++) {
			map.set(i, i);
		}
		map.set(0, 100);
		map.set(5, 5);
		map.evictWhileOverCapacity(() => false);

		expect(map.size).toBe(5);
		expect(map.has(0)).toBe(true);
		expect(map.has(1)).toBe(false);
		for (let i = 2; i <= 5; i++) {
			expect(map.has(i)).toBe(true);
		}
	});

	it('delete removes an entry', () => {
		const map = new LruMap(10);
		for (let i = 0; i < 6; i++) {
			map.set(i, i);
		}
		expect(map.delete(2)).toBe(true);
		expect(map.has(2)).toBe(false);
		expect(map.size).toBe(5);
		for (const key of [0, 1, 3, 4, 5]) {
			expect(map.has(key)).toBe(true);
		}
	});

	it('delete returns false for missing key', () => {
		const map = new LruMap(10);
		for (let i = 0; i < 6; i++) {
			map.set(i, i);
		}
		expect(map.delete(99)).toBe(false);
	});

	it('clear removes all entries', () => {
		const map = new LruMap(10);
		for (let i = 0; i < 8; i++) {
			map.set(i, i);
		}
		map.clear();
		expect(map.size).toBe(0);
		for (let i = 0; i < 8; i++) {
			expect(map.has(i)).toBe(false);
		}
	});

	it('keys reflects current insertion order', () => {
		const map = new LruMap(10);
		for (let i = 0; i < 5; i++) {
			map.set(i, i);
		}
		map.get(2);
		expect([...map.keys()]).toEqual([0, 1, 3, 4, 2]);
	});

	it('evictWhileOverCapacity does nothing when at or under capacity', () => {
		const map = new LruMap(10);
		for (let i = 0; i < 7; i++) {
			map.set(i, i);
		}
		map.evictWhileOverCapacity(() => false);
		expect(map.size).toBe(7);
		for (let i = 0; i < 7; i++) {
			expect(map.has(i)).toBe(true);
		}
	});

	it('evictWhileOverCapacity removes multiple entries when far over capacity', () => {
		const map = new LruMap(5);
		for (let i = 0; i < 10; i++) {
			map.set(i, `v${i}`);
		}

		map.evictWhileOverCapacity(() => false);
		expect(map.size).toBe(5);
		for (let i = 0; i < 5; i++) {
			expect(map.has(i)).toBe(false);
		}
		for (let i = 5; i < 10; i++) {
			expect(map.has(i)).toBe(true);
		}
	});

	it('evictWhileOverCapacity evicts next oldest when first candidate is pinned', () => {
		const map = new LruMap(5);
		for (let i = 0; i < 8; i++) {
			map.set(i, `v${i}`);
		}

		map.evictWhileOverCapacity((key) => key === 0);
		expect(map.size).toBe(5);
		expect(map.has(0)).toBe(true);
		expect(map.has(1)).toBe(false);
		expect(map.has(2)).toBe(false);
		expect(map.has(3)).toBe(false);
		for (let i = 4; i < 8; i++) {
			expect(map.has(i)).toBe(true);
		}
	});

	it('setMaxEntries clamps negative values to 1', () => {
		const map = new LruMap(20);
		for (let i = 0; i < 15; i++) {
			map.set(i, i);
		}
		map.setMaxEntries(-3);
		expect(map.maxEntries).toBe(1);
	});

	it('constructor handles invalid maxEntries', () => {
		expect(new LruMap(NaN).maxEntries).toBe(1);
		expect(new LruMap(undefined).maxEntries).toBe(1);
	});
});
