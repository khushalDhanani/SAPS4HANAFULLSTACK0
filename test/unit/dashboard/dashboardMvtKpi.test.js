/**
 * Dashboard Movement-Type KPI Cards — Unit Tests
 *
 * Tests the GoodsIssueDashboardClient.getDashboardData() server-side
 * aggregation and caching behaviour.
 */

'use strict';

// ─── GoodsIssueDashboardClient backend tests ─────────────────────────────

const GoodsIssueDashboardClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssueDashboardClient');

// All-time counts come from a SAP-side OData $count (client.getText). This returns the per-movement
// -type count from the $filter, mirroring SAP, so the unit test never hits a live backend.
function countByType(map) {
    return (path, opts) => {
        const f = decodeURIComponent((opts && opts.query) || '');
        const m = f.match(/GoodsMovementType eq '(\d+)'/);
        const t = m ? m[1] : '';
        return Promise.resolve(String(map[t] != null ? map[t] : 0));
    };
}

describe('Unit: GoodsIssueDashboardClient — Movement Type KPI Aggregation', () => {
    let client;
    let mockRfc;
    let mockClient;
    let mockReservationsClient;

    beforeEach(() => {
        mockRfc = {
            readTable: jest.fn().mockResolvedValue([])
        };
        mockClient = {
            getText: jest.fn().mockResolvedValue('0')
        };
        mockReservationsClient = {
            getOpenReservations: jest.fn().mockResolvedValue([])
        };
        client = new GoodsIssueDashboardClient({
            rfc: mockRfc,
            client: mockClient,
            reservationsClient: mockReservationsClient
        });
    });

    test('returns KPI structure with Mvt201, Mvt301, Mvt311 keys', async () => {
        const data = await client.getDashboardData({ days: 30, forceRefresh: true });

        expect(data).toBeDefined();
        expect(data.Kpis).toBeDefined();
        expect(data.Kpis.Mvt201).toBeDefined();
        expect(data.Kpis.Mvt301).toBeDefined();
        expect(data.Kpis.Mvt311).toBeDefined();
        expect(data.Kpis.Overall).toBeDefined();
    });

    test('each KPI item has TotalCount, OpenPendingCount, TodayPostingsCount', async () => {
        const data = await client.getDashboardData({ days: 7, forceRefresh: true });

        ['Mvt201', 'Mvt301', 'Mvt311', 'Overall'].forEach((key) => {
            const item = data.Kpis[key];
            expect(typeof item.TotalCount).toBe('number');
            expect(typeof item.OpenPendingCount).toBe('number');
            expect(typeof item.TodayPostingsCount).toBe('number');
        });
    });

    test('aggregates MATDOC rows by movement type correctly', async () => {
        const today = new Date();
        const todayYMD = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

        // All-time counts now come from the SAP-side OData $count (per movement type).
        mockClient.getText.mockImplementation(countByType({ '201': 2, '301': 1, '311': 1 }));
        // Window rows still come from RFC MATDOC.
        mockRfc.readTable
            .mockResolvedValueOnce([ // Window MATDOC — includes today
                { MBLNR: '5000001', MJAHR: '2026', ZEILE: '0001', BWART: '201', MATNR: '1000000001', WERKS: '1000', LGORT: 'HS01', CHARG: '', MENGE: '100', MEINS: 'KG', BUDAT: todayYMD, USNAM: 'KHUSHAL', KOSTL: '', AUFNR: '', RSNUM: '', RSPOS: '', SHKZG: 'H' }
            ]);

        const data = await client.getDashboardData({ days: 30, forceRefresh: true });

        expect(data.Kpis.Mvt201.TotalCount).toBe(2);
        expect(data.Kpis.Mvt301.TotalCount).toBe(1);
        expect(data.Kpis.Mvt311.TotalCount).toBe(1);
        expect(data.Kpis.Overall.TotalCount).toBe(4);

        // Today's postings
        expect(data.Kpis.Mvt201.TodayPostingsCount).toBe(1);
        expect(data.Kpis.Mvt301.TodayPostingsCount).toBe(0);
        expect(data.Kpis.Mvt311.TodayPostingsCount).toBe(0);
        expect(data.Kpis.Overall.TodayPostingsCount).toBe(1);
    });

    test('includes open reservation counts in OpenPendingCount', async () => {
        mockReservationsClient.getOpenReservations
            .mockResolvedValueOnce([{ ReservationNo: '1' }, { ReservationNo: '2' }])   // 201
            .mockResolvedValueOnce([])                                                  // 301
            .mockResolvedValueOnce([{ ReservationNo: '4' }, { ReservationNo: '5' }, { ReservationNo: '6' }]); // 311

        const data = await client.getDashboardData({ days: 30, forceRefresh: true });

        expect(data.Kpis.Mvt201.OpenPendingCount).toBe(2);
        expect(data.Kpis.Mvt301.OpenPendingCount).toBe(0);
        expect(data.Kpis.Mvt311.OpenPendingCount).toBe(3);
        expect(data.Kpis.Overall.OpenPendingCount).toBe(5);
    });

    test('caches results within TTL window', async () => {
        await client.getDashboardData({ days: 30 });
        await client.getDashboardData({ days: 30 });

        // Second call should use cache — RFC readTable should only be called once per query type
        // (first call triggers all-time + window queries = 2 readTable calls)
        const callCount = mockRfc.readTable.mock.calls.length;
        expect(callCount).toBeLessThanOrEqual(2);
    });

    test('forceRefresh bypasses cache', async () => {
        await client.getDashboardData({ days: 30 });
        const firstCallCount = mockRfc.readTable.mock.calls.length;

        await client.getDashboardData({ days: 30, forceRefresh: true });
        const secondCallCount = mockRfc.readTable.mock.calls.length;

        expect(secondCallCount).toBeGreaterThan(firstCallCount);
    });

    test('handles MATDOC read failure with MSEG fallback gracefully', async () => {
        // OData $count unavailable -> all-time count falls back to the RFC MATDOC/MSEG row-count.
        mockClient.getText.mockRejectedValue(new Error('OData $count not available'));
        mockRfc.readTable
            .mockRejectedValueOnce(new Error('MATDOC not authorized'))  // all-time
            .mockResolvedValueOnce([{ MBLNR: '1', BWART: '201' }])     // MSEG fallback
            .mockRejectedValueOnce(new Error('MATDOC not authorized'))  // window
            .mockResolvedValueOnce([]);                                 // MSEG fallback

        const data = await client.getDashboardData({ days: 7, forceRefresh: true });

        expect(data).toBeDefined();
        expect(data.Kpis.Mvt201.TotalCount).toBe(1);
    });

    test('returns LastUpdated timestamp', async () => {
        const data = await client.getDashboardData({ days: 30, forceRefresh: true });

        expect(data.LastUpdated).toBeDefined();
        expect(new Date(data.LastUpdated).getTime()).not.toBeNaN();
    });

    test('validates plant code format', async () => {
        await expect(
            client.getDashboardData({ days: 30, plant: 'INVALID_LONG_PLANT', forceRefresh: true })
        ).rejects.toThrow(/Invalid plant code/);
    });
});
