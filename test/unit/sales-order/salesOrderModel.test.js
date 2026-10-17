/**
 * Unit Tests for Sales Order Model (VA01 Frontend State, Defaulting & Incompletion Log)
 * Target: app/fiori-app/webapp/modules/sd/sales-order/model/SalesOrderModel.js
 */

let SalesOrderModel;

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
                SalesOrderModel = factory(MockJSONModel);
            }
        }
    };
    require("../../../app/fiori-app/webapp/modules/sd/sales-order/model/SalesOrderModel");
});

describe("SalesOrderModel - Initial State and User Resolution", () => {
    test("getCurrentUserName resolves username from auth model", () => {
        const mockComponent = {
            getModel: (name) => {
                if (name === "auth") {
                    return {
                        getProperty: (p) => (p === "/user/username" ? "sales_manager" : null)
                    };
                }
                return null;
            }
        };
        expect(SalesOrderModel.getCurrentUserName(mockComponent)).toBe("sales_manager");
    });

    test("getCurrentUserName falls back to alice when no component or user model", () => {
        expect(SalesOrderModel.getCurrentUserName(null)).toBe("alice");
    });

    test("createInitialModel initializes header and item with defaults", () => {
        const oModel = SalesOrderModel.createInitialModel("john");
        const header = oModel.getProperty("/header");
        const items = oModel.getProperty("/items");

        expect(header.SalesOrderType).toBe("");
        expect(header.SalesOrganization).toBe("");
        expect(header.DistributionChannel).toBe("");
        expect(header.OrganizationDivision).toBe("");
        expect(header.TransactionCurrency).toBe("");
        // No customer PO date is assumed: it is sent to SAP only when the user enters one.
        expect(header.CustomerPurchaseOrderDate).toBe("");
        expect(header.CreatedByUser).toBe("john");

        expect(items).toHaveLength(1);
        expect(items[0].SalesOrderItem).toBe("10");
        expect(items[0].Plant).toBe("");
        expect(items[0].OrderQuantityUnit).toBe("");
        expect(items[0].OrderQuantity).toBe("");
    });
});

describe("SalesOrderModel - Calculation and Item Operations", () => {
    test("createEmptyItem sets sequential item number and defaults", () => {
        const item = SalesOrderModel.createEmptyItem(2, "1120", "2026-10-01");
        expect(item.SalesOrderItem).toBe("30");
        expect(item.Plant).toBe("1120");
        expect(item.RequestedDeliveryDate).toBe("2026-10-01");
        expect(item.OrderQuantity).toBe("");
        expect(item.OrderQuantityUnit).toBe("");
    });

    test("applyServerDefaults applies server-sourced defaults to empty fields only", () => {
        const oModel = SalesOrderModel.createInitialModel();
        oModel.setProperty("/header/TransactionCurrency", "EUR");

        SalesOrderModel.applyServerDefaults(oModel, {
            SalesOrderType: "ZDOM",
            SalesOrganization: "1000",
            DistributionChannel: "10",
            OrganizationDivision: "52",
            TransactionCurrency: "INR",
            RequestedDeliveryDate: "2026-10-15",
            Plant: "1120",
            OrderQuantityUnit: "KG"
        });

        const header = oModel.getProperty("/header");
        const item = oModel.getProperty("/items/0");

        expect(header.SalesOrderType).toBe("ZDOM");
        expect(header.SalesOrganization).toBe("1000");
        expect(header.DistributionChannel).toBe("10");
        expect(header.OrganizationDivision).toBe("52");
        expect(header.TransactionCurrency).toBe("EUR");
        expect(header.RequestedDeliveryDate).toBe("2026-10-15");

        expect(item.Plant).toBe("1120");
        expect(item.OrderQuantityUnit).toBe("KG");
        expect(item.RequestedDeliveryDate).toBe("2026-10-15");
    });

    test("calculateTotals computes item net amounts and header total net value", () => {
        const oModel = SalesOrderModel.createInitialModel();
        oModel.setProperty("/items", [
            { OrderQuantity: "2", NetPriceAmount: "150.50" },
            { OrderQuantity: "3", NetPriceAmount: "100.00" }
        ]);

        SalesOrderModel.calculateTotals(oModel);

        const items = oModel.getProperty("/items");
        expect(items[0].NetAmount).toBe("301.00");
        expect(items[1].NetAmount).toBe("300.00");
        expect(oModel.getProperty("/header/TotalNetAmount")).toBe("601.00");
    });

    test("applyCustomerDefaults updates customer details and ship-to party", () => {
        const oModel = SalesOrderModel.createInitialModel();
        SalesOrderModel.applyCustomerDefaults(oModel, {
            CustomerName: "Acme Chemicals",
            City: "Mumbai",
            Country: "IN",
            Currency: "INR",
            ShipToParty: "10136",
            ShipToPartyName: "Acme Plant 2"
        });

        const header = oModel.getProperty("/header");
        expect(header.CustomerName).toBe("Acme Chemicals");
        expect(header.CustomerCity).toBe("Mumbai");
        expect(header.ShipToParty).toBe("10136");
        expect(header.ShipToPartyName).toBe("Acme Plant 2");
    });

    test("applyMaterialDefaults sets material, desc, unit and recalculates totals", () => {
        const oModel = SalesOrderModel.createInitialModel();
        SalesOrderModel.applyMaterialDefaults(oModel, "/items/0", {
            Material: "4000000001",
            MaterialName: "Sodium Chloride",
            MaterialBaseUnit: "KG"
        });

        const item = oModel.getProperty("/items/0");
        expect(item.Material).toBe("4000000001");
        expect(item.SalesOrderItemText).toBe("Sodium Chloride");
        expect(item.OrderQuantityUnit).toBe("KG");
    });
});

