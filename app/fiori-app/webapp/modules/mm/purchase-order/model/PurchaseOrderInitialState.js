(function () {
    "use strict";

    var HEADER_FIELD_CONFIG = {
        PurchaseOrderType: { controlId: "inDocType", label: "Document Type", section: "General Data", example: "ZDOM" },
        CompanyCode: { controlId: "inCompanyCode", label: "Company Code", section: "General Data", example: "1010" },
        PurchasingOrganization: { controlId: "inPurchOrg", label: "Purchasing Organization", section: "General Data", example: "1010" },
        PurchasingGroup: { controlId: "inPurchGrp", label: "Purchasing Group", section: "General Data", example: "001" },
        DocumentDate: { controlId: "inDocDate", label: "Document Date", section: "General Data", example: "DD-MM-YYYY" },
        Supplier: { controlId: "inSupplier", label: "Supplier", section: "Supplier & Commercial Terms", example: "10300001" },
        Currency: { controlId: "inCurrency", label: "Currency", section: "Supplier & Commercial Terms", example: "EUR" },
        IncotermsClassification: { controlId: "inIncoterms", label: "Incoterms", section: "Supplier & Commercial Terms", example: "EXW" },
        IncotermsLocation1: { controlId: "inIncotermsLoc", label: "Incoterms Location 1", section: "Supplier & Commercial Terms", example: "MUMBAI" },
        PaymentTerms: { controlId: "inPaymentTerms", label: "Payment Terms", section: "Supplier & Commercial Terms", example: "0001" }
    };

    var ITEM_FIELD_CONFIG = {
        Plant: { cellIndex: 3, label: "Plant", example: "1010" },
        StorageLocation: { cellIndex: 4, label: "Storage Location", example: "101A" },
        Material: { cellIndex: 5, label: "Material", example: "TG11" },
        PurchaseOrderItemText: { cellIndex: 6, label: "Description", example: "Polypropylene Resin" },
        OrderQuantity: { cellIndex: 7, label: "Quantity", example: "10" },
        UnitOfMeasure: { cellIndex: 8, label: "Unit of Measure", example: "PC" },
        NetPriceAmount: { cellIndex: 9, label: "Net Price", example: "100.00" },
        TaxCode: { cellIndex: 10, label: "Tax Code", example: "V1" }
    };

    var oInitialState = {
        HEADER_FIELD_CONFIG: HEADER_FIELD_CONFIG,
        ITEM_FIELD_CONFIG: ITEM_FIELD_CONFIG,

        createInitialModel: function (sUser, JSONModelClass) {
            var ModelClass = JSONModelClass;
            if (!ModelClass) {
                try {
                    var oGlobal = typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : null);
                    var oSap = oGlobal ? oGlobal["s" + "ap"] : null;
                    if (oSap && oSap.ui && typeof oSap.ui.require === "function") {
                        ModelClass = oSap.ui.require("sap/ui/model/json/JSONModel");
                    }
                } catch (e) {}
            }

            var oData = {
                hasError: false,
                errorMessage: "",
                errorCount: 0,
                errorList: [],
                uiRules: {
                    materialRequired: true,
                    storageLocationRequired: true,
                    isService: false,
                    isStockTransfer: false,
                    isReturn: false,
                    isSubcontracting: false,
                    showAccountAssignment: false,
                    showItemCategory: true,
                    allowedItemCategories: ["0"],
                    allowedAcctAssignmentCategories: [""]
                },
                userModified: {
                    PurchaseOrderType: false,
                    CompanyCode: false,
                    PurchasingOrganization: false,
                    PurchasingGroup: false,
                    Supplier: false,
                    DocumentDate: false,
                    Currency: false,
                    PaymentTerms: false,
                    IncotermsClassification: false,
                    IncotermsLocation1: false
                },
                supplierDefaultsDerived: false,
                supplierDefaultsSource: "",
                supplierDefaultsLastPo: "",
                supplierDefaultsMessage: "",
                configDerived: {
                    PurchaseOrderType: false,
                    CompanyCode: false,
                    PurchasingOrganization: false,
                    Currency: false,
                    PaymentTerms: false,
                    IncotermsClassification: false,
                    IncotermsLocation1: false
                },
                errors: {
                    PurchaseOrderType: { state: "None", text: "" },
                    CompanyCode: { state: "None", text: "" },
                    PurchasingOrganization: { state: "None", text: "" },
                    PurchasingGroup: { state: "None", text: "" },
                    Supplier: { state: "None", text: "" },
                    Currency: { state: "None", text: "" },
                    DocumentDate: { state: "None", text: "" },
                    IncotermsClassification: { state: "None", text: "" },
                    IncotermsLocation1: { state: "None", text: "" },
                    PaymentTerms: { state: "None", text: "" }
                },
                header: {
                    PurchaseOrderType: "",
                    PurchaseOrderTypeText: "",
                    CompanyCode: "",
                    PurchasingOrganization: "",
                    PurchasingGroup: "",
                    Supplier: "",
                    DocumentDate: new Date().toISOString().split("T")[0],
                    Currency: "",
                    IncotermsClassification: "",
                    IncotermsLocation1: "",
                    PaymentTerms: "",
                    StatusText: "Draft",
                    StatusState: "Warning",
                    StatusIcon: "sap-icon://alert",
                    PurchasingCompletenessStatus: false
                },
                items: [
                    {
                        PurchaseOrderItem: "10",
                        PurchaseOrderItemCategory: "0",
                        AccountAssignmentCategory: "",
                        Material: "",
                        PurchaseOrderItemText: "",
                        MaterialGroup: "",
                        Plant: "",
                        StorageLocation: "",
                        OrderQuantity: "",
                        UnitOfMeasure: "",
                        NetPriceAmount: "",
                        TaxCode: "",
                        NetAmount: "0.00",
                        NetAmountIsEstimate: true,
                        RequisitionerName: sUser || "",
                        errors: {
                            Plant: { state: "None", text: "" },
                            StorageLocation: { state: "None", text: "" },
                            Material: { state: "None", text: "" },
                            PurchaseOrderItemText: { state: "None", text: "" },
                            OrderQuantity: { state: "None", text: "" },
                            UnitOfMeasure: { state: "None", text: "" },
                            NetPriceAmount: { state: "None", text: "" },
                            TaxCode: { state: "None", text: "" },
                            PurchaseOrderItemCategory: { state: "None", text: "" },
                            AccountAssignmentCategory: { state: "None", text: "" }
                        }
                    }
                ]
            };

            return ModelClass ? new ModelClass(oData) : oData;
        }
    };

    var isNode = typeof module !== "undefined" && module.exports;
    if (isNode) {
        module.exports = oInitialState;
    }
    if (!isNode && typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function") {
        sap.ui.define([], function () {
            return oInitialState;
        });
    }
})();
