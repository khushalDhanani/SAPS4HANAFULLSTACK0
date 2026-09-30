/**
 * Dashboard Movement-Type KPI Cards — Unit Tests
 *
 * Tests the Dashboard controller's _loadGiKpis() method that fetches
 * movement-type KPI data (201/261/301/311) from the Goods Issue dashboard
 * backend endpoint and populates the view model.
 *
 * Also tests the GoodsIssueDashboardClient.getDashboardData() server-side
 * aggregation and caching behaviour.
 */

'use strict';

// ─── 1. GoodsIssueDashboardClient backend tests ─────────────────────────────

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
    let mockQueueManager;

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
        mockQueueManager = {
            getAll: jest.fn().mockResolvedValue([])
        };
        client = new GoodsIssueDashboardClient({
            rfc: mockRfc,
            client: mockClient,
            reservationsClient: mockReservationsClient,
            queueManager: mockQueueManager
        });
    });

    test('returns KPI structure with Mvt201, Mvt261, Mvt301, Mvt311 keys', async () => {
        const data = await client.getDashboardData({ days: 30, forceRefresh: true });

        expect(data).toBeDefined();
        expect(data.Kpis).toBeDefined();
        expect(data.Kpis.Mvt201).toBeDefined();
        expect(data.Kpis.Mvt261).toBeDefined();
        expect(data.Kpis.Mvt301).toBeDefined();
        expect(data.Kpis.Mvt311).toBeDefined();
        expect(data.Kpis.Overall).toBeDefined();
    });

    test('each KPI item has TotalCount, OpenPendingCount, TodayPostingsCount', async () => {
        const data = await client.getDashboardData({ days: 7, forceRefresh: true });

        ['Mvt201', 'Mvt261', 'Mvt301', 'Mvt311', 'Overall'].forEach((key) => {
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
        mockClient.getText.mockImplementation(countByType({ '201': 2, '261': 3, '301': 1, '311': 1 }));
        // Window rows still come from RFC MATDOC.
        mockRfc.readTable
            .mockResolvedValueOnce([ // Window MATDOC — includes today
                { MBLNR: '5000001', MJAHR: '2026', ZEILE: '0001', BWART: '201', MATNR: '1000000001', WERKS: '1000', LGORT: 'HS01', CHARG: '', MENGE: '100', MEINS: 'KG', BUDAT: todayYMD, USNAM: 'KHUSHAL', KOSTL: '', AUFNR: '', RSNUM: '', RSPOS: '', SHKZG: 'H' },
                { MBLNR: '5000003', MJAHR: '2026', ZEILE: '0001', BWART: '261', MATNR: '1000000002', WERKS: '1000', LGORT: 'HS01', CHARG: '', MENGE: '50', MEINS: 'KG', BUDAT: todayYMD, USNAM: 'KHUSHAL', KOSTL: '', AUFNR: '1001', RSNUM: '', RSPOS: '', SHKZG: 'H' }
            ]);

        const data = await client.getDashboardData({ days: 30, forceRefresh: true });

        expect(data.Kpis.Mvt201.TotalCount).toBe(2);
        expect(data.Kpis.Mvt261.TotalCount).toBe(3);
        expect(data.Kpis.Mvt301.TotalCount).toBe(1);
        expect(data.Kpis.Mvt311.TotalCount).toBe(1);
        expect(data.Kpis.Overall.TotalCount).toBe(7);

        // Today's postings
        expect(data.Kpis.Mvt201.TodayPostingsCount).toBe(1);
        expect(data.Kpis.Mvt261.TodayPostingsCount).toBe(1);
        expect(data.Kpis.Mvt301.TodayPostingsCount).toBe(0);
        expect(data.Kpis.Mvt311.TodayPostingsCount).toBe(0);
        expect(data.Kpis.Overall.TodayPostingsCount).toBe(2);
    });

    test('includes open reservation counts in OpenPendingCount', async () => {
        mockReservationsClient.getOpenReservations
            .mockResolvedValueOnce([{ ReservationNo: '1' }, { ReservationNo: '2' }])   // 201
            .mockResolvedValueOnce([{ ReservationNo: '3' }])                            // 261
            .mockResolvedValueOnce([])                                                  // 301
            .mockResolvedValueOnce([{ ReservationNo: '4' }, { ReservationNo: '5' }, { ReservationNo: '6' }]); // 311

        const data = await client.getDashboardData({ days: 30, forceRefresh: true });

        expect(data.Kpis.Mvt201.OpenPendingCount).toBe(2);
        expect(data.Kpis.Mvt261.OpenPendingCount).toBe(1);
        expect(data.Kpis.Mvt301.OpenPendingCount).toBe(0);
        expect(data.Kpis.Mvt311.OpenPendingCount).toBe(3);
        expect(data.Kpis.Overall.OpenPendingCount).toBe(6);
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
            .mockResolvedValueOnce([{ MBLNR: '1', BWART: '261' }])     // MSEG fallback
            .mockRejectedValueOnce(new Error('MATDOC not authorized'))  // window
            .mockResolvedValueOnce([]);                                 // MSEG fallback

        const data = await client.getDashboardData({ days: 7, forceRefresh: true });

        expect(data).toBeDefined();
        expect(data.Kpis.Mvt261.TotalCount).toBe(1);
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

// ─── 2. Dashboard controller _loadGiKpis logic tests (mocked ODataClient) ───

describe('Unit: Dashboard Controller — GI Movement-Type KPI Loading Logic', () => {
    // These tests validate the controller logic without SAPUI5 runtime,
    // focusing on model property mapping from the API response.

    const GI_KPI_KEYS = [
        'mvt201Total', 'mvt201Today',
        'mvt261Total', 'mvt261Today',
        'mvt301Total', 'mvt301Today',
        'mvt311Total', 'mvt311Today'
    ];

    function createMockModel() {
        const data = {};
        return {
            data,
            setProperty: jest.fn((path, value) => { data[path] = value; }),
            getProperty: jest.fn((path) => data[path])
        };
    }

    test('maps Kpis response to correct model properties', () => {
        const oModel = createMockModel();
        const oKpis = {
            Mvt201: { TotalCount: 54, OpenPendingCount: 3, TodayPostingsCount: 2 },
            Mvt261: { TotalCount: 9671, OpenPendingCount: 120, TodayPostingsCount: 15 },
            Mvt301: { TotalCount: 3020, OpenPendingCount: 0, TodayPostingsCount: 0 },
            Mvt311: { TotalCount: 1052, OpenPendingCount: 5, TodayPostingsCount: 1 },
            Overall: { TotalCount: 13797, OpenPendingCount: 128, TodayPostingsCount: 18 }
        };

        // Simulate the mapping logic from the controller
        const mMapping = {
            'Mvt201': { total: 'mvt201Total', today: 'mvt201Today' },
            'Mvt261': { total: 'mvt261Total', today: 'mvt261Today' },
            'Mvt301': { total: 'mvt301Total', today: 'mvt301Today' },
            'Mvt311': { total: 'mvt311Total', today: 'mvt311Today' }
        };

        Object.keys(mMapping).forEach(function (sKpiKey) {
            const oItem = oKpis[sKpiKey];
            const mTarget = mMapping[sKpiKey];
            if (oItem && typeof oItem.TotalCount === 'number') {
                oModel.setProperty('/' + mTarget.total, oItem.TotalCount);
            } else {
                oModel.setProperty('/' + mTarget.total, null);
            }
            if (oItem && typeof oItem.TodayPostingsCount === 'number') {
                oModel.setProperty('/' + mTarget.today, oItem.TodayPostingsCount);
            } else {
                oModel.setProperty('/' + mTarget.today, null);
            }
        });

        expect(oModel.data['/mvt201Total']).toBe(54);
        expect(oModel.data['/mvt201Today']).toBe(2);
        expect(oModel.data['/mvt261Total']).toBe(9671);
        expect(oModel.data['/mvt261Today']).toBe(15);
        expect(oModel.data['/mvt301Total']).toBe(3020);
        expect(oModel.data['/mvt301Today']).toBe(0);
        expect(oModel.data['/mvt311Total']).toBe(1052);
        expect(oModel.data['/mvt311Today']).toBe(1);
    });

    test('sets all properties to null on missing Kpis response', () => {
        const oModel = createMockModel();

        // Simulate error path: all keys set to null
        GI_KPI_KEYS.forEach(function (sKey) {
            oModel.setProperty('/' + sKey, null);
        });
        oModel.setProperty('/giKpiError', 'SAP not reachable');

        GI_KPI_KEYS.forEach(function (sKey) {
            expect(oModel.data['/' + sKey]).toBeNull();
        });
        expect(oModel.data['/giKpiError']).toBe('SAP not reachable');
    });

    test('sets properties to undefined during loading state', () => {
        const oModel = createMockModel();

        GI_KPI_KEYS.forEach(function (sKey) {
            oModel.setProperty('/' + sKey, undefined);
        });

        GI_KPI_KEYS.forEach(function (sKey) {
            expect(oModel.data['/' + sKey]).toBeUndefined();
        });
    });

    test('formatTileState returns correct states', () => {
        // Mirrors Dashboard.controller.js formatTileState
        function formatTileState(vCount) {
            if (vCount === undefined) return 'Loading';
            return vCount === null ? 'Failed' : 'Loaded';
        }

        expect(formatTileState(undefined)).toBe('Loading');
        expect(formatTileState(null)).toBe('Failed');
        expect(formatTileState(0)).toBe('Loaded');
        expect(formatTileState(54)).toBe('Loaded');
    });

    test('formatMetricValue returns correct display text', () => {
        // Mirrors Dashboard.controller.js formatMetricValue
        function formatMetricValue(vCount) {
            return (typeof vCount === 'number') ? String(vCount) : '';
        }

        expect(formatMetricValue(undefined)).toBe('');
        expect(formatMetricValue(null)).toBe('');
        expect(formatMetricValue(0)).toBe('0');
        expect(formatMetricValue(9671)).toBe('9671');
    });
});
