// AUTO-GENERATED from config/schema/purchaseOrderRules.json - DO NOT EDIT MANUALLY
// Generated on: 2026-09-24T11:42:00.159Z
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
        ITEMS_LIST: SCHEMA.itemsList
    };

    if (typeof Object.freeze === "function") {
        Object.freeze(PurchaseOrderRules);
        Object.freeze(PurchaseOrderRules.PATTERNS);
        Object.freeze(PurchaseOrderRules.HEADER);
        Object.freeze(PurchaseOrderRules.ITEM);
        Object.freeze(PurchaseOrderRules.ITEMS_LIST);
    }

    return PurchaseOrderRules;
});
