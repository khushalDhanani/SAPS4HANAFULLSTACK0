'use strict';

const {
    readUSH02,
    compareHistoryRows,
    compareHistoryCursor,
    historyCursor,
    USH02_PAGE_SIZE
} = require('../../../srv/integration/s4hana/admin/UserHistoryReader');

describe('Unit: UserHistoryReader', () => {
    test('compareHistoryRows sorts by date, time, and key fields', () => {
        const row1 = { MODDA: '20261101', MODTI: '100000', MANDT: '100', BNAME: 'ALICE', MODBE: 'ADMIN', TCODE: 'SU01', REPID: 'SAPL' };
        const row2 = { MODDA: '20261101', MODTI: '110000', MANDT: '100', BNAME: 'BOB', MODBE: 'ADMIN', TCODE: 'SU01', REPID: 'SAPL' };
        expect(compareHistoryRows(row1, row2)).toBeLessThan(0);
        expect(compareHistoryRows(row2, row1)).toBeGreaterThan(0);
        expect(compareHistoryRows(row1, row1)).toBe(0);
    });

    test('historyCursor creates cursor with combined timestamp and JSON key', () => {
        const row = { MODDA: '20261101', MODTI: '120000', MANDT: '100', BNAME: 'CHARLIE', MODBE: 'ADMIN', TCODE: 'SU01', REPID: 'SAPL' };
        const cursor = historyCursor(row);
        expect(cursor.at).toBe('20261101120000');
        expect(cursor.key).toContain('CHARLIE');
    });

    test('readUSH02 maps rows and computes previousUflag', async () => {
        const mockRfc = {
            readTable: jest.fn().mockImplementation((table, fields, where) => {
                if (where.some(w => w.includes("'00000000'"))) {
                    return Promise.resolve([]);
                }
                return Promise.resolve([
                    { MANDT: '100', BNAME: 'ALICE', MODDA: '20261101', MODTI: '090000', MODBE: 'SEC_ADMIN', TCODE: 'SU01', REPID: 'SAPL', UFLAG: '0' },
                    { MANDT: '100', BNAME: 'ALICE', MODDA: '20261101', MODTI: '100000', MODBE: 'SEC_ADMIN', TCODE: 'SU01', REPID: 'SAPL', UFLAG: '64' }
                ]);
            })
        };

        const result = await readUSH02(mockRfc, null);
        expect(result).toHaveLength(2);
        expect(result[0].username).toBe('ALICE');
        expect(result[0].uflag).toBe(0);
        expect(result[0].previousUflag).toBeNull();
        expect(result[1].uflag).toBe(64);
        expect(result[1].previousUflag).toBe(0);
    });
});
