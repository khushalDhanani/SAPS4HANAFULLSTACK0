/**
 * Unit Tests for Sales Inquiry Model (VA11 Frontend State, Defaulting & Incompletion Log)
 * Target: app/fiori-app/webapp/modules/sd/sales-inquiry/model/SalesInquiryModel.js
 */

let SalesInquiryModel;

function MockJSONModel(data) {
    this._data = JSON.parse(JSON.stringify(data || {}));
    this.getData = function () {
        return this._data;
    };
    this.getProperty = function (path) {
        if (!path) return undefined;
        const clean = path.startsWith("/") ? path.slice(1) : path;
        const parts = clean.split("/");
        let cur = this._data;
        for (const p of parts) {
            if (cur == null) return undefined;
            cur = cur[p];
        }
        return cur;
    };
    this.setProperty = function (path, val) {
        if (!path) return;
        const clean = path.startsWith("/") ? path.slice(1) : path;
        const parts = clean.split("/");
        let cur = this._data;
        for (let i = 0; i < parts.length - 1; i++) {
            const p = parts[i];
            if (cur[p] == null) {
                cur[p] = {};
            }
            cur = cur[p];
        }
        cur[parts[parts.length - 1]] = val;
    };
}

beforeAll(() => {
    global.sap = {
        ui: {
            define: function (deps, factory) {
                SalesInquiryModel = factory(MockJSONModel);
            }
        }
    };
    require("../../../app/fiori-app/webapp/modules/sd/sales-inquiry/model/SalesInquiryModel");
});

describe("SalesInquiryModel - Initial State and User Resolution", () => {
    test("getCurrentUserName resolves username from auth model", () => {
        const mockComponent = {
            getModel: (name) => {
                if (name === "auth") {
                    return {
                        getProperty: (p) => (p === "/user/username" ? "sales_rep" : null)
                    };
                }
                return null;
            }
        };
        expect(SalesInquiryModel.getCurrentUserName(mockComponent)).toBe("sales_rep");
    });

    test("getCurrentUserName falls back to alice when no component or user model", () => {
        expect(SalesInquiryModel.getCurrentUserName(null)).toBe("alice");
    });

    test("createInitialModel initializes header and item with 10-increment numbering", () => {
        const oModel = SalesInquiryModel.createInitialModel("testuser");
        const oHeader = oModel.getProperty("/header");
        const aItems = oModel.getProperty("/items");

        expect(oHeader.CreatedByUser).toBe("testuser");
        expect(oHeader.SalesInquiryType).toBe("ZIN");
        expect(oHeader.SalesOrganization).toBe("1000");
        expect(oHeader.DistributionChannel).toBe("10");
        expect(oHeader.OrganizationDivision).toBe("52");
        expect(oHeader.StatusText).toBe("Draft");
        expect(oHeader.TransactionCurrency).toBe("INR");

        expect(aItems.length).toBe(1);
        expect(aItems[0].SalesInquiryItem).toBe("000010");
        expect(aItems[0].OrderQuantity).toBe(1);
        expect(aItems[0].OrderQuantityUnit).toBe("PC");
    });
});

describe("SalesInquiryModel - Configuration Defaults & Cascading Derivations", () => {
    const mockConfig = {
        inquiryTypes: [
            { SalesDocumentType: "IN", Description: "Standard Inquiry" },
            { SalesDocumentType: "ZIN", Description: "Custom Inquiry" }
        ],
        salesOrgs: [
            { SalesOrganization: "1000", Description: "BestRun Corp" },
            { SalesOrganization: "2000", Description: "Secondary Org" }
        ],
        distChannels: [
            { SalesOrganization: "1000", DistributionChannel: "10", Description: "Direct" },
            { SalesOrganization: "1000", DistributionChannel: "20", Description: "Wholesale" },
            { SalesOrganization: "2000", DistributionChannel: "30", Description: "Retail" }
        ],
        divisions: [
            { SalesOrganization: "1000", DistributionChannel: "10", Division: "52", Description: "Div 52" },
            { SalesOrganization: "1000", DistributionChannel: "10", Division: "01", Description: "Div 01" }
        ]
    };

    test("applyConfigurationDefaults prefers ZIN when available", () => {
        const oModel = SalesInquiryModel.createInitialModel("alice");
        oModel.setProperty("/header/SalesInquiryType", "");
        SalesInquiryModel.applyConfigurationDefaults(oModel, mockConfig);
        expect(oModel.getProperty("/header/SalesInquiryType")).toBe("ZIN");
    });

    test("applyConfigurationDefaults respects user modification flag", () => {
        const oModel = SalesInquiryModel.createInitialModel("alice");
        oModel.setProperty("/header/SalesInquiryType", "IN");
        SalesInquiryModel.markUserModified(oModel, "SalesInquiryType", true);

        SalesInquiryModel.applyConfigurationDefaults(oModel, mockConfig);
        expect(oModel.getProperty("/header/SalesInquiryType")).toBe("IN");
    });

    test("applyConfigurationDefaults filters channels by sales org and division by org + channel", () => {
        const oModel = SalesInquiryModel.createInitialModel("alice");
        oModel.setProperty("/header/SalesOrganization", "1000");
        oModel.setProperty("/header/DistributionChannel", "");
        oModel.setProperty("/header/OrganizationDivision", "");

        SalesInquiryModel.applyConfigurationDefaults(oModel, mockConfig);
        expect(oModel.getProperty("/header/DistributionChannel")).toBe("10");
        expect(oModel.getProperty("/header/OrganizationDivision")).toBe("52");
    });
});

