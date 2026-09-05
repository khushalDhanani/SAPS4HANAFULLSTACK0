sap.ui.define([
    "sap/ui/core/format/DateFormat"
], function (DateFormat) {
    "use strict";

    return {
        formatDate: function (sDate) {
            if (!sDate) {
                return "";
            }
            if (typeof sDate === "string") {
                var aParts = sDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
                if (aParts) {
                    return aParts[3] + "-" + aParts[2] + "-" + aParts[1];
                }
                var mODataV2 = sDate.match(/\/Date\((\d+)\)\//);
                if (mODataV2) {
                    sDate = parseInt(mODataV2[1], 10);
                }
            }
            var oDate = sDate instanceof Date ? sDate : new Date(sDate);
            if (isNaN(oDate.getTime())) {
                return sDate;
            }
            var oDateFormat = DateFormat.getDateInstance({
                pattern: "dd-MM-yyyy"
            });
            return oDateFormat.format(oDate);
        },

        completenessState: function (bComplete, sDocType) {
            var bIsComplete = bComplete === true || bComplete === "true";
            if (bIsComplete) {
                return "Success";
            }
            return (sDocType && String(sDocType).trim()) ? "Information" : "Warning";
        },

        completenessIcon: function (bComplete, sDocType) {
            var bIsComplete = bComplete === true || bComplete === "true";
            if (bIsComplete) {
                return "sap-icon://accept";
            }
            return (sDocType && String(sDocType).trim()) ? "sap-icon://edit" : "sap-icon://alert";
        },

        completenessText: function (bComplete, sDocType) {
            var oResourceBundle = null;
            try {
                if (this && typeof this.getOwnerComponent === "function") {
                    var oOwner = this.getOwnerComponent();
                    if (oOwner && typeof oOwner.getModel === "function") {
                        var oModel = oOwner.getModel("i18n");
                        if (oModel && typeof oModel.getResourceBundle === "function") {
                            oResourceBundle = oModel.getResourceBundle();
                        }
                    }
                }
            } catch (e) {
                // Ignore missing resource bundle in tests or unbound contexts
            }

            var sCompleteBase = oResourceBundle ? oResourceBundle.getText("statusComplete") : "Completed";
            var sIncompleteBase = oResourceBundle ? oResourceBundle.getText("statusIncomplete") : "Incomplete";
            var bIsComplete = bComplete === true || bComplete === "true";

            if (sDocType && String(sDocType).trim()) {
                var sType = String(sDocType).trim();
                if (bIsComplete) {
                    return sCompleteBase + " (" + sType + " - Complete)";
                }
                return "In Preparation (" + sType + " - Incomplete)";
            }

            return bIsComplete ? sCompleteBase : sIncompleteBase;
        },

        docTypeDisplay: function (sDocType) {
            return sDocType || "-";
        },

        supplierDisplay: function (sName, sId) {
            if (!sName && !sId) {
                return "-";
            }
            if (!sName) {
                return String(sId);
            }
            return sName + " (" + (sId || "-") + ")";
        },

        companyDisplay: function (sCode, sName) {
            if (!sCode && !sName) {
                return "-";
            }
            return (sCode || "-") + " - " + (sName || "");
        },

        purchasingOrgDisplay: function (sOrg, sGroup) {
            if (!sOrg && !sGroup) {
                return "-";
            }
            return (sOrg || "-") + " / " + (sGroup || "-");
        },

        createdByDisplay: function (sFullName, sUserId) {
            if (!sFullName && !sUserId) {
                return "-";
            }
            if (!sFullName) {
                return String(sUserId);
            }
            if (!sUserId) {
                return sFullName;
            }
            return sFullName + " (" + sUserId + ")";
        }
    };
});
