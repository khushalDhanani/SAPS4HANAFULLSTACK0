// AUTO-GENERATED from config/schema/purchaseOrderRules.json - DO NOT EDIT MANUALLY
// Generated on: 2026-09-26T05:01:54.985Z
// To regenerate: node tools/generate-po-rules.js

(function (root, factory) {
    "use strict";
    if (typeof module !== "undefined" && module.exports) {
        module.exports = factory();
    }
    if (typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function" && typeof module === "undefined") {
        sap.ui.define([], factory);
    }
})(this, function () {
    "use strict";

    var SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "PurchaseOrderValidationRules",
    "description": "Authoritative single source of truth for Purchase Order domain validation constraints across CAP backend and SAPUI5 frontend.",
    "patterns": {
        "currency": "^[A-Za-z]{3}$",
        "docTypePrefix": "^Z"
    },
    "header": {
        "PurchaseOrderType": {
            "label": "Document Type",
            "required": true,
            "maxLen": 4,
            "prefix": "Z"
        },
        "CompanyCode": {
            "label": "Company Code",
            "required": true,
            "maxLen": 4
        },
        "PurchasingOrganization": {
            "label": "Purchasing Organization",
            "required": true,
            "maxLen": 4
        },
        "PurchasingGroup": {
            "label": "Purchasing Group",
            "required": true,
            "maxLen": 3
        },
        "Supplier": {
            "label": "Supplier",
            "required": true,
            "maxLen": 10
        },
        "Currency": {
            "label": "Currency",
            "required": true,
            "maxLen": 3,
            "pattern": "^[A-Za-z]{3}$"
        },
        "DocumentDate": {
            "label": "Document Date",
            "required": true
        },
        "IncotermsClassification": {
            "label": "Incoterms",
            "required": false,
            "maxLen": 3
        },
        "IncotermsLocation1": {
            "label": "Incoterms Location 1",
            "requiredIf": "IncotermsClassification",
            "maxLen": 70
        },
        "PaymentTerms": {
            "label": "Payment Terms",
            "required": false,
            "maxLen": 4
        }
    },
    "item": {
        "Material": {
            "label": "Material",
            "required": true,
            "maxLen": 40
        },
        "Plant": {
            "label": "Plant",
            "required": true,
            "maxLen": 4
        },
        "StorageLocation": {
            "label": "Storage Location",
            "required": true,
            "maxLen": 4
        },
        "OrderQuantity": {
            "label": "Order Quantity",
            "required": true,
            "min": 0,
            "exclusiveMin": true,
            "max": 999999999
        },
        "UnitOfMeasure": {
            "label": "Unit of Measure",
            "required": true,
            "maxLen": 3
        },
        "NetPriceAmount": {
            "label": "Net Price",
            "required": false,
            "min": 0
        },
        "TaxCode": {
            "label": "Tax Code",
            "required": false,
            "maxLen": 2
        },
        "MaterialGroup": {
            "label": "Material Group",
            "required": false,
            "maxLen": 9
        },
        "PurchaseOrderItemCategory": {
            "label": "Item Category",
            "required": false,
            "maxLen": 1
        },
        "AccountAssignmentCategory": {
            "label": "Account Assignment",
            "required": false,
            "maxLen": 1
        }
    },
    "itemsList": {
        "minItems": 1,
        "maxItems": 999
    },
    "poTypes": {
        "ZCAP": {
            "code": "ZCAP",
            "description": "Asset PO",
            "processType": "Asset",
            "allowedCompanyCodes": [
                "1000"
            ],
            "defaultCompanyCode": "1000",
            "allowedPurchOrgs": [
                "AE01",
                "AE02",
                "AE03",
                "AE04",
                "AE05"
            ],
            "defaultPurchOrg": "AE01",
            "supplierAccountGroup": null,
            "allowedCurrencies": [
                "INR",
                "USD",
                "EUR"
            ],
            "defaultCurrency": "INR",
            "allowedItemCategories": [
                "0"
            ],
            "defaultItemCategory": "0",
            "allowedAcctAssignmentCategories": [
                "A",
                "K",
                ""
            ],
            "defaultAcctAssignmentCategory": "A",
            "materialRequired": true,
            "allowedPlantPrefix": "1",
            "isAsset": true
        },
        "ZDIA": {
            "code": "ZDIA",
            "description": "Deemed Import PO-AIL",
            "processType": "DeemedImport",
            "allowedCompanyCodes": [
                "1000"
            ],
            "defaultCompanyCode": "1000",
            "allowedPurchOrgs": [
                "AE01",
                "AE02",
                "AE03",
                "AE04",
                "AE05"
            ],
            "defaultPurchOrg": "AE01",
            "supplierAccountGroup": null,
            "allowedCurrencies": [
                "INR",
                "USD",
                "EUR"
            ],
            "defaultCurrency": "INR",
            "allowedItemCategories": [
                "0"
            ],
            "defaultItemCategory": "0",
            "allowedAcctAssignmentCategories": [
                ""
            ],
            "defaultAcctAssignmentCategory": "",
            "materialRequired": true,
            "allowedPlantPrefix": "1"
        },
        "ZDIS": {
            "code": "ZDIS",
            "description": "Deemed Imp. PO-ASCL",
            "processType": "DeemedImport",
            "allowedCompanyCodes": [
                "2000"
            ],
            "defaultCompanyCode": "2000",
            "allowedPurchOrgs": [
                "AS02",
                "AS01"
            ],
            "defaultPurchOrg": "AS02",
            "supplierAccountGroup": null,
            "allowedCurrencies": [
                "INR",
                "USD",
                "EUR"
            ],
            "defaultCurrency": "USD",
            "allowedItemCategories": [
                "0"
            ],
            "defaultItemCategory": "0",
            "allowedAcctAssignmentCategories": [
                ""
            ],
            "defaultAcctAssignmentCategory": "",
            "materialRequired": true,
            "allowedPlantPrefix": "2"
        },
        "ZDOM": {
            "code": "ZDOM",
            "description": "Dom. Aether In.LTD.",
            "processType": "Domestic",
            "allowedCompanyCodes": [
                "1000"
            ],
            "defaultCompanyCode": "1000",
            "allowedPurchOrgs": [
                "AE01",
                "AE02",
                "AE03",
                "AE04",
                "AE05"
            ],
            "defaultPurchOrg": "AE01",
            "supplierAccountGroup": "ZDOM",
            "allowedCurrencies": [
                "INR"
            ],
            "defaultCurrency": "INR",
            "allowedItemCategories": [
                "0"
            ],
            "defaultItemCategory": "0",
            "allowedAcctAssignmentCategories": [
                ""
            ],
            "defaultAcctAssignmentCategory": "",
            "materialRequired": true,
            "allowedPlantPrefix": "1"
        },
        "ZDOS": {
            "code": "ZDOS",
            "description": "Dom.Aether Spec.Chem",
            "processType": "Domestic",
            "allowedCompanyCodes": [
                "2000"
            ],
            "defaultCompanyCode": "2000",
            "allowedPurchOrgs": [
                "AS01",
                "AS02"
            ],
            "defaultPurchOrg": "AS01",
            "supplierAccountGroup": "ZDOM",
            "allowedCurrencies": [
                "INR"
            ],
            "defaultCurrency": "INR",
            "allowedItemCategories": [
                "0"
            ],
            "defaultItemCategory": "0",
            "allowedAcctAssignmentCategories": [
                ""
            ],
            "defaultAcctAssignmentCategory": "",
            "materialRequired": true,
            "allowedPlantPrefix": "2"
        },
        "ZHSA": {
            "code": "ZHSA",
            "description": "High Sea Imp. PO-AIL",
            "processType": "HighSeas",
            "allowedCompanyCodes": [
                "1000"
            ],
            "defaultCompanyCode": "1000",
            "allowedPurchOrgs": [
                "AE01",
                "AE02"
            ],
            "defaultPurchOrg": "AE01",
            "supplierAccountGroup": "ZIMP",
            "allowedCurrencies": [
                "USD",
                "EUR",
                "INR",
                "GBP",
                "JPY"
            ],
            "defaultCurrency": "USD",
            "allowedItemCategories": [
                "0"
            ],
            "defaultItemCategory": "0",
            "allowedAcctAssignmentCategories": [
                ""
            ],
            "defaultAcctAssignmentCategory": "",
            "materialRequired": true,
            "allowedPlantPrefix": "1"
        },
        "ZHSS": {
            "code": "ZHSS",
            "description": "High Seas Imp ASCL",
            "processType": "HighSeas",
            "allowedCompanyCodes": [
                "1000",
                "2000"
            ],
            "defaultCompanyCode": "1000",
            "allowedPurchOrgs": [
                "AE01",
                "AE02",
                "AS01",
                "AS02"
            ],
            "defaultPurchOrg": "AE01",
            "supplierAccountGroup": "ZIMP",
            "allowedCurrencies": [
                "USD",
                "EUR",
                "INR",
                "GBP",
                "JPY"
            ],
            "defaultCurrency": "USD",
            "allowedItemCategories": [
                "0"
            ],
            "defaultItemCategory": "0",
            "allowedAcctAssignmentCategories": [
                ""
            ],
            "defaultAcctAssignmentCategory": "",
            "materialRequired": true,
            "allowedPlantPrefix": null
        },
        "ZIMP": {
            "code": "ZIMP",
            "description": "Imp.Aether In.LTD.",
            "processType": "Import",
            "allowedCompanyCodes": [
                "1000"
            ],
            "defaultCompanyCode": "1000",
            "allowedPurchOrgs": [
                "AE01",
                "AE02"
            ],
            "defaultPurchOrg": "AE01",
            "supplierAccountGroup": "ZIMP",
            "allowedCurrencies": [
                "USD",
                "EUR",
                "INR",
                "GBP",
                "JPY"
            ],
            "defaultCurrency": "USD",
            "allowedItemCategories": [
                "0"
            ],
            "defaultItemCategory": "0",
            "allowedAcctAssignmentCategories": [
                ""
            ],
            "defaultAcctAssignmentCategory": "",
            "materialRequired": true,
            "allowedPlantPrefix": "1"
        },
        "ZIMS": {
            "code": "ZIMS",
            "description": "Imp.Aether Spec.chem",
            "processType": "Import",
            "allowedCompanyCodes": [
                "2000"
            ],
            "defaultCompanyCode": "2000",
            "allowedPurchOrgs": [
                "AS02",
                "AS01"
            ],
            "defaultPurchOrg": "AS02",
            "supplierAccountGroup": "ZIMP",
            "allowedCurrencies": [
                "USD",
                "EUR",
                "INR",
                "GBP",
                "JPY"
            ],
            "defaultCurrency": "USD",
            "allowedItemCategories": [
                "0"
            ],
            "defaultItemCategory": "0",
            "allowedAcctAssignmentCategories": [
                ""
            ],
            "defaultAcctAssignmentCategory": "",
            "materialRequired": true,
            "allowedPlantPrefix": "2"
        },
        "ZINT": {
            "code": "ZINT",
            "description": "Plant to Plant TO",
            "processType": "StockTransfer",
            "allowedCompanyCodes": [
                "1000"
            ],
            "defaultCompanyCode": "1000",
            "allowedPurchOrgs": [
                "AE01",
                "AE02",
                "AE03",
                "AE04",
                "AE05"
            ],
            "defaultPurchOrg": "AE01",
            "supplierAccountGroup": "ZINT",
            "allowedCurrencies": [
                "INR"
            ],
            "defaultCurrency": "INR",
            "allowedItemCategories": [
                "7"
            ],
            "defaultItemCategory": "7",
            "allowedAcctAssignmentCategories": [
                ""
            ],
            "defaultAcctAssignmentCategory": "",
            "materialRequired": true,
            "allowedPlantPrefix": "1",
            "isStockTransfer": true
        },
        "ZLOG": {
            "code": "ZLOG",
            "description": "Logistic PO",
            "processType": "Logistics",
            "allowedCompanyCodes": [
                "1000"
            ],
            "defaultCompanyCode": "1000",
            "allowedPurchOrgs": [
                "AE01",
                "AE02",
                "AE03",
                "AE04",
                "AE05"
            ],
            "defaultPurchOrg": "AE01",
            "supplierAccountGroup": null,
            "allowedCurrencies": [
                "INR"
            ],
            "defaultCurrency": "INR",
            "allowedItemCategories": [
                "0",
                "9"
            ],
            "defaultItemCategory": "0",
            "allowedAcctAssignmentCategories": [
                "",
                "K"
            ],
            "defaultAcctAssignmentCategory": "",
            "materialRequired": true,
            "allowedPlantPrefix": "1"
        },
        "ZNVM": {
            "code": "ZNVM",
            "description": "Non-Valuated PO",
            "processType": "NonValuated",
            "allowedCompanyCodes": [
                "1000"
            ],
            "defaultCompanyCode": "1000",
            "allowedPurchOrgs": [
                "AE01",
                "AE02",
                "AE03",
                "AE04",
                "AE05"
            ],
            "defaultPurchOrg": "AE01",
            "supplierAccountGroup": null,
            "allowedCurrencies": [
                "INR"
            ],
            "defaultCurrency": "INR",
            "allowedItemCategories": [
                "0"
            ],
            "defaultItemCategory": "0",
            "allowedAcctAssignmentCategories": [
                "K"
            ],
            "defaultAcctAssignmentCategory": "K",
            "materialRequired": true,
            "allowedPlantPrefix": "1"
        },
        "ZRTV": {
            "code": "ZRTV",
            "description": "Vendor Return PO",
            "processType": "Return",
            "allowedCompanyCodes": [
                "1000",
                "2000"
            ],
            "defaultCompanyCode": "1000",
            "allowedPurchOrgs": [
                "AE01",
                "AE02",
                "AS01",
                "AS02"
            ],
            "defaultPurchOrg": "AE01",
            "supplierAccountGroup": null,
            "allowedCurrencies": [
                "INR",
                "USD",
                "EUR"
            ],
            "defaultCurrency": "INR",
            "allowedItemCategories": [
                "0"
            ],
            "defaultItemCategory": "0",
            "allowedAcctAssignmentCategories": [
                ""
            ],
            "defaultAcctAssignmentCategory": "",
            "materialRequired": true,
            "allowedPlantPrefix": null,
            "isReturn": true
        },
        "ZSER": {
            "code": "ZSER",
            "description": "Service PO",
            "processType": "Service",
            "allowedCompanyCodes": [
                "1000"
            ],
            "defaultCompanyCode": "1000",
            "allowedPurchOrgs": [
                "AE01",
                "AE02",
                "AE03",
                "AE04",
                "AE05"
            ],
            "defaultPurchOrg": "AE01",
            "supplierAccountGroup": null,
            "allowedCurrencies": [
                "INR"
            ],
            "defaultCurrency": "INR",
            "allowedItemCategories": [
                "9",
                "0"
            ],
            "defaultItemCategory": "9",
            "allowedAcctAssignmentCategories": [
                "K"
            ],
            "defaultAcctAssignmentCategory": "K",
            "materialRequired": false,
            "storageLocationRequired": false,
            "allowedPlantPrefix": "1",
            "isService": true
        },
        "ZSTO": {
            "code": "ZSTO",
            "description": "Company to Company T",
            "processType": "StockTransfer",
            "allowedCompanyCodes": [
                "1000",
                "2000"
            ],
            "defaultCompanyCode": "2000",
            "allowedPurchOrgs": [
                "AS01",
                "AS02",
                "AE01",
                "AE02"
            ],
            "defaultPurchOrg": "AS01",
            "supplierAccountGroup": "ZINT",
            "allowedCurrencies": [
                "INR"
            ],
            "defaultCurrency": "INR",
            "allowedItemCategories": [
                "7",
                "0"
            ],
            "defaultItemCategory": "7",
            "allowedAcctAssignmentCategories": [
                ""
            ],
            "defaultAcctAssignmentCategory": "",
            "materialRequired": true,
            "allowedPlantPrefix": null,
            "isStockTransfer": true
        },
        "ZSUB": {
            "code": "ZSUB",
            "description": "Subcontracting PO",
            "processType": "Subcontracting",
            "allowedCompanyCodes": [
                "1000"
            ],
            "defaultCompanyCode": "1000",
            "allowedPurchOrgs": [
                "AE01",
                "AE02",
                "AE03",
                "AE04",
                "AE05"
            ],
            "defaultPurchOrg": "AE01",
            "supplierAccountGroup": null,
            "allowedCurrencies": [
                "INR"
            ],
            "defaultCurrency": "INR",
            "allowedItemCategories": [
                "3"
            ],
            "defaultItemCategory": "3",
            "allowedAcctAssignmentCategories": [
                ""
            ],
            "defaultAcctAssignmentCategory": "",
            "materialRequired": true,
            "allowedPlantPrefix": "1",
            "isSubcontracting": true
        }
    }
};

    var PurchaseOrderRules = {
        SCHEMA: SCHEMA,

        PATTERNS: {
            CURRENCY: new RegExp(SCHEMA.patterns.currency),
            DOC_TYPE_PREFIX: new RegExp(SCHEMA.patterns.docTypePrefix)
        },

        HEADER: SCHEMA.header,
        ITEM: SCHEMA.item,
        ITEMS_LIST: SCHEMA.itemsList,
        PO_TYPES: SCHEMA.poTypes || {}
    };

    if (typeof Object.freeze === "function") {
        Object.freeze(PurchaseOrderRules);
        Object.freeze(PurchaseOrderRules.PATTERNS);
        Object.freeze(PurchaseOrderRules.HEADER);
        Object.freeze(PurchaseOrderRules.ITEM);
        Object.freeze(PurchaseOrderRules.ITEMS_LIST);
        if (PurchaseOrderRules.PO_TYPES) {
            Object.freeze(PurchaseOrderRules.PO_TYPES);
        }
    }

    return PurchaseOrderRules;
});
