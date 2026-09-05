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

        completenessState: function (bComplete) {
            return bComplete ? "Success" : "Warning";
        },

        completenessIcon: function (bComplete) {
            return bComplete ? "sap-icon://accept" : "sap-icon://alert";
        },

        completenessText: function (bComplete) {
            var oResourceBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
            return bComplete ? oResourceBundle.getText("statusComplete") : oResourceBundle.getText("statusIncomplete");
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
        }
    };
});
