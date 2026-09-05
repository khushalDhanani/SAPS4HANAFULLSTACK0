sap.ui.define([
    "sap/ui/core/format/NumberFormat",
    "sap/ui/core/format/DateFormat"
], function (NumberFormat, DateFormat) {
    "use strict";

    return {
        /**
         * Formats Debit/Credit code into localized string.
         * @public
         * @param {string} sCode Debit/Credit Code ("S" or "H")
         * @returns {string} Formatted text
         */
        formatDebitCredit: function (sCode) {
            var oResourceBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
            if (sCode === "S") {
                return oResourceBundle.getText("fiStatusDebit");
            } else if (sCode === "H") {
                return oResourceBundle.getText("fiStatusCredit");
            }
            return sCode;
        },

        /**
         * Returns semantic state for Debit/Credit.
         * @public
         * @param {string} sCode Debit/Credit Code ("S" or "H")
         * @returns {string} sap.ui.core.ValueState
         */
        debitCreditState: function (sCode) {
            if (sCode === "S") {
                return "Success"; // Debit
            } else if (sCode === "H") {
                return "Error";   // Credit
            }
            return "None";
        },

        /**
         * Formats a number/string amount to currency format.
         * @public
         * @param {number|string} vAmount The amount
         * @returns {string} Formatted amount
         */
        formatAmount: function (vAmount) {
            if (!vAmount) {
                return "0.00";
            }
            var oCurrencyFormat = NumberFormat.getCurrencyInstance({
                currencyCode: false
            });
            return oCurrencyFormat.format(vAmount);
        },

        /**
         * Formats a date object or string into short date string.
         * @public
         * @param {Date|string} vDate The date
         * @returns {string} Formatted date
         */
        formatDate: function (vDate) {
            if (!vDate) {
                return "";
            }
            var oDate = vDate instanceof Date ? vDate : new Date(vDate);
            var oDateFormat = DateFormat.getDateInstance({
                style: "medium"
            });
            return oDateFormat.format(oDate);
        }
    };
});
