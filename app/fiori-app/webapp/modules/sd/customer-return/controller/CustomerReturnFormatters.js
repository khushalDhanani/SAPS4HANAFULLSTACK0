sap.ui.define([], function () {
    "use strict";

    function createCustomerReturnFormatters() {
        return {
            formatReasonState: function (sReason) {
                if (sReason === "101") {
                    return "Warning";
                }
                if (sReason === "102") {
                    return "Error";
                }
                if (sReason === "004" || sReason === "005") {
                    return "Information";
                }
                return "None";
            },

            formatReasonIcon: function (sReason) {
                if (sReason === "101") {
                    return "sap-icon://quality-issue";
                }
                if (sReason === "102") {
                    return "sap-icon://shipping-status";
                }
                if (sReason === "004" || sReason === "005") {
                    return "sap-icon://customer";
                }
                return "sap-icon://notes";
            },

            formatDate: function (sDate) {
                if (!sDate) return "-";
                // Accept ISO string from CAP ("YYYY-MM-DD") or raw /Date(ms)/ from SAP
                var d;
                if (typeof sDate === "string" && sDate.indexOf("/Date(") === 0) {
                    var ms = parseInt(sDate.replace(/\/Date\((\d+).*/, "$1"), 10);
                    d = isNaN(ms) ? null : new Date(ms);
                } else {
                    d = new Date(sDate);
                }
                if (!d || isNaN(d.getTime())) return sDate;
                // Format as DD MMM YYYY (e.g. 07 Jul 2025)
                var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                var day = String(d.getUTCDate()).padStart(2, "0");
                return day + " " + months[d.getUTCMonth()] + " " + d.getUTCFullYear();
            },

            formatAmount: function (vAmount) {
                if (vAmount == null || vAmount === "") {
                    return "-";
                }
                var f = parseFloat(vAmount);
                if (isNaN(f) || f === 0) return "-";
                return f.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            },

            formatAmountState: function (vAmount) {
                var f = parseFloat(vAmount);
                if (isNaN(f) || f === 0 || vAmount == null || vAmount === "") return "None";
                return "Success";
            },

            formatReason: function (sReason, sReasonText) {
                if (!sReason && !sReasonText) return "-";
                if (!sReasonText) return sReason;
                return sReason ? sReason + " - " + sReasonText : sReasonText;
            },

            formatQuantity: function (vQty) {
                if (vQty == null || vQty === "") {
                    return "-";
                }
                var f = parseFloat(vQty);
                return isNaN(f) ? "-" : f.toFixed(3);
            }
        };
    }

    var isNode = typeof module !== "undefined" && module.exports;
    var oExports = {
        createCustomerReturnFormatters: createCustomerReturnFormatters
    };

    if (isNode) {
        module.exports = oExports;
    }
    return oExports;
});
