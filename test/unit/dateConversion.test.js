const { formatDateToODataV2 } = require('../../srv/integration/s4hana/PurchaseOrderMapper');

describe('Unit: Date Conversion', () => {

    it('should convert standard ISO date string (YYYY-MM-DD) to /Date(epoch)/', () => {
        const input = '2026-09-05';
        const expectedEpoch = new Date(input).getTime();
        const result = formatDateToODataV2(input);

        expect(result).toBe(`/Date(${expectedEpoch})/`);
    });

    it('should convert full ISO datetime string to /Date(epoch)/', () => {
        const input = '2026-09-05T12:30:00.000Z';
        const expectedEpoch = new Date(input).getTime();
        const result = formatDateToODataV2(input);

        expect(result).toBe(`/Date(${expectedEpoch})/`);
    });

    it('should convert Date instance to /Date(epoch)/', () => {
        const d = new Date(2026, 8, 5, 10, 0, 0);
        const result = formatDateToODataV2(d);

        expect(result).toBe(`/Date(${d.getTime()})/`);
    });

    it('should convert numeric epoch timestamp to /Date(epoch)/', () => {
        const epoch = 1788566400000;
        const result = formatDateToODataV2(epoch);

        expect(result).toBe(`/Date(${epoch})/`);
    });

    it('should return undefined when date is null, undefined, or empty string', () => {
        expect(formatDateToODataV2(null)).toBeUndefined();
        expect(formatDateToODataV2(undefined)).toBeUndefined();
        expect(formatDateToODataV2('')).toBeUndefined();
    });

    it('should throw Error when given an invalid date string', () => {
        expect(() => formatDateToODataV2('invalid-date')).toThrow('Invalid date value: invalid-date');
    });

});
