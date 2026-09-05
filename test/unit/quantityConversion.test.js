const { formatQuantity, formatPriceAmount } = require('../../srv/integration/s4hana/PurchaseOrderMapper');

describe('Unit: Quantity & Price Conversion', () => {

    describe('formatQuantity', () => {
        it('should convert integer number to string', () => {
            expect(formatQuantity(10)).toBe('10');
            expect(formatQuantity(100)).toBe('100');
        });

        it('should preserve float quantities as string', () => {
            expect(formatQuantity(2.5)).toBe('2.5');
            expect(formatQuantity(10.75)).toBe('10.75');
        });

        it('should accept valid numeric string representations', () => {
            expect(formatQuantity('15')).toBe('15');
            expect(formatQuantity('3.14')).toBe('3.14');
        });

        it('should throw when quantity is zero or negative', () => {
            expect(() => formatQuantity(0)).toThrow('OrderQuantity must be a positive number');
            expect(() => formatQuantity(-5)).toThrow('OrderQuantity must be a positive number');
            expect(() => formatQuantity('-10')).toThrow('OrderQuantity must be a positive number');
        });

        it('should throw when quantity is missing or non-numeric', () => {
            expect(() => formatQuantity(null)).toThrow('OrderQuantity is required');
            expect(() => formatQuantity(undefined)).toThrow('OrderQuantity is required');
            expect(() => formatQuantity('')).toThrow('OrderQuantity is required');
            expect(() => formatQuantity('abc')).toThrow('OrderQuantity must be a positive number');
        });
    });

    describe('formatPriceAmount', () => {
        it('should format numbers to 2 decimal places', () => {
            expect(formatPriceAmount(25)).toBe('25.00');
            expect(formatPriceAmount(10.5)).toBe('10.50');
            expect(formatPriceAmount(99.999)).toBe('100.00');
        });

        it('should format numeric strings to 2 decimal places', () => {
            expect(formatPriceAmount('12.3')).toBe('12.30');
            expect(formatPriceAmount('50')).toBe('50.00');
        });

        it('should default empty or null values to "0.00"', () => {
            expect(formatPriceAmount(null)).toBe('0.00');
            expect(formatPriceAmount(undefined)).toBe('0.00');
            expect(formatPriceAmount('')).toBe('0.00');
        });

        it('should throw error on non-numeric strings', () => {
            expect(() => formatPriceAmount('invalid')).toThrow('NetPriceAmount must be a numeric value');
        });
    });

});
