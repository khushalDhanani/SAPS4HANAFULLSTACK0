let formatter;

const mockCurrencyInstance = {
    format: jest.fn(val => {
        if (typeof val === "number" && !isNaN(val)) {
            return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        return "";
    })
};

const mockNumberFormat = {
    getCurrencyInstance: jest.fn(() => mockCurrencyInstance)
};

const mockDateFormatInstance = {
    format: jest.fn(() => "21-09-2026")
};

const mockDateFormat = {
    getDateInstance: jest.fn(() => mockDateFormatInstance)
};

// Mock sap.ui.define before requiring the formatter
global.sap = {
    ui: {
        define: function (deps, factory) {
            // Capture the factory output with injected mocks
            formatter = factory(mockNumberFormat, mockDateFormat);
        }
    }
};

require('../../../app/fiori-app/webapp/modules/fi/journal-entry/model/formatter');

describe('FI Journal Entry Formatter', () => {
    const mockResourceBundle = {
        getText: jest.fn(key => {
            if (key === 'fiStatusDebit') return 'Debit';
            if (key === 'fiStatusCredit') return 'Credit';
            return key;
        })
    };

    let oFormatter;

    beforeEach(() => {
        jest.clearAllMocks();
        oFormatter = {
            getOwnerComponent: () => ({
                getModel: () => ({
                    getResourceBundle: () => mockResourceBundle
                })
            }),
            formatDebitCredit: formatter.formatDebitCredit,
            debitCreditState: formatter.debitCreditState,
            formatAmount: formatter.formatAmount,
            formatDate: formatter.formatDate
        };
    });

    describe('formatDebitCredit', () => {
        it('should return Debit text for "S"', () => {
            expect(oFormatter.formatDebitCredit("S")).toBe('Debit');
            expect(mockResourceBundle.getText).toHaveBeenCalledWith('fiStatusDebit');
        });

        it('should return Credit text for "H"', () => {
            expect(oFormatter.formatDebitCredit("H")).toBe('Credit');
            expect(mockResourceBundle.getText).toHaveBeenCalledWith('fiStatusCredit');
        });

        it('should return raw code for unknown code', () => {
            expect(oFormatter.formatDebitCredit("X")).toBe('X');
        });
    });

    describe('debitCreditState', () => {
        it('should return Success for "S" (Debit)', () => {
            expect(oFormatter.debitCreditState("S")).toBe('Success');
        });

        it('should return Error for "H" (Credit)', () => {
            expect(oFormatter.debitCreditState("H")).toBe('Error');
        });

        it('should return None for unknown code', () => {
            expect(oFormatter.debitCreditState("X")).toBe('None');
        });
    });

    describe('formatAmount', () => {
        it('should format clean numeric string', () => {
            const result = oFormatter.formatAmount("2958.60");
            expect(result).toBe("2,958.60");
            expect(mockNumberFormat.getCurrencyInstance).toHaveBeenCalledWith({ currencyCode: false });
        });

        it('should format pre-formatted string containing commas (e.g. from OData V4 Decimal)', () => {
            const result = oFormatter.formatAmount("2,958.600");
            expect(result).toBe("2,958.60");
        });

        it('should format numeric input', () => {
            const result = oFormatter.formatAmount(1500.5);
            expect(result).toBe("1,500.50");
        });

        it('should return "0.00" for empty, null, or undefined values', () => {
            expect(oFormatter.formatAmount(null)).toBe("0.00");
            expect(oFormatter.formatAmount(undefined)).toBe("0.00");
            expect(oFormatter.formatAmount("")).toBe("0.00");
        });

        it('should return "0.00" for invalid non-numeric strings', () => {
            expect(oFormatter.formatAmount("abc")).toBe("0.00");
        });
    });
});
