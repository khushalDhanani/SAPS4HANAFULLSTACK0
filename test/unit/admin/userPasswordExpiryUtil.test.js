'use strict';

const {
    parseSapDate,
    formatSapDate,
    addDays,
    diffCalendarDays,
    calculatePasswordStatus,
    PWD_POLICY_DEFAULT_DAYS,
    PWD_WARNING_DEFAULT_DAYS
} = require('../../../srv/integration/s4hana/admin/UserPasswordExpiryUtil');

describe('Unit: UserPasswordExpiryUtil', () => {
    test('parseSapDate parses valid DATS to UTC Date at midnight', () => {
        const d = parseSapDate('20261106');
        expect(d).toBeInstanceOf(Date);
        expect(d.getUTCFullYear()).toBe(2026);
        expect(d.getUTCMonth()).toBe(10);
        expect(d.getUTCDate()).toBe(6);
    });

    test('parseSapDate returns null for invalid dates', () => {
        expect(parseSapDate('00000000')).toBeNull();
        expect(parseSapDate('')).toBeNull();
        expect(parseSapDate('invalid')).toBeNull();
    });

    test('formatSapDate formats a Date into YYYYMMDD in UTC', () => {
        const d = new Date(Date.UTC(2026, 10, 6));
        expect(formatSapDate(d)).toBe('20261106');
    });

    test('addDays and diffCalendarDays work accurately across days', () => {
        const d1 = new Date(Date.UTC(2026, 0, 1));
        const d2 = addDays(d1, 15);
        expect(formatSapDate(d2)).toBe('20260116');
        expect(diffCalendarDays(d2, d1)).toBe(15);
    });

    test('calculatePasswordStatus classifies dialog vs non-dialog users', () => {
        const nonDialog = calculatePasswordStatus({ BNAME: 'SYSTEM', USTYP: 'B' });
        expect(nonDialog.pwdStatus).toBe('exempt');

        const initial = calculatePasswordStatus({ BNAME: 'ALICE', USTYP: 'A', PWDCHGDATE: '00000000' });
        expect(initial.pwdStatus).toBe('initial');

        const valid = calculatePasswordStatus(
            { BNAME: 'BOB', USTYP: 'A', PWDCHGDATE: '20261101' },
            { expirationDays: 90, warningDays: 14, referenceDate: '20261105' }
        );
        expect(valid.pwdStatus).toBe('valid');
        expect(valid.pwdDaysRemaining).toBe(86);
    });
});