describe("SalesInquiryModel - Customer Commercial Defaults", () => {
    test("deriveCustomerDefaults populates Sold-to details and derives Ship-To and Currency", () => {
        const oModel = SalesInquiryModel.createInitialModel("alice");
        const customerDefaults = {
            derived: true,
            CustomerName: "ACME Corp",
            City: "Frankfurt",
            Country: "DE",
            ShipToParty: "10135",
            ShipToPartyName: "ACME Corp Delivery",
            Currency: "EUR"
        };

        SalesInquiryModel.deriveCustomerDefaults(oModel, "10135", customerDefaults);
        expect(oModel.getProperty("/header/CustomerName")).toBe("ACME Corp");
        expect(oModel.getProperty("/header/CustomerCity")).toBe("Frankfurt");
        expect(oModel.getProperty("/header/ShipToParty")).toBe("10135");
        expect(oModel.getProperty("/header/TransactionCurrency")).toBe("EUR");
    });

    test("deriveCustomerDefaults respects user-modified Ship-To and Currency", () => {
        const oModel = SalesInquiryModel.createInitialModel("alice");
        oModel.setProperty("/header/ShipToParty", "CUSTOM_SHIP_TO");
        oModel.setProperty("/header/TransactionCurrency", "USD");
        SalesInquiryModel.markUserModified(oModel, "ShipToParty", true);
        SalesInquiryModel.markUserModified(oModel, "TransactionCurrency", true);

        const customerDefaults = {
            derived: true,
            CustomerName: "ACME Corp",
            ShipToParty: "10135",
            Currency: "EUR"
        };

        SalesInquiryModel.deriveCustomerDefaults(oModel, "10135", customerDefaults);
        expect(oModel.getProperty("/header/ShipToParty")).toBe("CUSTOM_SHIP_TO");
        expect(oModel.getProperty("/header/TransactionCurrency")).toBe("USD");
    });
});

describe("SalesInquiryModel - Item Management & Calculations", () => {
    test("addItem increments item numbers in 10s (000010, 000020...)", () => {
        const oModel = SalesInquiryModel.createInitialModel("alice");
        expect(oModel.getProperty("/items").length).toBe(1);
        expect(oModel.getProperty("/items/0/SalesInquiryItem")).toBe("000010");

        SalesInquiryModel.addItem(oModel);
        expect(oModel.getProperty("/items").length).toBe(2);
        expect(oModel.getProperty("/items/1/SalesInquiryItem")).toBe("000020");

        SalesInquiryModel.addItem(oModel);
        expect(oModel.getProperty("/items").length).toBe(3);
        expect(oModel.getProperty("/items/2/SalesInquiryItem")).toBe("000030");
    });

    test("deleteItem removes item and re-sequences 10-increment numbers", () => {
        const oModel = SalesInquiryModel.createInitialModel("alice");
        SalesInquiryModel.addItem(oModel); // 000020
        SalesInquiryModel.addItem(oModel); // 000030
        expect(oModel.getProperty("/items").length).toBe(3);

        // Delete middle item (/items/1)
        SalesInquiryModel.deleteItem(oModel, "/items/1");
        const aItems = oModel.getProperty("/items");
        expect(aItems.length).toBe(2);
        expect(aItems[0].SalesInquiryItem).toBe("000010");
        expect(aItems[1].SalesInquiryItem).toBe("000020");
    });

    test("calculateTotals computes line net amount and header total", () => {
        const oModel = SalesInquiryModel.createInitialModel("alice");
        SalesInquiryModel.addItem(oModel);

        oModel.setProperty("/items/0/OrderQuantity", 2);
        oModel.setProperty("/items/0/NetPriceAmount", 150.50);

        oModel.setProperty("/items/1/OrderQuantity", 5);
        oModel.setProperty("/items/1/NetPriceAmount", 10.00);

        SalesInquiryModel.calculateTotals(oModel);
        expect(oModel.getProperty("/items/0/NetAmount")).toBe("301.00");
        expect(oModel.getProperty("/items/1/NetAmount")).toBe("50.00");
        expect(oModel.getProperty("/header/TotalNetAmount")).toBe("351.00");
    });

    test("updateStatus transitions to Ready to Create when all mandatory fields are present", () => {
        const oModel = SalesInquiryModel.createInitialModel("alice");
        oModel.setProperty("/header/SoldToParty", "10135");
        oModel.setProperty("/items/0/Material", "MAT-01");
        oModel.setProperty("/items/0/OrderQuantity", 2);
        oModel.setProperty("/items/0/OrderQuantityUnit", "PC");

        SalesInquiryModel.updateStatus(oModel);
        expect(oModel.getProperty("/header/StatusText")).toBe("Ready to Create");
        expect(oModel.getProperty("/header/StatusState")).toBe("Success");
    });
});

