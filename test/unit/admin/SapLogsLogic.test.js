'use strict';

/**
 * Unit tests for SapLogsLogic (UI5 Admin SapLogs logic module)
 */

describe('SapLogsLogic Unit Tests', () => {
    let SapLogsLogic;
    let mockODataClient;

    beforeEach(() => {
        jest.resetModules();

        mockODataClient = {
            get: jest.fn()
        };

        // Stub sap.ui.define
        global.sap = {
            ui: {
                define: (deps, factory) => {
                    // Provide mock dependencies
                    const mockJSONModel = function (initialData) {
                        this._data = JSON.parse(JSON.stringify(initialData));
                        this.getProperty = (path) => {
                            const parts = path.replace(/^\//, '').split('/');
                            let curr = this._data;
                            for (const p of parts) {
                                if (curr === undefined || curr === null) return undefined;
                                curr = curr[p];
                            }
                            return curr;
                        };
                        this.setProperty = (path, val) => {
                            const parts = path.replace(/^\//, '').split('/');
                            let curr = this._data;
                            for (let i = 0; i < parts.length - 1; i++) {
                                curr = curr[parts[i]];
                            }
                            curr[parts[parts.length - 1]] = val;
                        };
                    };
                    const mockMessageToast = { show: jest.fn() };
                    SapLogsLogic = factory(mockJSONModel, mockODataClient, mockMessageToast);
                }
            }
        };

        require('../../../app/fiori-app/webapp/modules/admin/sap-logs/util/SapLogsLogic');
    });

    describe('Model creation and window calculation', () => {
        test('createModel initializes default sapLogsView state', () => {
            const model = SapLogsLogic.createModel();
            expect(model.getProperty('/selectedTab')).toBe('sm21');
            expect(model.getProperty('/busy')).toBe(false);
            expect(model.getProperty('/errorMessage')).toBe('');
            expect(model.getProperty('/warningMessage')).toBe('');

            const sm21 = model.getProperty('/sm21');
            expect(sm21.preset).toBe('1h');
            expect(sm21.maxRows).toBe(500);
            expect(sm21.entries).toEqual([]);
            expect(sm21.count).toBe(0);

            const sm20 = model.getProperty('/sm20');
            expect(sm20.preset).toBe('1h');
            expect(sm20.maxRows).toBe(500);
            expect(sm20.entries).toEqual([]);
            expect(sm20.count).toBe(0);
        });

        test('calculateUtcWindow sets fromUtc and toUtc with a past buffer', () => {
            const before = Date.now();
            const win = SapLogsLogic.calculateUtcWindow('1h', { '1h': 60 });
            const after = Date.now();

            const fromMs = Date.parse(win.fromUtc);
            const toMs = Date.parse(win.toUtc);

            expect(toMs).toBeLessThanOrEqual(after - 4000); // 5s past buffer
            expect(toMs - fromMs).toBe(60 * 60 * 1000);
        });

        test('calculateUtcWindow handles different presets', () => {
            const win15m = SapLogsLogic.calculateUtcWindow('15m', { '15m': 15 });
            expect(Date.parse(win15m.toUtc) - Date.parse(win15m.fromUtc)).toBe(15 * 60 * 1000);

            const win24h = SapLogsLogic.calculateUtcWindow('24h', { '24h': 1440 });
            expect(Date.parse(win24h.toUtc) - Date.parse(win24h.fromUtc)).toBe(24 * 60 * 60 * 1000);
        });
    });

    describe('URL Building', () => {
        test('buildSystemLogUrl builds correct OData V4 function URL', () => {
            const url = SapLogsLogic.buildSystemLogUrl({
                fromUtc: '2026-11-17T10:00:00.000Z',
                toUtc: '2026-11-17T11:00:00.000Z',
                instance: 'app-server-01_DS4_00',
                maxRows: 250
            });
            expect(url).toBe("/odata/v4/sap-logs/getSystemLog(fromUtc='2026-11-17T10%3A00%3A00.000Z',toUtc='2026-11-17T11%3A00%3A00.000Z',instance='app-server-01_DS4_00',top=250)");
        });

        test('buildSystemLogUrl handles empty instance', () => {
            const url = SapLogsLogic.buildSystemLogUrl({
                fromUtc: '2026-11-17T10:00:00.000Z',
                toUtc: '2026-11-17T11:00:00.000Z',
                instance: '',
                maxRows: 500
            });
            expect(url).toBe("/odata/v4/sap-logs/getSystemLog(fromUtc='2026-11-17T10%3A00%3A00.000Z',toUtc='2026-11-17T11%3A00%3A00.000Z',top=500)");
        });

        test('buildSecurityAuditLogUrl builds correct OData V4 function URL with user filter', () => {
            const url = SapLogsLogic.buildSecurityAuditLogUrl({
                fromUtc: '2026-11-17T10:00:00.000Z',
                toUtc: '2026-11-17T11:00:00.000Z',
                userFilter: 'TEST_USER',
                maxRows: 100
            });
            expect(url).toBe("/odata/v4/sap-logs/getSecurityAuditLog(fromUtc='2026-11-17T10%3A00%3A00.000Z',toUtc='2026-11-17T11%3A00%3A00.000Z',user='TEST_USER',top=100)");
        });
    });

    describe('Search filtering', () => {
        const sampleEntries = [
            { entryType: 'sAB1', message: 'Short dump created', program: 'SAPLSE38', user: 'TEST_DEV', instance: 'app01' },
            { entryType: 'mQ04', message: 'Connection to terminal closed', program: 'SAPMHTTP', user: 'USER_B', instance: 'app02' },
            { entryType: 'sPM2', message: 'SAP System Started', program: 'SAPMSSY0', user: '', instance: 'app01' }
        ];

        test('filterEntries returns all entries when query is empty', () => {
            expect(SapLogsLogic.filterEntries(sampleEntries, '')).toEqual(sampleEntries);
            expect(SapLogsLogic.filterEntries(sampleEntries, null)).toEqual(sampleEntries);
        });

        test('filterEntries filters by message text substring', () => {
            const res = SapLogsLogic.filterEntries(sampleEntries, 'dump');
            expect(res).toHaveLength(1);
            expect(res[0].entryType).toBe('sAB1');
        });

        test('filterEntries filters case-insensitively by user or program', () => {
            const resUser = SapLogsLogic.filterEntries(sampleEntries, 'user_b');
            expect(resUser).toHaveLength(1);
            expect(resUser[0].user).toBe('USER_B');

            const resProg = SapLogsLogic.filterEntries(sampleEntries, 'saplse38');
            expect(resProg).toHaveLength(1);
            expect(resProg[0].program).toBe('SAPLSE38');
        });
    });

    describe('Formatters', () => {
        test('formatSeverityState correctly classifies error, warning, and info', () => {
            expect(SapLogsLogic.formatSeverityState('sAB1')).toBe('Error');
            expect(SapLogsLogic.formatSeverityState('l01')).toBe('Error');
            expect(SapLogsLogic.formatSeverityState('mQ04')).toBe('Warning');
            expect(SapLogsLogic.formatSeverityState('sPM2')).toBe('Information');

            expect(SapLogsLogic.formatSeverityState('', 3)).toBe('Error');
            expect(SapLogsLogic.formatSeverityState('', 2)).toBe('Warning');
            expect(SapLogsLogic.formatSeverityState('', 1)).toBe('Information');
        });

        test('formatSeverityIcon maps states to sap-icons', () => {
            expect(SapLogsLogic.formatSeverityIcon('sAB1')).toBe('sap-icon://error');
            expect(SapLogsLogic.formatSeverityIcon('mQ04')).toBe('sap-icon://alert');
            expect(SapLogsLogic.formatSeverityIcon('sPM2')).toBe('sap-icon://hint');
        });

        test('formatUtcTimestamp formats ISO string into UTC display string', () => {
            const formatted = SapLogsLogic.formatUtcTimestamp('2026-11-17T10:15:30.000Z');
            expect(formatted).toBe('2026-11-17 10:15:30 UTC');
            expect(SapLogsLogic.formatUtcTimestamp(null)).toBe('-');
        });
    });

    describe('Data Fetching & State Updates', () => {
        test('loadSystemLogs updates model with returned entries', async () => {
            const model = SapLogsLogic.createModel();
            const mockEntries = [
                { entryType: 'sPM2', timestamp: '2026-11-17T10:00:00.000Z', message: 'System Started', instance: 'app01' }
            ];
            mockODataClient.get.mockResolvedValueOnce({
                entries: mockEntries,
                count: 1,
                truncated: false
            });

            await SapLogsLogic.loadSystemLogs(model);

            expect(model.getProperty('/busy')).toBe(false);
            expect(model.getProperty('/sm21/entries')).toEqual(mockEntries);
            expect(model.getProperty('/sm21/filteredEntries')).toEqual(mockEntries);
            expect(model.getProperty('/sm21/count')).toBe(1);
            expect(model.getProperty('/sm21/truncated')).toBe(false);
            expect(model.getProperty('/errorMessage')).toBe('');
        });

        test('loadSystemLogs sets warning when truncated is true', async () => {
            const model = SapLogsLogic.createModel();
            mockODataClient.get.mockResolvedValueOnce({
                entries: new Array(500).fill({ entryType: 'm01' }),
                count: 500,
                truncated: true
            });

            await SapLogsLogic.loadSystemLogs(model);

            expect(model.getProperty('/sm21/truncated')).toBe(true);
            expect(model.getProperty('/warningMessage')).toContain('Result row cap (500) reached');
        });

        test('loadSystemLogs handles backend failure gracefully', async () => {
            const model = SapLogsLogic.createModel();
            mockODataClient.get.mockRejectedValueOnce(new Error('Network error 503'));

            await expect(SapLogsLogic.loadSystemLogs(model)).rejects.toThrow('Network error 503');

            expect(model.getProperty('/busy')).toBe(false);
            expect(model.getProperty('/errorMessage')).toBe('Network error 503');
            expect(model.getProperty('/sm21/entries')).toEqual([]);
            expect(model.getProperty('/sm21/count')).toBe(0);
        });

        test('loadSecurityAuditLogs updates model and surfaces warnings', async () => {
            const model = SapLogsLogic.createModel();
            const mockAuditEntries = [
                { eventId: 'AU1', date: '20261117', time: '100000', message: 'Logon successful', user: 'TEST_USER' }
            ];
            mockODataClient.get.mockResolvedValueOnce({
                entries: mockAuditEntries,
                count: 1,
                truncated: false,
                warnings: ['ET_LOG_UTC was empty; converted from server local time']
            });

            await SapLogsLogic.loadSecurityAuditLogs(model);

            expect(model.getProperty('/busy')).toBe(false);
            expect(model.getProperty('/sm20/entries')).toEqual(mockAuditEntries);
            expect(model.getProperty('/sm20/count')).toBe(1);
            expect(model.getProperty('/warningMessage')).toBe('ET_LOG_UTC was empty; converted from server local time');
        });
    });
});
