(function () {
    "use strict";

    var CURRENCY_REGEX = /^[A-Z]{3}$/;

    // Header values SAP requires (incompletion procedure Z1 / partner ZP)
    var INCOMPLETION_HEADER_FIELDS = [
        { field: "CustomerGroup2", label: "Customer Group 2" },
        { field: "PortOfLoading", label: "Port of Loading" },
        { field: "PortOfDischarge", label: "Port of Discharge" },
        { field: "ContactPerson", label: "Contact Person" }
    ];

    var NO_CAPABILITIES = {
        CustomerGroup2: false,
        PortOfLoading: false,
        PortOfDischarge: false,
        ContactPerson: false,
        Plant: false
    };

    var oValidator = {
        CURRENCY_REGEX: CURRENCY_REGEX,
        INCOMPLETION_HEADER_FIELDS: INCOMPLETION_HEADER_FIELDS,
        NO_CAPABILITIES: NO_CAPABILITIES,

        setFieldValidation: function (oModel, sField, sState, sText) {
            if (!oModel) return;
            oModel.setProperty("/errors/" + sField, {
                state: sState || "None",
                text: sText || ""
            });
        },

        applyCapabilities: function (oModel, oCaps) {
            if (!oModel) return;
            var oMerged = Object.assign({}, NO_CAPABILITIES, oCaps || {});
            oModel.setProperty("/capabilities", oMerged);

            var aUnsupported = INCOMPLETION_HEADER_FIELDS.filter(function (f) {
                return !oMerged[f.field];
            }).map(function (f) {
                return f.label;
            });
            if (!oMerged.Plant) aUnsupported.push("Plant");
            var sNotice = aUnsupported.length === 0 ? "" :
                "SAP requires Customer Group 2, Port of Loading, Port of Discharge, a Contact Person and a Plant. " +
                "The SAP inquiry service does not yet accept: " + aUnsupported.join(", ") + ". Maintain these directly in SAP after creation.";
            oModel.setProperty("/readinessNotice", sNotice);
            oModel.setProperty("/showReadinessNotice", sNotice !== "");
        },

        getIncompletionGaps: function (oModel) {
            if (!oModel) return [];
            var oHeader = oModel.getProperty("/header") || {};
            var aItems = oModel.getProperty("/items") || [];
            var oCaps = oModel.getProperty("/capabilities") || NO_CAPABILITIES;
            var aGaps = [];

            var sHint = function (bSupported) {
                return bSupported ? "Required by SAP" : "Required by SAP; not yet supported by the SAP inquiry service, maintain directly in SAP after creation";
            };

            INCOMPLETION_HEADER_FIELDS.forEach(function (f) {
                if (!oHeader[f.field] || String(oHeader[f.field]).trim() === "") {
                    aGaps.push({ type: "Warning", title: f.label + " is missing", subtitle: sHint(oCaps[f.field]), field: f.field });
                }
            });
            aItems.forEach(function (item, idx) {
                if (!item.Plant || String(item.Plant).trim() === "") {
                    aGaps.push({ type: "Warning", title: "Plant is missing", subtitle: "Item " + (idx + 1) + ": " + sHint(oCaps.Plant), field: "Plant", itemIndex: idx });
                }
            });

            oModel.setProperty("/readinessGaps", aGaps);
            return aGaps;
        },

        updateStatus: function (oModel) {
            if (!oModel) return;
            var oHeader = oModel.getProperty("/header") || {};
            var aItems = oModel.getProperty("/items") || [];

            var bHasHeader = Boolean(
                oHeader.SalesInquiryType &&
                oHeader.SalesOrganization &&
                oHeader.DistributionChannel &&
                oHeader.OrganizationDivision &&
                oHeader.SoldToParty
            );

            var bHasItems = aItems.length > 0 && aItems.every(function (item) {
                return Boolean(item.Material && parseFloat(item.OrderQuantity) > 0 && item.OrderQuantityUnit);
            });

            if (bHasHeader && bHasItems) {
                oModel.setProperty("/header/StatusText", "Ready to Create");
                oModel.setProperty("/header/StatusState", "Success");
                oModel.setProperty("/header/StatusIcon", "sap-icon://accept");
            } else {
                oModel.setProperty("/header/StatusText", "Draft");
                oModel.setProperty("/header/StatusState", "Information");
                oModel.setProperty("/header/StatusIcon", "sap-icon://edit");
            }
        },

        validateForm: function (oModel) {
            if (!oModel) return false;
            var oHeader = oModel.getProperty("/header") || {};
            var aItems = oModel.getProperty("/items") || [];
            var oErrors = {};
            var aErrorList = [];
            var iErrorCount = 0;
            var sFirstError = "";

            function addError(sField, sMsg, sSubtitle) {
                oErrors[sField] = { state: "Error", text: sMsg };
                iErrorCount++;
                if (!sFirstError) sFirstError = sMsg;
                aErrorList.push({
                    type: "Error",
                    title: sMsg,
                    subtitle: sSubtitle || ("Header: " + sField),
                    field: sField
                });
            }

            // Header validations
            if (!oHeader.SalesInquiryType || String(oHeader.SalesInquiryType).trim() === "") {
                addError("SalesInquiryType", "Inquiry Type is mandatory");
            }
            if (!oHeader.SalesOrganization || String(oHeader.SalesOrganization).trim() === "") {
                addError("SalesOrganization", "Sales Organization is mandatory");
            }
            if (!oHeader.DistributionChannel || String(oHeader.DistributionChannel).trim() === "") {
                addError("DistributionChannel", "Distribution Channel is mandatory");
            }
            if (!oHeader.OrganizationDivision || String(oHeader.OrganizationDivision).trim() === "") {
                addError("OrganizationDivision", "Division is mandatory");
            }
            if (!oHeader.SoldToParty || String(oHeader.SoldToParty).trim() === "") {
                addError("SoldToParty", "Sold-to Party is mandatory");
            }
            if (!oHeader.TransactionCurrency || !CURRENCY_REGEX.test(String(oHeader.TransactionCurrency).trim())) {
                addError("TransactionCurrency", "Currency must be a valid 3-letter ISO code (e.g. INR, USD)");
            }

            // Incompletion-required fields are mandatory whenever the SAP inquiry service can accept them
            var oCaps = oModel.getProperty("/capabilities") || NO_CAPABILITIES;
            INCOMPLETION_HEADER_FIELDS.forEach(function (f) {
                if (oCaps[f.field] && (!oHeader[f.field] || String(oHeader[f.field]).trim() === "")) {
                    addError(f.field, f.label + " is required by SAP");
                }
            });

            // Date validation
            if (oHeader.BindingPeriodValidityStartDate && oHeader.BindingPeriodValidityEndDate) {
                var dStart = new Date(oHeader.BindingPeriodValidityStartDate);
                var dEnd = new Date(oHeader.BindingPeriodValidityEndDate);
                if (dEnd < dStart) {
                    addError("BindingPeriodValidityEndDate", "Validity End Date cannot be earlier than Validity Start Date");
                }
            }

            // Items validation
            if (aItems.length === 0) {
                addError("items", "At least one item must be added to the inquiry", "Items Table");
            } else {
                aItems.forEach(function (item, idx) {
                    item.errors = {};
                    if (!item.Material || String(item.Material).trim() === "") {
                        item.errors.Material = { state: "Error", text: "Material is required" };
                        iErrorCount++;
                        var msg = "Item " + (idx + 1) + ": Material is required";
                        if (!sFirstError) sFirstError = msg;
                        aErrorList.push({ type: "Error", title: "Material is required", subtitle: "Item " + (idx + 1) + ": Material", field: "Material", itemIndex: idx });
                    }
                    var q = parseFloat(item.OrderQuantity);
                    if (isNaN(q) || q <= 0) {
                        item.errors.OrderQuantity = { state: "Error", text: "Quantity must be > 0" };
                        iErrorCount++;
                        var msg = "Item " + (idx + 1) + ": Quantity must be > 0";
                        if (!sFirstError) sFirstError = msg;
                        aErrorList.push({ type: "Error", title: "Quantity must be > 0", subtitle: "Item " + (idx + 1) + ": OrderQuantity", field: "OrderQuantity", itemIndex: idx });
                    }
                    if (!item.OrderQuantityUnit || String(item.OrderQuantityUnit).trim() === "") {
                        item.errors.OrderQuantityUnit = { state: "Error", text: "Unit is required" };
                        iErrorCount++;
                        var msg = "Item " + (idx + 1) + ": Unit is required";
                        if (!sFirstError) sFirstError = msg;
                        aErrorList.push({ type: "Error", title: "Unit is required", subtitle: "Item " + (idx + 1) + ": OrderQuantityUnit", field: "OrderQuantityUnit", itemIndex: idx });
                    }
                    if (oCaps.Plant && (!item.Plant || String(item.Plant).trim() === "")) {
                        item.errors.Plant = { state: "Error", text: "Plant is required by SAP" };
                        iErrorCount++;
                        var msgPlant = "Item " + (idx + 1) + ": Plant is required by SAP";
                        if (!sFirstError) sFirstError = msgPlant;
                        aErrorList.push({ type: "Error", title: "Plant is required by SAP", subtitle: "Item " + (idx + 1) + ": Plant", field: "Plant", itemIndex: idx });
                    } else if (item.Plant && String(item.Plant).trim().length > 4) {
                        item.errors.Plant = { state: "Error", text: "Plant cannot exceed 4 characters" };
                        iErrorCount++;
                        var msgPlantLen = "Item " + (idx + 1) + ": Plant cannot exceed 4 characters";
                        if (!sFirstError) sFirstError = msgPlantLen;
                        aErrorList.push({ type: "Error", title: "Plant cannot exceed 4 characters", subtitle: "Item " + (idx + 1) + ": Plant", field: "Plant", itemIndex: idx });
                    }
                });
                oModel.setProperty("/items", aItems);
            }

            oModel.setProperty("/errors", oErrors);
            oModel.setProperty("/errorList", aErrorList);
            oModel.setProperty("/errorCount", iErrorCount);
            oModel.setProperty("/errorMessage", sFirstError);
            oModel.setProperty("/hasError", iErrorCount > 0);

            return iErrorCount === 0;
        },

        validateSingleField: function (oModel, sField) {
            if (!oModel || !sField) return;
            var val = oModel.getProperty("/header/" + sField);

            if (!val || String(val).trim() === "") {
                this.setFieldValidation(oModel, sField, "Error", sField + " is mandatory");
            } else if (sField === "TransactionCurrency" && !CURRENCY_REGEX.test(String(val).trim())) {
                this.setFieldValidation(oModel, sField, "Error", "Currency must be 3-letter ISO code");
            } else {
                this.setFieldValidation(oModel, sField, "None", "");
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
