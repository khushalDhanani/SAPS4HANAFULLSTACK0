const { formatItemNumber } = require('../../../srv/integration/s4hana/mm/purchase-order/PurchaseOrderMapper');

describe('Unit: Item Numbering', () => {

    it('should generate standard 10-increment item numbers based on index', () => {
        expect(formatItemNumber(undefined, 0)).toBe('10');
        expect(formatItemNumber(null, 1)).toBe('20');
        expect(formatItemNumber('', 2)).toBe('30');
        expect(formatItemNumber(undefined, 9)).toBe('100');
    });

    it('should preserve explicit custom item numbers', () => {
        expect(formatItemNumber('10', 0)).toBe('10');
        expect(formatItemNumber('00010', 0)).toBe('00010');
        expect(formatItemNumber(50, 0)).toBe('50');
        expect(formatItemNumber(' 20 ', 1)).toBe('20');
    });

});