describe("SalesInquiryModel - Incompletion Log Validation (V.02)", () => {
    test("validateForm fails when required header fields are missing", () => {
        const oModel = SalesInquiryModel.createInitialModel("alice");
        oModel.setProperty("/header/SoldToParty", ""); // Missing Sold-to

        const isValid = SalesInquiryModel.validateForm(oModel);
        expect(isValid).toBe(false);
        expect(oModel.getProperty("/hasError")).toBe(true);
        expect(oModel.getProperty("/errors/SoldToParty/state")).toBe("Error");
    });

    test("validateForm catches invalid currency code", () => {
        const oModel = SalesInquiryModel.createInitialModel("alice");
        oModel.setProperty("/header/SoldToParty", "10135");
        oModel.setProperty("/header/TransactionCurrency", "INVALID_CURRENCY");

        const isValid = SalesInquiryModel.validateForm(oModel);
        expect(isValid).toBe(false);
        expect(oModel.getProperty("/errors/TransactionCurrency/state")).toBe("Error");
    });

    test("validateForm catches invalid date sequence (end date before start date)", () => {
        const oModel = SalesInquiryModel.createInitialModel("alice");
        oModel.setProperty("/header/SoldToParty", "10135");
        oModel.setProperty("/header/BindingPeriodValidityStartDate", "2026-05-10");
        oModel.setProperty("/header/BindingPeriodValidityEndDate", "2026-05-01"); // Before start

        const isValid = SalesInquiryModel.validateForm(oModel);
        expect(isValid).toBe(false);
        expect(oModel.getProperty("/errors/BindingPeriodValidityEndDate/state")).toBe("Error");
    });

    test("validateForm validates item material, positive quantity, and unit", () => {
        const oModel = SalesInquiryModel.createInitialModel("alice");
        oModel.setProperty("/header/SoldToParty", "10135");
        oModel.setProperty("/items/0/Material", ""); // Missing
        oModel.setProperty("/items/0/OrderQuantity", 0); // Invalid quantity <= 0
        oModel.setProperty("/items/0/OrderQuantityUnit", ""); // Missing unit

        const isValid = SalesInquiryModel.validateForm(oModel);
        expect(isValid).toBe(false);
        const aItems = oModel.getProperty("/items");
        expect(aItems[0].errors.Material.state).toBe("Error");
        expect(aItems[0].errors.OrderQuantity.state).toBe("Error");
        expect(aItems[0].errors.OrderQuantityUnit.state).toBe("Error");
    });

    test("validateForm succeeds when all header and item mandatory fields are provided", () => {
        const oModel = SalesInquiryModel.createInitialModel("alice");
        oModel.setProperty("/header/SoldToParty", "10135");
        oModel.setProperty("/header/BindingPeriodValidityStartDate", "2026-05-01");
        oModel.setProperty("/header/BindingPeriodValidityEndDate", "2026-05-31");
        oModel.setProperty("/items/0/Material", "4000000123");
        oModel.setProperty("/items/0/OrderQuantity", 10);
        oModel.setProperty("/items/0/OrderQuantityUnit", "PC");

        const isValid = SalesInquiryModel.validateForm(oModel);
        expect(isValid).toBe(true);
        expect(oModel.getProperty("/hasError")).toBe(false);
        expect(oModel.getProperty("/errorCount")).toBe(0);
    });

    test("clearErrors clears all header and item errors", () => {
        const oModel = SalesInquiryModel.createInitialModel("alice");
        oModel.setProperty("/header/SoldToParty", "");
        SalesInquiryModel.validateForm(oModel);
        expect(oModel.getProperty("/hasError")).toBe(true);

        SalesInquiryModel.clearErrors(oModel);
        expect(oModel.getProperty("/hasError")).toBe(false);
        expect(oModel.getProperty("/errorCount")).toBe(0);
        expect(Object.keys(oModel.getProperty("/errors")).length).toBe(0);
    });

    test("applyMaterialDefaults sets Material, description and direct UNIT based on Material master data configuration", () => {
        const oModel = SalesInquiryModel.createInitialModel("alice");
        // Pre-set an error state on OrderQuantityUnit
        oModel.setProperty("/items/0/errors/OrderQuantityUnit", { state: "Error", text: "Unit is required" });
        oModel.setProperty("/items/0/errors/Material", { state: "Error", text: "Material is required" });

        const materialMasterData = {
            Material: "1000000003",
            MaterialName: "Test Chemical Compound",
            MaterialBaseUnit: "KG"
        };

        const report = SalesInquiryModel.applyMaterialDefaults(oModel, "/items/0", materialMasterData);

        expect(report.Material).toBe("1000000003");
        expect(report.SalesInquiryItemText).toBe("Test Chemical Compound");
        expect(report.OrderQuantityUnit).toBe("KG");

        expect(oModel.getProperty("/items/0/Material")).toBe("1000000003");
        expect(oModel.getProperty("/items/0/SalesInquiryItemText")).toBe("Test Chemical Compound");
        expect(oModel.getProperty("/items/0/OrderQuantityUnit")).toBe("KG");
        expect(oModel.getProperty("/items/0/errors/Material/state")).toBe("None");
        expect(oModel.getProperty("/items/0/errors/OrderQuantityUnit/state")).toBe("None");
    });

    describe("SalesInquiryModel - API Payload Builder (buildPayload)", () => {
        test("buildPayload strips CustomerCity, CustomerCountry, and other non-contract UI properties from header", () => {
            const oModel = SalesInquiryModel.createInitialModel("alice");
            oModel.setProperty("/header/SoldToParty", "10135");
            SalesInquiryModel.deriveCustomerDefaults(oModel, "10135", {
                CustomerName: "Divi's Laboratories Limited",
                City: "Hyderabad",
                Country: "IN",
                Currency: "INR",
                ShipToParty: "10135",
                ShipToPartyName: "Divi's Laboratories Limited",
                derived: true
            });

            // Model has UI properties
            expect(oModel.getProperty("/header/CustomerCity")).toBe("Hyderabad");
            expect(oModel.getProperty("/header/CustomerCountry")).toBe("IN");
            expect(oModel.getProperty("/header/StatusText")).toBe("Draft");

            const payload = SalesInquiryModel.buildPayload(oModel);

            // Crucial: CustomerCity and other UI-only properties must NOT exist in the API payload header
            expect(payload.header.CustomerCity).toBeUndefined();
            expect(payload.header.CustomerCountry).toBeUndefined();
            expect(payload.header.ShipToPartyName).toBeUndefined();
            expect(payload.header.StatusText).toBeUndefined();
            expect(payload.header.StatusState).toBeUndefined();
            expect(payload.header.StatusIcon).toBeUndefined();
            expect(payload.header.CreatedByUser).toBeUndefined();

            // Contract-valid properties must be preserved
            expect(payload.header.SalesInquiryType).toBe("ZIN");
            expect(payload.header.SalesOrganization).toBe("1000");
            expect(payload.header.DistributionChannel).toBe("10");
            expect(payload.header.OrganizationDivision).toBe("52");
            expect(payload.header.SoldToParty).toBe("10135");
            expect(payload.header.CustomerName).toBe("Divi's Laboratories Limited");
            expect(payload.header.ShipToParty).toBe("10135");
            expect(payload.header.TransactionCurrency).toBe("INR");
        });

        test("buildPayload strips item errors object while preserving all item contract fields", () => {
            const oModel = SalesInquiryModel.createInitialModel("alice");
            oModel.setProperty("/items/0/Material", "4000000091");
            oModel.setProperty("/items/0/SalesInquiryItemText", "BPAO88063");
            oModel.setProperty("/items/0/OrderQuantity", 5);
            oModel.setProperty("/items/0/OrderQuantityUnit", "PC");
            oModel.setProperty("/items/0/NetPriceAmount", 120);
            oModel.setProperty("/items/0/NetAmount", 600);
            oModel.setProperty("/items/0/errors", { Material: { state: "None" } });

            const payload = SalesInquiryModel.buildPayload(oModel);

            expect(payload.items).toHaveLength(1);
            const item = payload.items[0];
            expect(item.errors).toBeUndefined();
            expect(item.SalesInquiryItem).toBe("000010");
            expect(item.Material).toBe("4000000091");
            expect(item.SalesInquiryItemText).toBe("BPAO88063");
            expect(item.OrderQuantity).toBe(5);
            expect(item.OrderQuantityUnit).toBe("PC");
            expect(item.NetPriceAmount).toBe(120);
            expect(item.NetAmount).toBe(600);
            expect(item.TransactionCurrency).toBe("INR");
        });

        test("buildPayload returns empty header and items for falsy model", () => {
            const payload = SalesInquiryModel.buildPayload(null);
            expect(payload).toEqual({ header: {}, items: [] });
        });
    });
});
