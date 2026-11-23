(function () {
    "use strict";

    var CURRENCY_REGEX = /^[A-Z]{3}$/;
    var CONTACT_PERSON_REGEX = /^\d{1,10}$/;

    var INCOMPLETION_HEADER_FIELDS = [
        { field: "PaymentTerms", label: "Payment Terms" },
        { field: "ContactPerson", label: "Contact Person" }
    ];

    var oValidator = {
        CURRENCY_REGEX: CURRENCY_REGEX,
        CONTACT_PERSON_REGEX: CONTACT_PERSON_REGEX,
        INCOMPLETION_HEADER_FIELDS: INCOMPLETION_HEADER_FIELDS,

        validateSingleField: function (oModel, sField) {
            if (!oModel) return true;
            var oHeader = oModel.getProperty("/header") || {};
            var vVal = oHeader[sField];
            var sError = "";

            switch (sField) {
                case "SalesOrderType":
                    if (!vVal || String(vVal).trim() === "") {
                        sError = "Order Type is required";
                    } else if (String(vVal).trim().length > 4) {
                        sError = "Order Type cannot exceed 4 characters";
                    }
                    break;
                case "SalesOrganization":
                    if (!vVal || String(vVal).trim() === "") {
                        sError = "Sales Organization is required";
                    } else if (String(vVal).trim().length > 4) {
                        sError = "Sales Organization cannot exceed 4 characters";
                    }
                    break;
                case "DistributionChannel":
                    if (!vVal || String(vVal).trim() === "") {
                        sError = "Distribution Channel is required";
                    } else if (String(vVal).trim().length > 2) {
                        sError = "Distribution Channel cannot exceed 2 characters";
                    }
                    break;
                case "OrganizationDivision":
                    if (!vVal || String(vVal).trim() === "") {
                        sError = "Division is required";
                    } else if (String(vVal).trim().length > 2) {
                        sError = "Division cannot exceed 2 characters";
                    }
                    break;
                case "SoldToParty":
                    if (!vVal || String(vVal).trim() === "") {
                        sError = "Sold-to Party (Customer) is required";
                    } else if (String(vVal).trim().length > 10) {
                        sError = "Sold-to Party cannot exceed 10 characters";
                    } else {
                        var oCurrentErr = oModel.getProperty("/errors/SoldToParty");
                        if (oCurrentErr && oCurrentErr.state === "Error" && oCurrentErr.text && oCurrentErr.text.indexOf("not maintained") !== -1) {
                            sError = oCurrentErr.text;
                        }
                    }
                    break;
                case "TransactionCurrency":
                    if (!vVal || String(vVal).trim() === "") {
                        sError = "Currency is required";
                    } else if (!CURRENCY_REGEX.test(String(vVal).trim().toUpperCase())) {
                        sError = "Currency must be a valid 3-character ISO code (e.g. INR, USD)";
                    }
                    break;
                case "PurchaseOrderNumber":
                case "PurchaseOrderByCustomer":
                    if (vVal && String(vVal).trim().length > 35) {
                        sError = "PO Reference cannot exceed 35 characters";
                    }
                    break;
                case "RequestedDeliveryDate":
                    if (vVal) {
                        var dReq = new Date(vVal);
                        if (isNaN(dReq.getTime())) {
                            sError = "Requested Delivery Date must be a valid date";
                        }
                    }
                    break;
                case "PaymentTerms":
                    if (!vVal || String(vVal).trim() === "") {
                        sError = "Payment Terms are required";
                    } else if (String(vVal).trim().length > 4) {
                        sError = "Payment Terms cannot exceed 4 characters";
                    }
                    break;
                case "ContactPerson":
                    if (!vVal || String(vVal).trim() === "") {
                        sError = "Contact Person is required";
                    } else if (!CONTACT_PERSON_REGEX.test(String(vVal).trim())) {
                        sError = "Contact Person must be a numeric SAP contact number (up to 10 digits)";
                    }
                    break;
                case "Incoterms":
                case "INCO1":
                    if (vVal && String(vVal).trim().length > 3) {
                        sError = "Incoterms cannot exceed 3 characters";
                    }
                    break;
                case "IncotermsLocation1":
                case "INCO2":
                case "INCO2_L":
                    if (vVal && String(vVal).trim().length > 70) {
                        sError = "Incoterms Location cannot exceed 70 characters";
                    }
                    break;
                default:
                    break;
            }

            var oFieldState = sError ? { state: "Error", text: sError } : { state: "None", text: "" };
            oModel.setProperty("/errors/" + sField, oFieldState);
            return !sError;
        },

        validateForm: function (oModel) {
            if (!oModel) return false;
            var oHeader = oModel.getProperty("/header") || {};
            var aItems = oModel.getProperty("/items") || [];
            var aErrors = [];

            var aRequiredHeaderFields = [
                "SalesOrderType",
                "SalesOrganization",
                "DistributionChannel",
                "OrganizationDivision",
                "SoldToParty",
                "TransactionCurrency",
                "PaymentTerms",
                "ContactPerson"
            ];

            var that = this;
            aRequiredHeaderFields.forEach(function (sField) {
                var bValid = that.validateSingleField(oModel, sField);
                if (!bValid) {
                    var sText = oModel.getProperty("/errors/" + sField + "/text");
                    aErrors.push({ field: sField, message: sText });
                }
            });

            if (oHeader.PurchaseOrderNumber && String(oHeader.PurchaseOrderNumber).trim().length > 35) {
                aErrors.push({ field: "PurchaseOrderNumber", message: "PO Reference cannot exceed 35 characters" });
            }
            if (oHeader.RequestedDeliveryDate) {
                var dReq = new Date(oHeader.RequestedDeliveryDate);
                if (isNaN(dReq.getTime())) {
                    aErrors.push({ field: "RequestedDeliveryDate", message: "Requested Delivery Date must be a valid date" });
                }
            }

            if (!aItems || aItems.length === 0) {
                aErrors.push({ field: "items", message: "At least one order line item is required" });
            } else {
                aItems.forEach(function (oItem, idx) {
                    oItem.errors = oItem.errors || {};
                    var sItemLabel = "Item " + (idx + 1) + " (" + (oItem.SalesOrderItem || ((idx + 1) * 10)) + ")";

                    if (!oItem.Material || String(oItem.Material).trim() === "") {
                        oItem.errors.Material = { state: "Error", text: "Material is required" };
                        aErrors.push({ field: "Material", itemIndex: idx, message: sItemLabel + ": Material is required" });
                    } else {
                        oItem.errors.Material = { state: "None", text: "" };
                    }

                    var nQty = parseFloat(oItem.OrderQuantity);
                    if (oItem.OrderQuantity === undefined || oItem.OrderQuantity === null || isNaN(nQty) || nQty <= 0) {
                        oItem.errors.OrderQuantity = { state: "Error", text: "Quantity must be greater than 0" };
                        aErrors.push({ field: "OrderQuantity", itemIndex: idx, message: sItemLabel + ": Quantity must be greater than 0" });
                    } else {
                        oItem.errors.OrderQuantity = { state: "None", text: "" };
                    }

                    if (!oItem.OrderQuantityUnit || String(oItem.OrderQuantityUnit).trim() === "") {
                        oItem.errors.OrderQuantityUnit = { state: "Error", text: "Unit of measure is required" };
                        aErrors.push({ field: "OrderQuantityUnit", itemIndex: idx, message: sItemLabel + ": Unit of measure is required" });
                    } else {
                        oItem.errors.OrderQuantityUnit = { state: "None", text: "" };
                    }

                    if (!oItem.Plant || String(oItem.Plant).trim() === "") {
                        oItem.errors.Plant = { state: "Error", text: "Plant is required" };
                        aErrors.push({ field: "Plant", itemIndex: idx, message: sItemLabel + ": Plant is required" });
                    } else if (String(oItem.Plant).trim().length > 4) {
                        oItem.errors.Plant = { state: "Error", text: "Plant cannot exceed 4 characters" };
                        aErrors.push({ field: "Plant", itemIndex: idx, message: sItemLabel + ": Plant cannot exceed 4 characters" });
                    } else {
                        oItem.errors.Plant = { state: "None", text: "" };
                    }
                });
                oModel.setProperty("/items", aItems);
            }

            var bIsValid = aErrors.length === 0;
            oModel.setProperty("/errorList", aErrors);
            oModel.setProperty("/errorCount", aErrors.length);
            oModel.setProperty("/hasError", !bIsValid);
            oModel.setProperty("/errorMessage", bIsValid ? "" : aErrors[0].message);

            this.updateStatus(oModel);
            return bIsValid;
        },

        getIncompletionGaps: function (oModel) {
            if (!oModel) return [];
            var oHeader = oModel.getProperty("/header") || {};
            var aGaps = [];

            INCOMPLETION_HEADER_FIELDS.forEach(function (f) {
                if (!oHeader[f.field] || String(oHeader[f.field]).trim() === "") {
                    aGaps.push(f.label);
                }
            });

            return aGaps;
        },

        updateStatus: function (oModel) {
            if (!oModel) return;
            var iErrors = oModel.getProperty("/errorCount") || 0;
            var oHeader = oModel.getProperty("/header") || {};

            if (iErrors > 0) {
                oModel.setProperty("/header/StatusText", "Incomplete (" + iErrors + " issues)");
                oModel.setProperty("/header/StatusState", "Error");
                oModel.setProperty("/header/StatusIcon", "sap-icon://error");
            } else if (!oHeader.SoldToParty) {
                oModel.setProperty("/header/StatusText", "Draft (No Customer)");
                oModel.setProperty("/header/StatusState", "Warning");
                oModel.setProperty("/header/StatusIcon", "sap-icon://in-progress");
            } else {
                oModel.setProperty("/header/StatusText", "Ready to Submit");
                oModel.setProperty("/header/StatusState", "Success");
                oModel.setProperty("/header/StatusIcon", "sap-icon://sys-enter-2");
            }
        },

        clearErrors: function (oModel) {
            if (!oModel) return;
            oModel.setProperty("/errors", {});
            oModel.setProperty("/errorList", []);
            oModel.setProperty("/errorCount", 0);
            oModel.setProperty("/errorMessage", "");
            oModel.setProperty("/hasError", false);

            var aItems = oModel.getProperty("/items") || [];
            aItems.forEach(function (item) {
                item.errors = {};
            });
            oModel.setProperty("/items", aItems);
        }
    };

    var isNode = typeof module !== "undefined" && module.exports;
    if (isNode) {
        module.exports = oValidator;
    }
    if (!isNode && typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function") {
        sap.ui.define([], function () {
            return oValidator;
        });
    }
})();
