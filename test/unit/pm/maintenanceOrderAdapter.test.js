'use strict';

const MaintenanceOrderAdapter = require('../../../srv/integration/s4hana/pm/maintenance-order/MaintenanceOrderAdapter');
const { _parseODataV2Date, _formatRow, _buildFilter } = MaintenanceOrderAdapter;

// Pull internal helpers for unit testing
const { MaintenanceOrderAdapter: AdapterClass } = MaintenanceOrderAdapter;

describe('MaintenanceOrderAdapter', () => {
    let adapter;
    let mockClient;

    beforeEach(() => {
        mockClient = {
            get: jest.fn()
        };
        adapter = new AdapterClass({ client: mockClient });
    });

    // ─── _parseODataV2Date ─────────────────────────────────────────────────────

    describe('_parseODataV2Date', () => {
        test('parses /Date(ms)/ correctly', () => {
            expect(_parseODataV2Date('/Date(1234567890000)/')).toBe('2009-02-13');
        });

        test('parses /Date(ms+0000)/ (with offset) correctly', () => {
            expect(_parseODataV2Date('/Date(1700000000000+0000)/')).toBe('2023-11-14');
        });

        test('returns empty string for null', () => {
            expect(_parseODataV2Date(null)).toBe('');
        });

        test('returns empty string for undefined', () => {
            expect(_parseODataV2Date(undefined)).toBe('');
        });

        test('passes through a plain YYYY-MM-DD string', () => {
            expect(_parseODataV2Date('2024-03-15')).toBe('2024-03-15');
        });

        test('handles a Date object', () => {
            const d = new Date('2024-06-01T00:00:00.000Z');
            expect(_parseODataV2Date(d)).toBe('2024-06-01');
        });
    });

    // ─── _buildFilter ─────────────────────────────────────────────────────────

    describe('_buildFilter', () => {
        test('returns empty string for no params', () => {
            expect(_buildFilter({})).toBe('');
        });

        test('builds plant filter', () => {
            const f = _buildFilter({ plant: '1000' });
            expect(f).toContain("MaintenancePlant eq '1000'");
        });

        test('builds orderType filter', () => {
            const f = _buildFilter({ orderType: 'PM01' });
            expect(f).toContain("MaintenanceOrderType eq 'PM01'");
        });

        test('builds priority filter', () => {
            const f = _buildFilter({ priority: '1' });
            expect(f).toContain("MaintPriority eq '1'");
        });

        test('builds substringof search filter across all search fields', () => {
            const f = _buildFilter({ searchQuery: 'pump' });
            expect(f).toContain('substringof');
            expect(f).toContain('MaintenanceOrderDesc');
            expect(f).toContain('MaintenanceOrder');
            expect(f).toContain('Equipment');
            expect(f).toContain('EquipmentName');
        });

        test('combines multiple filters with and', () => {
            const f = _buildFilter({ plant: '1000', orderType: 'PM01' });
            expect(f).toContain(' and ');
            expect(f).toContain("MaintenancePlant eq '1000'");
            expect(f).toContain("MaintenanceOrderType eq 'PM01'");
        });
    });

    // ─── adapter.list() ───────────────────────────────────────────────────────

    describe('list()', () => {
        const makeResponse = (results, count) => ({
            data: { d: { results, __count: String(count) } }
        });

        test('calls correct service path and entity set with no params', async () => {
            mockClient.get.mockResolvedValue(makeResponse([], 0));
            await adapter.list({});
            expect(mockClient.get).toHaveBeenCalledTimes(1);
            const url = mockClient.get.mock.calls[0][0];
            expect(url).toContain('/sap/opu/odata/sap/API_MAINTENANCEORDER;v=2/MaintenanceOrder');
            expect(url).toContain('$orderby=MaintOrderCreationDateTime desc');
            expect(url).toContain('$inlinecount=allpages');
            expect(url).toContain('$format=json');
            expect(url).toContain('$select=');
        });

        test('returns mapped items and totalCount', async () => {
            const raw = [{
                MaintenanceOrder: '4000054724',
                MaintenanceOrderType: 'PM01',
                MaintenanceOrderDesc: 'Test pump repair',
                MaintenancePlanningPlant: '1000',
                MaintenancePlant: '1000',
                MainWorkCenter: 'MECH01',
                Equipment: 'EQ001',
                EquipmentName: 'Primary pump',
                FunctionalLocation: 'FL-001',
                MaintPriority: '2',
                SystemStatusText: 'REL',
                UserStatusText: '',
                MaintOrdBasicStartDate: '/Date(1700000000000)/',
                MaintOrdBasicEndDate: null,
                MaintOrderCreationDateTime: '/Date(1700000000000+0000)/',
                CreatedByUser: 'USER1'
            }];
            mockClient.get.mockResolvedValue(makeResponse(raw, 54391));
            const result = await adapter.list({});
            expect(result.totalCount).toBe(54391);
            expect(result.items).toHaveLength(1);
            expect(result.items[0].maintenanceOrder).toBe('4000054724');
            expect(result.items[0].maintenanceOrderDesc).toBe('Test pump repair');
            expect(result.items[0].systemStatusText).toBe('REL');
            expect(result.items[0].maintOrderCreationDate).toBe('2023-11-14');
        });

        test('includes searchQuery $filter in URL', async () => {
            mockClient.get.mockResolvedValue(makeResponse([], 0));
            await adapter.list({ searchQuery: 'pump' });
            const url = mockClient.get.mock.calls[0][0];
            expect(url).toContain('$filter=');
            expect(url).toContain('substringof');
        });

        test('includes plant eq filter in URL when plant provided', async () => {
            mockClient.get.mockResolvedValue(makeResponse([], 0));
            await adapter.list({ plant: '1000' });
            const url = mockClient.get.mock.calls[0][0];
            expect(url).toContain('$filter=');
            expect(decodeURIComponent(url)).toContain("MaintenancePlant eq '1000'");
        });

        test('combines multiple filters', async () => {
            mockClient.get.mockResolvedValue(makeResponse([], 0));
            await adapter.list({ plant: '1000', orderType: 'PM01', priority: '1' });
            const url = decodeURIComponent(mockClient.get.mock.calls[0][0]);
            expect(url).toContain("MaintenancePlant eq '1000'");
            expect(url).toContain("MaintenanceOrderType eq 'PM01'");
            expect(url).toContain("MaintPriority eq '1'");
        });

        test('propagates S4HttpClient errors without swallowing', async () => {
            const err = new Error('SAP unreachable');
            err.status = 503;
            mockClient.get.mockRejectedValue(err);
            await expect(adapter.list({})).rejects.toThrow('SAP unreachable');
        });

        test('returns empty items when d.results is missing', async () => {
            mockClient.get.mockResolvedValue({ data: { d: { __count: '0' } } });
            const result = await adapter.list({});
            expect(result.items).toEqual([]);
            expect(result.totalCount).toBe(0);
        });
    });

    // ─── adapter.getMetrics() ─────────────────────────────────────────────────

    describe('getMetrics()', () => {
        test('calls $top=1&$inlinecount=allpages', async () => {
            mockClient.get.mockResolvedValue({ data: { d: { results: [], __count: '54391' } } });
            const result = await adapter.getMetrics();
            expect(mockClient.get).toHaveBeenCalledTimes(1);
            const url = mockClient.get.mock.calls[0][0];
            expect(url).toContain('$top=1');
            expect(url).toContain('$inlinecount=allpages');
            expect(result.totalCount).toBe(54391);
        });

        test('returns 0 when __count is missing', async () => {
            mockClient.get.mockResolvedValue({ data: { d: { results: [] } } });
            const result = await adapter.getMetrics();
            expect(result.totalCount).toBe(0);
        });
    });
});
