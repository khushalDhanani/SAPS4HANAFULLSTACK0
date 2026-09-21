/**
 * Unit Tests for UI5 Formatters - Strict DD-MM-YYYY Date Formatting Platform Standard
 */

let mmFormatter;
let fiFormatter;

const mockDateFormat = {
    getDateInstance: jest.fn(_options => ({
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

        it('should correctly format completeness status, icon, and text without document type', () => {
            expect(mmFormatter.completenessState(true)).toBe("Success");
            expect(mmFormatter.completenessState(false)).toBe("Information");

            expect(mmFormatter.completenessIcon(true)).toBe("sap-icon://accept");
            expect(mmFormatter.completenessIcon(false)).toBe("sap-icon://edit");

            expect(mmFormatter.completenessText.call(oContext, true)).toBe("Approved");
            expect(mmFormatter.completenessText.call(oContext, false)).toBe("Draft");
        });

        it('should correctly format authentic Display Status, state, and icon across S/4HANA status fields', () => {
            // 1. Rejected (Status 38 or name Rejected)
            expect(mmFormatter.displayStatus("38", "Rejected", true, "", false)).toBe("Rejected");
            expect(mmFormatter.displayStatusState("38", "Rejected", true, "", false)).toBe("Error");
            expect(mmFormatter.displayStatusIcon("38", "Rejected", true, "", false)).toBe("sap-icon://decline");

            // Deletion flag L maps to Deleted (Error, decline icon), never Rejected
            expect(mmFormatter.displayStatus("", "", false, "L", false)).toBe("Deleted");
            expect(mmFormatter.displayStatusState("", "", false, "L", false)).toBe("Error");
            expect(mmFormatter.displayStatusIcon("", "", false, "L", false)).toBe("sap-icon://decline");

            // 2. In Approval (Status 02, release pending, or name In Approval)
            expect(mmFormatter.displayStatus("02", "In Approval", true, "", false)).toBe("In Approval");
            expect(mmFormatter.displayStatusState("02", "In Approval", true, "", false)).toBe("Warning");
            expect(mmFormatter.displayStatusIcon("02", "In Approval", true, "", false)).toBe("sap-icon://pending");

            expect(mmFormatter.displayStatus("", "", true, "", false)).toBe("In Approval");
            expect(mmFormatter.displayStatusState("", "", true, "", false)).toBe("Warning");

            // 3. Draft (Status 01, completeness false, or name Draft)
            expect(mmFormatter.displayStatus("01", "Draft", false, "", true)).toBe("Draft");
            expect(mmFormatter.displayStatusState("01", "Draft", false, "", true)).toBe("Information");
            expect(mmFormatter.displayStatusIcon("01", "Draft", false, "", true)).toBe("sap-icon://edit");

            expect(mmFormatter.displayStatus("", "", false, "", false)).toBe("Draft");
            expect(mmFormatter.displayStatusState("", "", false, "", false)).toBe("Information");

            // 4. Sent / Follow-On Documents / Approved (Authentic SAP status name displayed)
            expect(mmFormatter.displayStatus("04", "Sent", false, "", false)).toBe("Sent");
            expect(mmFormatter.displayStatusState("04", "Sent", false, "", false)).toBe("Success");
            expect(mmFormatter.displayStatusIcon("04", "Sent", false, "", false)).toBe("sap-icon://accept");

            expect(mmFormatter.displayStatus("05", "Follow-On Documents", false, "", false)).toBe("Follow-On Documents");
            expect(mmFormatter.displayStatusState("05", "Follow-On Documents", false, "", false)).toBe("Success");
            expect(mmFormatter.displayStatusIcon("05", "Follow-On Documents", false, "", false)).toBe("sap-icon://accept");

            expect(mmFormatter.displayStatus("", "Approved", false, "", true)).toBe("Approved");
            expect(mmFormatter.displayStatusState("", "Approved", false, "", true)).toBe("Success");
            expect(mmFormatter.displayStatusIcon("", "Approved", false, "", true)).toBe("sap-icon://accept");

            expect(mmFormatter.displayStatus("", "", false, "", true)).toBe("Approved");
            expect(mmFormatter.displayStatusState("", "", false, "", true)).toBe("Success");

            // 5. Unrecognized / Unknown status code shows raw code, never defaults to Approved
            expect(mmFormatter.displayStatus("99", "", false, "", false)).toBe("99");
            expect(mmFormatter.displayStatusState("99", "", false, "", false)).toBe("None");
            expect(mmFormatter.displayStatusIcon("99", "", false, "", false)).toBe("");

            expect(mmFormatter.displayStatus("Z1", "", false, "", false)).toBe("Z1");
            expect(mmFormatter.displayStatusState("Z1", "", false, "", false)).toBe("None");
            expect(mmFormatter.displayStatusIcon("Z1", "", false, "", false)).toBe("");

            // 6. Completely empty values return empty string
            expect(mmFormatter.displayStatus(null, null, null, null, null)).toBe("");
            expect(mmFormatter.displayStatus("", "", null, "", null)).toBe("");
            expect(mmFormatter.displayStatusState(null, null, null, null, null)).toBe("None");
            expect(mmFormatter.displayStatusIcon(null, null, null, null, null)).toBe("");
        });

        it('should format supplier, company, purchasing org, and created by display helpers', () => {
            expect(mmFormatter.docTypeDisplay("ZDOM")).toBe("ZDOM");
            expect(mmFormatter.docTypeDisplay("")).toBe("-");

            expect(mmFormatter.supplierDisplay("Vendor Corp", "10001")).toBe("Vendor Corp (10001)");
            expect(mmFormatter.supplierDisplay("", "10001")).toBe("10001");
            expect(mmFormatter.supplierDisplay("", "")).toBe("-");

            expect(mmFormatter.companyDisplay("1000", "Aether")).toBe("1000 - Aether");
            expect(mmFormatter.companyDisplay("", "")).toBe("-");

            expect(mmFormatter.purchasingOrgDisplay("AE01", "101")).toBe("AE01 / 101");
            expect(mmFormatter.purchasingOrgDisplay("", "")).toBe("-");

            expect(mmFormatter.createdByDisplay("Shriram Andhale", "SANDHLE")).toBe("Shriram Andhale (SANDHLE)");
            expect(mmFormatter.createdByDisplay("", "SANDHLE")).toBe("SANDHLE");
            expect(mmFormatter.createdByDisplay("Shriram Andhale", "")).toBe("Shriram Andhale");
            expect(mmFormatter.createdByDisplay("", "")).toBe("-");
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

    afterAll(() => {
        global.sap = originalSap;
    });
});
