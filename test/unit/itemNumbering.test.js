const { formatItemNumber } = require('../../srv/integration/s4hana/PurchaseOrderMapper');

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

    it('should correctly re-number a list of items after deletion', () => {
        // Simulating the Fiori UI renumbering logic from CreatePurchaseOrder.controller.js
        const items = [
            { PurchaseOrderItem: '10', Material: 'TG11' },
            { PurchaseOrderItem: '20', Material: 'TG12' },
            { PurchaseOrderItem: '30', Material: 'TG13' }
        ];

        // Delete middle item (index 1)
        items.splice(1, 1);

        // Re-number
        items.forEach((item, idx) => {
            item.PurchaseOrderItem = formatItemNumber(undefined, idx);
        });

        expect(items).toHaveLength(2);
        expect(items[0].PurchaseOrderItem).toBe('10');
        expect(items[0].Material).toBe('TG11');
        expect(items[1].PurchaseOrderItem).toBe('20');
        expect(items[1].Material).toBe('TG13');
    });

});