describe("SalesOrderModel - Validation and Payload Generation", () => {
    test("validateForm fails when required fields are missing", () => {
        const oModel = SalesOrderModel.createInitialModel();
        oModel.setProperty("/header/SoldToParty", ""); // Missing sold-to party
        oModel.setProperty("/items/0/Material", "");   // Missing material

        const bValid = SalesOrderModel.validateForm(oModel);
        expect(bValid).toBe(false);
        expect(oModel.getProperty("/hasError")).toBe(true);
        expect(oModel.getProperty("/errorCount")).toBeGreaterThan(0);
    });

    test("validateForm passes when all required fields and items are populated", () => {
        const oModel = SalesOrderModel.createInitialModel();
        SalesOrderModel.applyServerDefaults(oModel, {
            SalesOrderType: "ZDOM",
            SalesOrganization: "1000",
            DistributionChannel: "10",
            OrganizationDivision: "52",
            TransactionCurrency: "INR",
            Plant: "1120",
            OrderQuantityUnit: "KG"
        });
        oModel.setProperty("/header/SoldToParty", "10135");
        oModel.setProperty("/header/PaymentTerms", "0001");
        oModel.setProperty("/header/ContactPerson", "25116");
        oModel.setProperty("/items/0/Material", "4000000001");
        oModel.setProperty("/items/0/Plant", "1120");
        oModel.setProperty("/items/0/OrderQuantity", "5.000");
        oModel.setProperty("/items/0/OrderQuantityUnit", "KG");

        const bValid = SalesOrderModel.validateForm(oModel);
        expect(bValid).toBe(true);
        expect(oModel.getProperty("/hasError")).toBe(false);
        expect(oModel.getProperty("/errorCount")).toBe(0);
    });

    test("each required field empty blocks Create", () => {
        const createPopulatedModel = () => {
            const oModel = SalesOrderModel.createInitialModel();
            SalesOrderModel.applyServerDefaults(oModel, {
                SalesOrderType: "ZDOM",
                SalesOrganization: "1000",
                DistributionChannel: "10",
                OrganizationDivision: "52",
                TransactionCurrency: "INR",
                Plant: "1120",
                OrderQuantityUnit: "KG"
            });
            oModel.setProperty("/header/SoldToParty", "10135");
            oModel.setProperty("/header/PaymentTerms", "0001");
            oModel.setProperty("/header/ContactPerson", "25116");
            oModel.setProperty("/items/0/Material", "4000000001");
            oModel.setProperty("/items/0/Plant", "1120");
            oModel.setProperty("/items/0/OrderQuantity", "5.000");
            oModel.setProperty("/items/0/OrderQuantityUnit", "KG");
            return oModel;
        };

        const requiredFields = [
            { field: "PaymentTerms", expectedError: "Payment Terms are required" },
            { field: "ContactPerson", expectedError: "Contact Person is required" }
        ];

        requiredFields.forEach(({ field, expectedError }) => {
            const oModel = createPopulatedModel();
            oModel.setProperty("/header/" + field, "");
            const bValid = SalesOrderModel.validateForm(oModel);
            expect(bValid).toBe(false);
            expect(oModel.getProperty("/hasError")).toBe(true);
            const err = oModel.getProperty("/errors/" + field);
            expect(err.state).toBe("Error");
            expect(err.text).toBe(expectedError);
        });
    });

    test("hidden fields empty do not block Create", () => {
        const oModel = SalesOrderModel.createInitialModel();
        SalesOrderModel.applyServerDefaults(oModel, {
            SalesOrderType: "ZDOM",
            SalesOrganization: "1000",
            DistributionChannel: "10",
            OrganizationDivision: "52",
            TransactionCurrency: "INR",
            Plant: "1120",
            OrderQuantityUnit: "KG"
        });
        oModel.setProperty("/header/SoldToParty", "10135");
        oModel.setProperty("/header/PaymentTerms", "0001");
        oModel.setProperty("/header/ContactPerson", "25116");

        // Explicitly leave all hidden fields empty
        oModel.setProperty("/header/PurchaseOrderNumber", "");
        oModel.setProperty("/header/CustomerPurchaseOrderDate", "");
        oModel.setProperty("/header/CustomerGroup2", "");
        oModel.setProperty("/header/PortOfLoading", "");
        oModel.setProperty("/header/PortOfDischarge", "");
        oModel.setProperty("/items/0/Material", "4000000001");
        oModel.setProperty("/items/0/Plant", "1120");
        oModel.setProperty("/items/0/OrderQuantity", "5.000");
        oModel.setProperty("/items/0/OrderQuantityUnit", "KG");
        oModel.setProperty("/items/0/SalesOrderItemText", "");
        oModel.setProperty("/items/0/NetPriceAmount", "");

        const bValid = SalesOrderModel.validateForm(oModel);
        expect(bValid).toBe(true);
        expect(oModel.getProperty("/hasError")).toBe(false);
        expect(oModel.getProperty("/errorCount")).toBe(0);
    });

    test("getIncompletionGaps returns gaps for missing commercial fields", () => {
        const oModel = SalesOrderModel.createInitialModel();
        const gaps = SalesOrderModel.getIncompletionGaps(oModel);
        expect(gaps).toContain("Payment Terms");
        expect(gaps).toContain("Contact Person");

        oModel.setProperty("/header/PaymentTerms", "0001");
        oModel.setProperty("/header/ContactPerson", "12345");

        const noGaps = SalesOrderModel.getIncompletionGaps(oModel);
        expect(noGaps).toHaveLength(0);
    });

    test("buildPayload constructs clean API-compliant payload with the two commercial fields", () => {
        const oModel = SalesOrderModel.createInitialModel("sales_rep");
        SalesOrderModel.applyServerDefaults(oModel, {
            SalesOrderType: "ZDOM",
            SalesOrganization: "1000",
            DistributionChannel: "10",
            OrganizationDivision: "52",
            TransactionCurrency: "INR"
        });
        oModel.setProperty("/header/SoldToParty", "10135");
        oModel.setProperty("/header/PurchaseOrderNumber", "PO-99988");
        oModel.setProperty("/header/PaymentTerms", "PT11");
        oModel.setProperty("/header/ContactPerson", "25116");
        oModel.setProperty("/header/Incoterms", "CIF");
        oModel.setProperty("/header/IncotermsLocation1", "Mumbai Port");
        oModel.setProperty("/items/0/Material", "4000000001");
        oModel.setProperty("/items/0/OrderQuantity", "10.000");
        oModel.setProperty("/items/0/OrderQuantityUnit", "KG");
        oModel.setProperty("/items/0/NetPriceAmount", "50.00");
        oModel.setProperty("/items/0/Plant", "1120");
        SalesOrderModel.calculateTotals(oModel);

        const payload = SalesOrderModel.buildPayload(oModel);

        expect(payload.header.SalesOrderType).toBe("ZDOM");
        expect(payload.header.SoldToParty).toBe("10135");
        expect(payload.header.PurchaseOrderNumber).toBe("PO-99988");
        expect(payload.header.PaymentTerms).toBe("PT11");
        expect(payload.header.PaymentTermCode).toBe("PT11");
        expect(payload.header.ContactPerson).toBe("25116");
        expect(payload.header.Incoterms).toBe("CIF");
        expect(payload.header.INCO1).toBe("CIF");
        expect(payload.header.IncotermsLocation1).toBe("Mumbai Port");
        expect(payload.header.INCO2).toBe("Mumbai Port");
        expect(payload.header.INCO2_L).toBe("Mumbai Port");
        expect(payload.header.IncotermsClassification).toBeUndefined();
        expect(payload.header.TotalNetAmount).toBe(500);

        expect(payload.items).toHaveLength(1);
        expect(payload.items[0].Material).toBe("4000000001");
        expect(payload.items[0].OrderQuantity).toBe(10);
        expect(payload.items[0].OrderQuantityUnit).toBe("KG");
        expect(payload.items[0].NetPriceAmount).toBe(50);
        expect(payload.items[0].NetAmount).toBe(500);
        expect(payload.items[0].Plant).toBe("1120");
    });

    test("applyCustomerDefaults proposes INCO1 and INCO2 from customer defaults", () => {
        const oModel = SalesOrderModel.createInitialModel();
        SalesOrderModel.applyCustomerDefaults(oModel, {
            CustomerName: "Customer XYZ",
            INCO1: "EXW",
            INCO2: "Sachin"
        });

        expect(oModel.getProperty("/header/Incoterms")).toBe("EXW");
        expect(oModel.getProperty("/header/INCO1")).toBe("EXW");
        expect(oModel.getProperty("/header/IncotermsLocation1")).toBe("Sachin");
        expect(oModel.getProperty("/header/INCO2")).toBe("Sachin");
    });

    test("applyCustomerDefaults does not overwrite user-entered values", () => {
        const oModel = SalesOrderModel.createInitialModel();
        oModel.setProperty("/header/PaymentTerms", "USER");
        oModel.setProperty("/header/TransactionCurrency", "USD");
        oModel.setProperty("/modifiedFields/PaymentTerms", true);

        SalesOrderModel.applyCustomerDefaults(oModel, {
            CustomerName: "Customer ABC",
            Currency: "EUR",
            PaymentTerms: "DEFL"
        });

        expect(oModel.getProperty("/header/CustomerName")).toBe("Customer ABC");
        expect(oModel.getProperty("/header/PaymentTerms")).toBe("USER");
        expect(oModel.getProperty("/header/TransactionCurrency")).toBe("USD");
    });

    test("buildPayload leaves empty fields without hardcoded fallbacks", () => {
        const oModel = SalesOrderModel.createInitialModel();
        const payload = SalesOrderModel.buildPayload(oModel);

        expect(payload.header.SalesOrderType).toBe("");
        expect(payload.header.SalesOrganization).toBe("");
        expect(payload.header.DistributionChannel).toBe("");
        expect(payload.header.OrganizationDivision).toBe("");
        expect(payload.header.TransactionCurrency).toBe("");
        expect(payload.items[0].OrderQuantity).toBe(0);
        expect(payload.items[0].OrderQuantityUnit).toBe("");
        expect(payload.items[0].Plant).toBe("");
    });

    test("validateSingleField validates Incoterms and IncotermsLocation1 length", () => {
        const oModel = SalesOrderModel.createInitialModel();

        oModel.setProperty("/header/Incoterms", "CIF");
        expect(SalesOrderModel.validateSingleField(oModel, "Incoterms")).toBe(true);
        expect(oModel.getProperty("/errors/Incoterms/state")).toBe("None");

        oModel.setProperty("/header/Incoterms", "TOOLONG");
        expect(SalesOrderModel.validateSingleField(oModel, "Incoterms")).toBe(false);
        expect(oModel.getProperty("/errors/Incoterms/state")).toBe("Error");
        expect(oModel.getProperty("/errors/Incoterms/text")).toBe("Incoterms cannot exceed 3 characters");

        oModel.setProperty("/header/IncotermsLocation1", "Mumbai Port Terminal 1");
        expect(SalesOrderModel.validateSingleField(oModel, "IncotermsLocation1")).toBe(true);
        expect(oModel.getProperty("/errors/IncotermsLocation1/state")).toBe("None");

        oModel.setProperty("/header/IncotermsLocation1", "A".repeat(71));
        expect(SalesOrderModel.validateSingleField(oModel, "IncotermsLocation1")).toBe(false);
        expect(oModel.getProperty("/errors/IncotermsLocation1/state")).toBe("Error");
        expect(oModel.getProperty("/errors/IncotermsLocation1/text")).toBe("Incoterms Location cannot exceed 70 characters");
    });
});
