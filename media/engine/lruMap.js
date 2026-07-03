class LruMap {
  constructor(maxEntries) {
    this.maxEntries = Math.max(1, Number(maxEntries) || 1);
    this.map = new Map();
  }

  get size() {
    return this.map.size;
  }

  has(key) {
    return this.map.has(key);
  }

  get(key) {
    const value = this.map.get(key);
    if (value === undefined) {
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  keys() {
    return this.map.keys();
  }

  setMaxEntries(maxEntries) {
    this.maxEntries = Math.max(1, Number(maxEntries) || 1);
  }

  evictWhileOverCapacity(isPinned) {
    while (this.map.size > this.maxEntries) {
      let evicted = false;
      for (const key of this.map.keys()) {
        if (isPinned(key)) {
          continue;
        }
        this.map.delete(key);
        evicted = true;
        break;
      }
      if (!evicted) {
        break;
      }
    }
  }
}

window.LruMap = LruMap;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LruMap };
}
