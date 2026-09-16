const TtlCache = require('../../../srv/common/TtlCache');

describe('Unit: TtlCache', () => {
    test('stores and retrieves values within TTL', () => {
        const cache = new TtlCache({ defaultTtlMs: 5000 });
        cache.set('key1', 'val1');

        expect(cache.get('key1')).toBe('val1');
        expect(cache.has('key1')).toBe(true);
        expect(cache.size).toBe(1);
    });

    test('returns undefined for non-existent key', () => {
        const cache = new TtlCache();
        expect(cache.get('missing')).toBeUndefined();
        expect(cache.has('missing')).toBe(false);
    });

    test('expires items after custom TTL', async () => {
        const cache = new TtlCache({ defaultTtlMs: 50 });
        cache.set('temp', 'data', 20); // 20ms TTL

        expect(cache.get('temp')).toBe('data');
        await new Promise(r => setTimeout(r, 35));

        expect(cache.get('temp')).toBeUndefined();
        expect(cache.has('temp')).toBe(false);
    });

    test('evicts oldest entry when maxEntries is exceeded', () => {
        const cache = new TtlCache({ maxEntries: 2, defaultTtlMs: 60000 });
        cache.set('a', 1);
        cache.set('b', 2);
        expect(cache.size).toBe(2);

        // Access 'a' to refresh LRU order: now 'b' is oldest
        cache.get('a');

        // Add 'c', which should evict 'b'
        cache.set('c', 3);
        expect(cache.size).toBe(2);
        expect(cache.get('a')).toBe(1);
        expect(cache.get('b')).toBeUndefined();
        expect(cache.get('c')).toBe(3);
    });

    test('deletes individual keys and clears all keys', () => {
        const cache = new TtlCache();
        cache.set('k1', 'v1');
        cache.set('k2', 'v2');

        expect(cache.delete('k1')).toBe(true);
        expect(cache.get('k1')).toBeUndefined();
        expect(cache.get('k2')).toBe('v2');

        cache.clear();
        expect(cache.size).toBe(0);
        expect(cache.get('k2')).toBeUndefined();
    });

    test('getOrSet returns cached value on hit without calling fetchFn', async () => {
        const cache = new TtlCache();
        cache.set('k1', 'cached_value');

        const fetchFn = jest.fn();
        const result = await cache.getOrSet('k1', fetchFn);

        expect(result).toBe('cached_value');
        expect(fetchFn).not.toHaveBeenCalled();
    });

    test('getOrSet calls fetchFn on miss and caches result', async () => {
        const cache = new TtlCache();
        const fetchFn = jest.fn().mockResolvedValue('fetched_value');

        const result = await cache.getOrSet('k1', fetchFn, 5000);
        expect(result).toBe('fetched_value');
        expect(fetchFn).toHaveBeenCalledTimes(1);

        // Second call should return cached value
        const result2 = await cache.getOrSet('k1', fetchFn);
        expect(result2).toBe('fetched_value');
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    test('getOrSet coalesces concurrent in-flight requests into single call', async () => {
        const cache = new TtlCache();
        let resolvePromise;
        const delayedPromise = new Promise(r => { resolvePromise = r; });
        const fetchFn = jest.fn().mockImplementation(() => delayedPromise);

        // Fire 3 simultaneous getOrSet calls for the same key
        const p1 = cache.getOrSet('shared_key', fetchFn);
        const p2 = cache.getOrSet('shared_key', fetchFn);
        const p3 = cache.getOrSet('shared_key', fetchFn);

        expect(fetchFn).toHaveBeenCalledTimes(1);

        resolvePromise({ data: 42 });
        const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

        expect(r1).toEqual({ data: 42 });
        expect(r2).toEqual({ data: 42 });
        expect(r3).toEqual({ data: 42 });
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    test('getOrSet cleans up in-flight promise if fetchFn throws', async () => {
        const cache = new TtlCache();
        const fetchFn = jest.fn().mockRejectedValue(new Error('Fetch failed'));

        await expect(cache.getOrSet('bad_key', fetchFn)).rejects.toThrow('Fetch failed');

        // Verify inFlight was cleaned up so a retry is allowed
        const retryFn = jest.fn().mockResolvedValue('success');
        const result = await cache.getOrSet('bad_key', retryFn);
        expect(result).toBe('success');
        expect(retryFn).toHaveBeenCalledTimes(1);
    });
});
