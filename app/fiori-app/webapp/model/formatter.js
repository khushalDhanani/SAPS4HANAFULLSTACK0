sap.ui.define([
    "sap/ui/core/format/DateFormat"
], function (DateFormat) {
    "use strict";

    return {
        formatDate: function (sDate) {
            if (!sDate) {
                return "";
            }
            var oDate = new Date(sDate);
            if (isNaN(oDate.getTime())) {
                return sDate;
            }
            var oDateFormat = DateFormat.getDateInstance({
                pattern: "yyyy-MM-dd"
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
        }
    };
});
