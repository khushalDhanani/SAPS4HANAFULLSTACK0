/**
 * Unit tests for HuBatchReader: chunked reads with progress, per-item timeout + retry,
 * abort-on-failure (test 8 logic) and cancel-stops (test 9 logic).
 */
let Reader;
global.sap = { ui: { define: (deps, f) => { Reader = f(); } } };
require('../../../app/fiori-app/webapp/modules/wm/handling-unit/util/HuBatchReader.js');

const delay = (ms, v) => new Promise(r => setTimeout(() => r(v), ms));

describe('HuBatchReader.read', () => {
    it('reads every item in order and reports cumulative progress', async () => {
        const items = [1, 2, 3, 4, 5];
        const progress = [];
        const out = await Reader.read(items, (x) => Promise.resolve(x * 10), {
            chunk: 2, onProgress: (n) => progress.push(n)
        });
        expect(out).toEqual([10, 20, 30, 40, 50]);
        expect(progress).toEqual([2, 4, 5]); // one tick per chunk (2+2+1)
    });

    it('retries a failed read once, then succeeds', async () => {
        let calls = 0;
        const out = await Reader.read(['a'], () => {
            calls++;
            return calls === 1 ? Promise.reject(new Error('flaky')) : Promise.resolve('ok');
        }, { retries: 1, timeoutMs: 1000 });
        expect(out).toEqual(['ok']);
        expect(calls).toBe(2);
    });

    it('rejects (aborts the whole job) when an item still fails after all retries', async () => {
        let calls = 0;
        await expect(Reader.read(['a', 'b'], () => { calls++; return Promise.reject(new Error('down')); },
            { chunk: 1, retries: 1, timeoutMs: 1000 })).rejects.toThrow('down');
        expect(calls).toBe(2); // 1 attempt + 1 retry on the first item, then abort (second item never read)
    });

    it('stops early on cancel and does not read the remaining items', async () => {
        const read = [];
        let done = 0;
        const out = await Reader.read([1, 2, 3, 4, 5, 6], (x) => { read.push(x); return Promise.resolve(x); }, {
            chunk: 2,
            onProgress: () => { done += 1; },
            isCancelled: () => done >= 1 // cancel after the first chunk completes
        });
        expect(out).toEqual([1, 2]);     // only the first chunk
        expect(read).toEqual([1, 2]);    // items 3..6 were never read
    });

    it('times out a read that never settles, then (no retries) rejects', async () => {
        await expect(Reader.read(['x'], () => new Promise(() => { }), { timeoutMs: 20, retries: 0 }))
            .rejects.toThrow(/timed out/);
    });

    it('withTimeout resolves a fast promise and rejects a slow one', async () => {
        await expect(Reader.withTimeout(delay(5, 'fast'), 100)).resolves.toBe('fast');
        await expect(Reader.withTimeout(delay(100, 'slow'), 20)).rejects.toThrow(/timed out/);
    });
});
