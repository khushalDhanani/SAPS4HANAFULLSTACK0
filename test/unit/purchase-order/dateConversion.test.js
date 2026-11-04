const { formatDateToODataV2 } = require('../../../srv/integration/s4hana/mm/purchase-order/PurchaseOrderMapper');

describe('Unit: Date Conversion', () => {

    it('should convert a YYYY-MM-DD string to /Date(epoch)/ at UTC midnight of that day', () => {
        expect(formatDateToODataV2('2026-09-05')).toBe('/Date(1788566400000)/');
    });

    it('should convert a full ISO datetime string to /Date(epoch)/ of that instant', () => {
        // 2026-09-05T00:00Z is 1788566400000; 12h30m later adds 45000000 ms
        expect(formatDateToODataV2('2026-09-05T12:30:00.000Z')).toBe('/Date(1788611400000)/');
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
