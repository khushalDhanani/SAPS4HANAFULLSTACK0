'use strict';

const MaintenanceOrderAdapter = require('../../../srv/integration/s4hana/pm/maintenance-order/MaintenanceOrderAdapter');
const { _parseODataV2Date, _parseODataV2DateTime, _formatRow, _buildFilter, MaintenanceOrderAdapter: AdapterClass } = MaintenanceOrderAdapter;

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

        test('returns empty string for null and undefined', () => {
            expect(_parseODataV2Date(null)).toBe('');
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

    describe('_parseODataV2DateTime', () => {
        test('parses /Date(ms+0000)/ to full ISO timestamp', () => {
            expect(_parseODataV2DateTime('/Date(1795730875000+0000)/')).toBe('2026-11-26T22:07:55.000Z');
        });

        test('returns empty string for null', () => {
            expect(_parseODataV2DateTime(null)).toBe('');
        });
    });

    // ─── _formatRow ────────────────────────────────────────────────────────────

    describe('_formatRow', () => {
        test('does not repeat planningPlantDiff when MaintenancePlant equals MaintenancePlanningPlant', () => {
            const row = _formatRow({
                MaintenanceOrder: '4000054724',
                MaintenancePlant: '1120',
                MaintenancePlanningPlant: '1120'
            });
            expect(row.maintenancePlant).toBe('1120');
            expect(row.planningPlantDiff).toBe('');
        });

        test('records planningPlantDiff when MaintenancePlanningPlant differs from MaintenancePlant', () => {
            const row = _formatRow({
                MaintenanceOrder: '4000054724',
                MaintenancePlant: '1120',
                MaintenancePlanningPlant: '1130'
            });
            expect(row.maintenancePlant).toBe('1120');
            expect(row.planningPlantDiff).toBe('1130');
        });

        test('falls back to MaintenancePlanningPlant when MaintenancePlant is empty', () => {
            const row = _formatRow({
                MaintenanceOrder: '4000038104',
                MaintenancePlant: '',
                MaintenancePlanningPlant: '1120'
            });
            expect(row.maintenancePlant).toBe('1120');
            expect(row.planningPlantDiff).toBe('');
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
            expect(url).toContain('MaintenancePlan');
            expect(url).toContain('MaintenanceNotification');
        });

        test('enriches plant name, order type name, and functional location label/description and caches lookups', async () => {
            const raw = [{
                MaintenanceOrder: '4000054724',
                MaintenanceOrderType: 'ZPRE',
                MaintenanceOrderDesc: 'Site-2(8203) Maint. Plan 06th July',
                MaintenancePlan: '2511',
                MaintenanceNotification: '10049224',
                MaintenancePlanningPlant: '1120',
                MaintenancePlant: '1120',
                MainWorkCenter: 'MECH',
                Equipment: '10015473',
                EquipmentName: 'Chiller, 50 TR',
                FunctionalLocation: '?0100000000000002091',
                MaintPriority: '2',
                SystemStatusText: 'CRTD NMAT PRC',
                UserStatusText: '',
                MaintOrdBasicStartDate: '/Date(1796428800000)/',
                MaintOrdBasicEndDate: null,
                MaintOrderCreationDateTime: '/Date(1795730875000+0000)/',
                CreatedByUser: 'IP1020261127'
            }];

            mockClient.get.mockImplementation((url) => {
                if (url.includes('/API_MAINTENANCEORDER;v=2/MaintenanceOrder')) {
                    return Promise.resolve(makeResponse(raw, 54391));
                }
                if (url.includes('/EAM_ORDER_MONITOR/I_Plant')) {
                    return Promise.resolve({ data: { d: { results: [{ Plant: '1120', PlantName: 'Genesis' }] } } });
                }
                if (url.includes('/EAM_ORDER_MONITOR/C_MaintOrderTypeVH')) {
                    return Promise.resolve({ data: { d: { results: [{ MaintenanceOrderType: 'ZPRE', MaintenanceOrderTypeName: 'Preventive Maintenance Order' }] } } });
                }
                if (url.includes('/EAM_OBJPG_TECHNICALOBJECT_SRV/C_ObjPgTechnicalObject')) {
                    return Promise.resolve({
                        data: {
                            d: {
                                results: [{
                                    TechnicalObject: '?0100000000000002091',
                                    TechnicalObjectLabel: '1120-P08-1',
                                    TechnicalObjectDescription: 'Site - Genesis Building 08 First Floor'
                                }]
                            }
                        }
                    });
                }
                return Promise.resolve({ data: { d: { results: [] } } });
            });

            const first = await adapter.list({});
            expect(first.totalCount).toBe(54391);
            expect(first.items).toHaveLength(1);
            expect(first.items[0]).toMatchObject({
                maintenanceOrder: '4000054724',
                maintenanceOrderTypeName: 'Preventive Maintenance Order',
                maintenancePlan: '2511',
                plantName: 'Genesis',
                planningPlantDiff: '',
                functionalLocationLabel: '1120-P08-1',
                functionalLocationName: 'Site - Genesis Building 08 First Floor',
                maintOrderCreationDateTime: '2026-11-26T22:07:55.000Z'
            });
            expect(mockClient.get).toHaveBeenCalledTimes(4);

            // Second call with the same FL/plant/type must hit caches instead of re-fetching value helps
            mockClient.get.mockClear();
            const second = await adapter.list({});
            expect(second.items[0].functionalLocationLabel).toBe('1120-P08-1');
            expect(mockClient.get).toHaveBeenCalledTimes(1);
        });

        test('fails open cleanly when enrichment lookups fail', async () => {
            const raw = [{
                MaintenanceOrder: '4000054724',
                MaintenanceOrderType: 'ZPRE',
                MaintenancePlant: '1120',
                MaintenancePlanningPlant: '1120',
                FunctionalLocation: '?0100000000000002091'
            }];

            mockClient.get.mockImplementation((url) => {
                if (url.includes('/API_MAINTENANCEORDER;v=2/MaintenanceOrder')) {
                    return Promise.resolve(makeResponse(raw, 1));
                }
                return Promise.reject(new Error('Auxiliary service offline'));
            });

            const result = await adapter.list({});
            expect(result.items).toHaveLength(1);
            expect(result.items[0].maintenanceOrder).toBe('4000054724');
            expect(result.items[0].plantName).toBe('');
            expect(result.items[0].functionalLocationLabel).toBe('');
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

        test('propagates primary S4HttpClient errors without swallowing', async () => {
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
