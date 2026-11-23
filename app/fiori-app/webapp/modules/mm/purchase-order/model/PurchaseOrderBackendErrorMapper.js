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

    var DEFAULT_HEADER_FIELD_CONFIG = {
        PurchaseOrderType: { controlId: "inDocType", label: "Document Type", section: "General Data", example: "ZDOM" },
        CompanyCode: { controlId: "inCompanyCode", label: "Company Code", section: "General Data", example: "1010" },
        PurchasingOrganization: { controlId: "inPurchOrg", label: "Purchasing Organization", section: "General Data", example: "1010" },
        PurchasingGroup: { controlId: "inPurchGrp", label: "Purchasing Group", section: "General Data", example: "101" },
        DocumentDate: { controlId: "inDocDate", label: "Document Date", section: "General Data", example: "DD-MM-YYYY" },
        Supplier: { controlId: "inSupplier", label: "Supplier", section: "Supplier & Commercial Terms", example: "10300001" },
        Currency: { controlId: "inCurrency", label: "Currency", section: "Supplier & Commercial Terms", example: "EUR" },
        IncotermsClassification: { controlId: "inIncoterms", label: "Incoterms", section: "Supplier & Commercial Terms", example: "EXW" },
        IncotermsLocation1: { controlId: "inIncotermsLoc", label: "Incoterms Location 1", section: "Supplier & Commercial Terms", example: "MUMBAI" },
        PaymentTerms: { controlId: "inPaymentTerms", label: "Payment Terms", section: "Supplier & Commercial Terms", example: "0001" }
    };

    var DEFAULT_ITEM_FIELD_CONFIG = {
        Plant: { cellIndex: 3, label: "Plant", example: "1010" },
        StorageLocation: { cellIndex: 4, label: "Storage Location", example: "101A" },
        Material: { cellIndex: 5, label: "Material", example: "TG11" },
        PurchaseOrderItemText: { cellIndex: 6, label: "Description", example: "Polypropylene Resin" },
        OrderQuantity: { cellIndex: 7, label: "Quantity", example: "10" },
        UnitOfMeasure: { cellIndex: 8, label: "Unit of Measure", example: "PC" },
        NetPriceAmount: { cellIndex: 9, label: "Net Price", example: "100.00" },
        TaxCode: { cellIndex: 10, label: "Tax Code", example: "V1" }
    };

    var HEADER_TARGETS = {
        "header.purchaseordertype": "PurchaseOrderType",
        "purchaseordertype": "PurchaseOrderType",
        "doctype": "PurchaseOrderType",
        "header.companycode": "CompanyCode",
        "companycode": "CompanyCode",
        "header.purchasingorganization": "PurchasingOrganization",
        "purchasingorganization": "PurchasingOrganization",
        "purchasingorg": "PurchasingOrganization",
        "header.purchasinggroup": "PurchasingGroup",
        "purchasinggroup": "PurchasingGroup",
        "purchgroup": "PurchasingGroup",
        "header.supplier": "Supplier",
        "supplier": "Supplier",
        "vendor": "Supplier",
        "header.currency": "Currency",
        "currency": "Currency",
        "header.documentdate": "DocumentDate",
        "documentdate": "DocumentDate",
        "header.paymentterms": "PaymentTerms",
        "paymentterms": "PaymentTerms",
        "header.incotermsclassification": "IncotermsClassification",
        "incotermsclassification": "IncotermsClassification",
        "incoterms": "IncotermsClassification",
        "header.incotermslocation1": "IncotermsLocation1",
        "incotermslocation1": "IncotermsLocation1"
    };

    var ITEM_TARGETS = {
        "material": "Material",
        "plant": "Plant",
        "storagelocation": "StorageLocation",
        "orderquantity": "OrderQuantity",
        "quantity": "OrderQuantity",
        "unitofmeasure": "UnitOfMeasure",
        "uom": "UnitOfMeasure",
        "netpriceamount": "NetPriceAmount",
        "netprice": "NetPriceAmount",
        "taxcode": "TaxCode"
    };

    var PurchaseOrderBackendErrorMapper = {
        DEFAULT_HEADER_FIELD_CONFIG: DEFAULT_HEADER_FIELD_CONFIG,
        DEFAULT_ITEM_FIELD_CONFIG: DEFAULT_ITEM_FIELD_CONFIG,
        HEADER_TARGETS: HEADER_TARGETS,
        ITEM_TARGETS: ITEM_TARGETS,

        /**
         * Maps backend SAP Gateway or CAP OData errors into UI model error states and errorList.
         *
         * @param {sap.ui.model.json.JSONModel|Object} oModel - Target model or data object
         * @param {Object} oError - Backend error object with optional details array
         * @param {Function} [fnTextResolver] - Translation function (sKey, aArgs, sFallback)
         * @param {Object} [mHeaderConfig] - Optional header field configuration override
         * @param {Object} [mItemConfig] - Optional item field configuration override
         * @returns {{ errorCount: number, errorList: Array, errorMessage: string }}
         */
        applyBackendErrors: function (oModel, oError, fnTextResolver, mHeaderConfig, mItemConfig) {
            if (!oModel) return { errorCount: 0, errorList: [], errorMessage: "" };
            var fnResolve = fnTextResolver || function (key, args, fallback) { return fallback || key; };
            var mHeaderFieldConfig = mHeaderConfig || DEFAULT_HEADER_FIELD_CONFIG;
            var mItemFieldConfig = mItemConfig || DEFAULT_ITEM_FIELD_CONFIG;

            var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
            var aErrorList = [];
            var sMainMessage = (oError && oError.message) || "Backend operation failed.";
            var aDetails = (oError && oError.details) || [];
            var iStatus = (oError && oError.status) || 500;

            var oHeaderErrors = oData.errors || {
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
            };
            var aItems = oData.items || [];

            if (aDetails.length > 0) {
                aDetails.forEach(function (detail) {
                    var sDetailMsg = detail.message || sMainMessage;
                    var sTarget = String(detail.target || "").toLowerCase();
                    var sCode = detail.code || "";
                    var sControlId = null;
                    var iItemIdx = -1;
                    var sItemField = null;

                    // Match header target
                    for (var k in HEADER_TARGETS) {
                        if (sTarget === k || sTarget.endsWith("." + k) || sTarget.endsWith("/" + k)) {
                            var sFieldKey = HEADER_TARGETS[k];
                            oHeaderErrors[sFieldKey] = { state: "Error", text: sDetailMsg };
                            sControlId = mHeaderFieldConfig[sFieldKey] ? mHeaderFieldConfig[sFieldKey].controlId : null;
                            break;
                        }
                    }

                    // Match item target (e.g. items[0].Plant or Plant)
                    if (!sControlId) {
                        var oItemMatch = sTarget.match(/items\[(\d+)\]\.?(\w+)?/);
                        if (oItemMatch) {
                            iItemIdx = parseInt(oItemMatch[1], 10);
                            var sTargetField = (oItemMatch[2] || "").toLowerCase();
                            sItemField = ITEM_TARGETS[sTargetField] || null;
                        } else {
                            for (var it in ITEM_TARGETS) {
                                if (sTarget === it || sTarget.endsWith("." + it)) {
                                    sItemField = ITEM_TARGETS[it];
                                    iItemIdx = 0;
                                    break;
                                }
                            }
                        }

                        if (sItemField && aItems[iItemIdx]) {
                            aItems[iItemIdx].errors = aItems[iItemIdx].errors || {};
                            aItems[iItemIdx].errors[sItemField] = { state: "Error", text: sDetailMsg };
                            sControlId = "poItemsTable";
                        }
                    }

                    aErrorList.push({
                        type: "Error",
                        title: sDetailMsg,
                        field: sCode ? ("SAP (" + sCode + ")") : (detail.target || "S/4HANA Error"),
                        description: (detail.description || sDetailMsg) + (sCode ? (" [Code: " + sCode + "]") : ""),
                        controlId: sControlId,
                        itemIndex: iItemIdx >= 0 ? iItemIdx : undefined,
                        cellIndex: sItemField && mItemFieldConfig[sItemField] ? mItemFieldConfig[sItemField].cellIndex : undefined
                    });
                });
            } else if (sMainMessage.indexOf(";") !== -1) {
                var aParts = sMainMessage.split(";").map(function (s) { return s.trim(); }).filter(Boolean);
                aParts.forEach(function (sPart) {
                    var sLower = sPart.toLowerCase();
                    var sControlId = null;

                    for (var k in HEADER_TARGETS) {
                        if (sLower.indexOf(k) !== -1) {
                            var sFieldKey = HEADER_TARGETS[k];
                            oHeaderErrors[sFieldKey] = { state: "Error", text: sPart };
                            sControlId = mHeaderFieldConfig[sFieldKey] ? mHeaderFieldConfig[sFieldKey].controlId : null;
                            break;
                        }
                    }

                    if (!sControlId) {
                        for (var it in ITEM_TARGETS) {
                            if (sLower.indexOf(it) !== -1) {
                                var sItemField = ITEM_TARGETS[it];
                                if (aItems[0]) {
                                    aItems[0].errors = aItems[0].errors || {};
                                    aItems[0].errors[sItemField] = { state: "Error", text: sPart };
                                    sControlId = "poItemsTable";
                                }
                                break;
                            }
                        }
                    }

                    aErrorList.push({
                        type: "Error",
                        title: sPart,
                        field: sControlId ? "Validation" : ("SAP Backend (HTTP " + iStatus + ")"),
                        description: sPart,
                        controlId: sControlId
                    });
                });
            } else {
                var sLower = sMainMessage.toLowerCase();
                var sControlId = null;
                for (var hk in HEADER_TARGETS) {
                    if (sLower.indexOf(hk) !== -1) {
                        var sFieldKey = HEADER_TARGETS[hk];
                        oHeaderErrors[sFieldKey] = { state: "Error", text: sMainMessage };
                        sControlId = mHeaderFieldConfig[sFieldKey] ? mHeaderFieldConfig[sFieldKey].controlId : null;
                        break;
                    }
                }
                aErrorList.push({
                    type: "Error",
                    title: sMainMessage,
                    field: "SAP Backend (HTTP " + iStatus + ")",
                    description: (oError && oError.code ? ("Error code: " + oError.code + ". ") : "") + sMainMessage,
                    controlId: sControlId
                });
            }

            var sSummary = aErrorList.length === 1
                ? aErrorList[0].title
                : fnResolve("poValBackendErrorsSummary", [aErrorList.length], aErrorList.length + " errors returned by backend. Please review and resolve.");

            if (typeof oModel.setProperty === "function") {
                oModel.setProperty("/errors", oHeaderErrors);
                oModel.setProperty("/items", aItems);
                oModel.setProperty("/hasError", true);
                oModel.setProperty("/errorMessage", sSummary);
                oModel.setProperty("/errorCount", aErrorList.length);
                oModel.setProperty("/errorList", aErrorList);
            } else {
                oData.errors = oHeaderErrors;
                oData.items = aItems;
                oData.hasError = true;
                oData.errorMessage = sSummary;
                oData.errorCount = aErrorList.length;
                oData.errorList = aErrorList;
            }

            return {
                errorCount: aErrorList.length,
                errorList: aErrorList,
                errorMessage: sSummary
            };
        }
    };

    return PurchaseOrderBackendErrorMapper;
});
