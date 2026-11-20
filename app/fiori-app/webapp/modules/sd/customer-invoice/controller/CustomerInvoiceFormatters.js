sap.ui.define([], function () {
    "use strict";

    function createCustomerInvoiceFormatters() {
        return {
            formatInvoiceStatusText: function (bIsCancelled, sAccountingStatus, sCategory) {
                if (bIsCancelled === true || bIsCancelled === "true" || sAccountingStatus === "E" || sCategory === "N") {
                    return this._getText("statusCancelled");
                }
                if (sAccountingStatus === "C" || sAccountingStatus === "H") {
                    return this._getText("statusTransferredToAccounting");
                }
                if (sAccountingStatus === "D") {
                    return this._getText("statusNotRelevantForAccounting");
                }
                if (sAccountingStatus === "B") {
                    return this._getText("statusAccountDeterminationError");
                }
                if (sAccountingStatus === "A") {
                    return this._getText("statusPostingBlocked");
                }
                if (!sAccountingStatus || sAccountingStatus === "") {
                    return this._getText("statusAccountingInterfaceError");
                }
                return this._getText("statusPostingError");
            },

            formatInvoiceStatusState: function (bIsCancelled, sAccountingStatus, sCategory) {
                if (bIsCancelled === true || bIsCancelled === "true" || sAccountingStatus === "E" || sCategory === "N") {
                    return "Error";
                }
                if (sAccountingStatus === "C" || sAccountingStatus === "H") {
                    return "Success";
                }
                if (sAccountingStatus === "D") {
                    return "None";
                }
                if (sAccountingStatus === "A") {
                    return "Warning";
                }
                return "Error";
            },

            formatInvoiceStatusIcon: function (bIsCancelled, sAccountingStatus, sCategory) {
                if (bIsCancelled === true || bIsCancelled === "true" || sAccountingStatus === "E" || sCategory === "N") {
                    return "sap-icon://sys-cancel";
                }
                if (sAccountingStatus === "C" || sAccountingStatus === "H") {
                    return "sap-icon://accept";
                }
                if (sAccountingStatus === "D") {
                    return "sap-icon://document-text";
                }
                if (sAccountingStatus === "A") {
                    return "sap-icon://locked";
                }
                return "sap-icon://alert";
            }
        };
    }

    var isNode = typeof module !== "undefined" && module.exports;
    var oExports = {
        createCustomerInvoiceFormatters: createCustomerInvoiceFormatters
    };

    if (isNode) {
        module.exports = oExports;
    }
    return oExports;
});
