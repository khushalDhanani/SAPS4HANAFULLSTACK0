let formatter;

// Mock sap.ui.define before requiring the formatter
global.sap = {
    ui: {
        define: function (deps, factory) {
            // Capture the factory output
            formatter = factory();
        }
    }
};

require('../../../app/fiori-app/webapp/modules/fi/journal-entry/model/formatter');

describe('FI Journal Entry Formatter', () => {
    // We need to inject mock functions for the i18n bundle and UI5 formats
    const mockResourceBundle = {
        getText: jest.fn(key => {
            if (key === 'fiStatusDebit') return 'Debit';
            if (key === 'fiStatusCredit') return 'Credit';
            return key;
        })
    };

    // We can't easily run the UI5 NumberFormat/DateFormat inside jest without the full framework,
    // so we'll just test the core logic of Debit/Credit which doesn't require UI5 globals.

    let oFormatter;

    beforeEach(() => {
        // Mock getOwnerComponent().getModel("i18n").getResourceBundle()
        oFormatter = {
            getOwnerComponent: () => ({
                getModel: () => ({
                    getResourceBundle: () => mockResourceBundle
                })
            }),
            formatDebitCredit: formatter.formatDebitCredit,
            debitCreditState: formatter.debitCreditState
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
});
