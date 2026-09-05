/**
 * Unit Tests for UI5 Formatters - Strict DD-MM-YYYY Date Formatting Platform Standard
 */

let mmFormatter;
let fiFormatter;

const mockDateFormat = {
    getDateInstance: jest.fn(options => ({
        format: jest.fn(oDate => {
            if (!oDate || !(oDate instanceof Date) || isNaN(oDate.getTime())) return "";
            const sDay = String(oDate.getDate()).padStart(2, "0");
            const sMonth = String(oDate.getMonth() + 1).padStart(2, "0");
            const sYear = oDate.getFullYear();
            return `${sDay}-${sMonth}-${sYear}`;
        })
    }))
};

// Setup sap.ui.define mock
const originalSap = global.sap;
global.sap = {
    ui: {
        define: function (deps, factory) {
            const hasNumberFormat = deps.some(d => d && d.includes("NumberFormat"));
            if (hasNumberFormat) {
                // FI Formatter
                const mockNumberFormat = {
                    getCurrencyInstance: jest.fn(() => ({
                        format: jest.fn(v => Number(v).toFixed(2))
                    }))
                };
                fiFormatter = factory(mockNumberFormat, mockDateFormat);
            } else {
                // MM / Common Formatter
                mmFormatter = factory(mockDateFormat);
            }
        }
    }
};

require('../../../app/fiori-app/webapp/model/formatter');
require('../../../app/fiori-app/webapp/modules/fi/journal-entry/model/formatter');

describe('Strict Platform Date Formatter (DD-MM-YYYY)', () => {
    describe('Common / MM Formatter (webapp/model/formatter.js)', () => {
        let oContext;
        const mockResourceBundle = {
            getText: jest.fn(k => k === "statusComplete" ? "Complete" : "Incomplete")
        };

        beforeEach(() => {
            oContext = {
                getOwnerComponent: () => ({
                    getModel: () => ({
                        getResourceBundle: () => mockResourceBundle
                    })
                })
            };
        });

        it('should return empty string for falsy date values', () => {
            expect(mmFormatter.formatDate(null)).toBe("");
            expect(mmFormatter.formatDate(undefined)).toBe("");
            expect(mmFormatter.formatDate("")).toBe("");
        });

        it('should format ISO YYYY-MM-DD string to DD-MM-YYYY', () => {
            expect(mmFormatter.formatDate("2026-09-05")).toBe("05-09-2026");
            expect(mmFormatter.formatDate("2025-12-31")).toBe("31-12-2025");
            expect(mmFormatter.formatDate("2024-01-01")).toBe("01-01-2024");
        });

        it('should format ISO datetime timestamp string to DD-MM-YYYY', () => {
            expect(mmFormatter.formatDate("2026-09-05T14:30:00Z")).toBe("05-09-2026");
        });

        it('should format Date instance to DD-MM-YYYY', () => {
            const oDate = new Date(2026, 8, 5); // September 5, 2026
            expect(mmFormatter.formatDate(oDate)).toBe("05-09-2026");
        });

        it('should format OData V2 /Date(epoch)/ string to DD-MM-YYYY', () => {
            const oDate = new Date(2026, 8, 5);
            const sODataDate = `/Date(${oDate.getTime()})/`;
            expect(mmFormatter.formatDate(sODataDate)).toBe("05-09-2026");
        });

        it('should return raw value for invalid date strings', () => {
            expect(mmFormatter.formatDate("not-a-date")).toBe("not-a-date");
        });

        it('should correctly format completeness status, icon, and text', () => {
            expect(mmFormatter.completenessState(true)).toBe("Success");
            expect(mmFormatter.completenessState(false)).toBe("Warning");

            expect(mmFormatter.completenessIcon(true)).toBe("sap-icon://accept");
            expect(mmFormatter.completenessIcon(false)).toBe("sap-icon://alert");

            expect(mmFormatter.completenessText.call(oContext, true)).toBe("Complete");
            expect(mmFormatter.completenessText.call(oContext, false)).toBe("Incomplete");
        });

        it('should format supplier, company, and purchasing org display helpers', () => {
            expect(mmFormatter.docTypeDisplay("ZDOM")).toBe("ZDOM");
            expect(mmFormatter.docTypeDisplay("")).toBe("-");

            expect(mmFormatter.supplierDisplay("Vendor Corp", "10001")).toBe("Vendor Corp (10001)");
            expect(mmFormatter.supplierDisplay("", "10001")).toBe("10001");
            expect(mmFormatter.supplierDisplay("", "")).toBe("-");

            expect(mmFormatter.companyDisplay("1000", "Aether")).toBe("1000 - Aether");
            expect(mmFormatter.companyDisplay("", "")).toBe("-");

            expect(mmFormatter.purchasingOrgDisplay("AE01", "101")).toBe("AE01 / 101");
            expect(mmFormatter.purchasingOrgDisplay("", "")).toBe("-");
        });
    });

    describe('FI Formatter (modules/fi/journal-entry/model/formatter.js)', () => {
        it('should return empty string for falsy date values', () => {
            expect(fiFormatter.formatDate(null)).toBe("");
            expect(fiFormatter.formatDate(undefined)).toBe("");
            expect(fiFormatter.formatDate("")).toBe("");
        });

        it('should format ISO YYYY-MM-DD string to DD-MM-YYYY', () => {
            expect(fiFormatter.formatDate("2026-09-05")).toBe("05-09-2026");
            expect(fiFormatter.formatDate("2025-07-15")).toBe("15-07-2025");
        });

        it('should format Date instance to DD-MM-YYYY', () => {
            const oDate = new Date(2026, 8, 5);
            expect(fiFormatter.formatDate(oDate)).toBe("05-09-2026");
        });
    });
});
