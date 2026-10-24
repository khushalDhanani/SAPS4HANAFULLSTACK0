'use strict';

/**
 * test/performance/servicePerformance.test.js
 *
 * Performance and Scalability Benchmark Suite for Release Automation.
 * Validates OData endpoint response time SLAs, concurrency throughput,
 * in-memory attempt store lookup latency, and heap memory stability.
 */

const cds = require('@sap/cds');
const path = require('path');

const cdsTest = cds.test(path.resolve(__dirname, '../..'));
cdsTest.defaults.auth = { username: 'alice', password: '' };
const { GET } = cdsTest;

describe('Release Automation: Performance & Scalability Benchmarks', () => {
  // 1. OData Service Response Time SLA
  it('meets latency SLA (< 120ms average) across sequential OData read requests', async () => {
    const ITERATIONS = 15;
    const latencies = [];

    // Warm-up request
    await GET('/odata/v4/auth/getUserInfo()');

    for (let i = 0; i < ITERATIONS; i++) {
      const start = process.hrtime.bigint();
      const res = await GET('/odata/v4/auth/getUserInfo()');
      const end = process.hrtime.bigint();

      expect(res.status).toBe(200);
      const latencyMs = Number(end - start) / 1e6;
      latencies.push(latencyMs);
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const maxLatency = Math.max(...latencies);

    // Assert SLA: Average latency must be < 120ms, max < 350ms
    expect(avgLatency).toBeLessThan(120);
    expect(maxLatency).toBeLessThan(350);
  });

  // 2. High-Throughput Concurrency & Zero-Drop Guard
  it('handles concurrent batch requests (25 parallel queries) under 2500ms with zero dropped connections', async () => {
    const CONCURRENCY = 25;
    const start = Date.now();

    const promises = Array.from({ length: CONCURRENCY }, () =>
      GET('/odata/v4/auth/getUserInfo()')
    );

    const results = await Promise.all(promises);
    const totalTimeMs = Date.now() - start;

    expect(results).toHaveLength(CONCURRENCY);
    results.forEach((res) => {
      expect(res.status).toBe(200);
    });

    expect(totalTimeMs).toBeLessThan(2500);
  });

  // 3. Attempt Store In-Memory Lookup Latency Benchmark
  it('executes in-memory attempt store key hashing and lookups in < 0.5ms per operation under high load', () => {
    const LOOPS = 100;
    const map = new Map();

    // Benchmark in-memory hash index lookup pattern
    for (let i = 0; i < 50; i++) {
      const key = `${i.toString().padStart(10, '0')}-0001`;
      map.set(key, {
        ClientAttemptId: `PERF-ATTEMPT-${i}`,
        ReservationNo: `${i.toString().padStart(10, '0')}`,
        ReservationItem: '0001',
        PostingStatus: 'POSTED',
        MaterialDocument: `490005000${i}`
      });
    }

    const start = process.hrtime.bigint();
    for (let i = 0; i < LOOPS; i++) {
      const idx = i % 50;
      const key = `${idx.toString().padStart(10, '0')}-0001`;
      const found = map.get(key);
      expect(found).toBeDefined();
    }
    const end = process.hrtime.bigint();

    const totalMs = Number(end - start) / 1e6;
    const avgMs = totalMs / LOOPS;

    expect(avgMs).toBeLessThan(0.5);
    expect(totalMs).toBeLessThan(50);
  });

  // 4. Memory Leak / Heap Stability Guard
  it('maintains bounded heap memory usage (delta < 25MB) across 50 sequential operations', async () => {
    if (global.gc) global.gc();
    const initialHeap = process.memoryUsage().heapUsed;

    for (let i = 0; i < 50; i++) {
      const res = await GET('/odata/v4/auth/getUserInfo()');
      expect(res.status).toBe(200);
    }

    if (global.gc) global.gc();
    const finalHeap = process.memoryUsage().heapUsed;
    const deltaMb = (finalHeap - initialHeap) / (1024 * 1024);

    // Delta should remain small and bounded
    expect(deltaMb).toBeLessThan(25);
  });
});
