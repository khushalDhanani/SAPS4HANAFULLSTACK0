'use strict';

/**
 * Lightweight, in-memory TTL (Time-To-Live) cache with LRU eviction and
 * in-flight promise coalescing to eliminate cache stampedes.
 */
class TtlCache {
  /**
   * @param {Object} [options]
   * @param {number} [options.defaultTtlMs=60000] - Default TTL in milliseconds (default: 60s)
   * @param {number} [options.maxEntries=1000] - Maximum cache capacity before LRU eviction
   */
  constructor({ defaultTtlMs = 60000, maxEntries = 1000 } = {}) {
    this.defaultTtlMs = Math.max(1, Number(defaultTtlMs) || 60000);
    this.maxEntries = Math.max(1, Number(maxEntries) || 1000);
    this.map = new Map();
    this.inFlight = new Map();
  }

  /**
   * Returns current number of active entries in cache.
   * @returns {number}
   */
  get size() {
    return this.map.size;
  }

  /**
   * Retrieves a cached value if present and not expired.
   *
   * @param {string} key
   * @returns {any} Value or undefined if not found or expired
   */
  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }

    // Refresh insertion order for LRU behavior
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  /**
   * Stores a value in the cache with the given or default TTL.
   *
   * @param {string} key
   * @param {any} value
   * @param {number} [ttlMs] - Optional custom TTL in milliseconds
   * @returns {this}
   */
  set(key, value, ttlMs) {
    const ttl = Math.max(1, Number(ttlMs) || this.defaultTtlMs);
    const expiresAt = Date.now() + ttl;

    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      // Evict oldest entry (first item in Map iterator)
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }

    this.map.set(key, { value, expiresAt });
    return this;
  }

  /**
   * Checks whether a non-expired entry exists for the given key.
   *
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this.get(key) !== undefined;
  }

  /**
   * Deletes a key from the cache and any active in-flight tracking.
   *
   * @param {string} key
   * @returns {boolean}
   */
  delete(key) {
    this.inFlight.delete(key);
    return this.map.delete(key);
  }

  /**
   * Clears all entries from the cache and active in-flight promises.
   */
  clear() {
    this.map.clear();
    this.inFlight.clear();
  }

  /**
   * Retrieves the value for a key from cache, or invokes fetchFn(), caches the result,
   * and returns it. If multiple callers request the same key concurrently while a fetch
   * is in progress, they share the single in-flight promise (coalescing).
   *
   * @param {string} key
   * @param {() => Promise<any>} fetchFn
   * @param {number} [ttlMs]
   * @returns {Promise<any>}
   */
  async getOrSet(key, fetchFn, ttlMs) {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    if (this.inFlight.has(key)) {
      return await this.inFlight.get(key);
    }

    const promise = (async () => {
      try {
        const val = await fetchFn();
        if (val !== undefined) {
          this.set(key, val, ttlMs);
        }
        return val;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return await promise;
  }
}

module.exports = TtlCache;
