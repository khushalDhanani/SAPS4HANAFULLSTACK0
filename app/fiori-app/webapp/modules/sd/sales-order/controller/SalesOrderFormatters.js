sap.ui.define([], function () {
    "use strict";

    function createSalesOrderFormatters() {
        return {
            formatter: {
                statusText: function (sStatus) {
                    if (!sStatus || sStatus === "A" || sStatus === "Open") {
                        return "Open";
                    }
                    if (sStatus === "B") {
                        return "In Process";
                    }
                    if (sStatus === "C" || sStatus === "Completed") {
                        return "Completed";
                    }
                    return sStatus;
                },

                statusState: function (sStatus) {
                    if (!sStatus || sStatus === "A" || sStatus === "Open") {
                        return "Information";
                    }
                    if (sStatus === "B") {
                        return "Warning";
                    }
                    if (sStatus === "C" || sStatus === "Completed") {
                        return "Success";
                    }
                    return "None";
                },

                approvalStatusText: function (sStatus) {
                    if (sStatus === "unknown") {
                        return "Unknown";
                    }
                    if (sStatus === "A") {
                        return "In Approval";
                    }
                    if (sStatus === "B") {
                        return "Released";
                    }
                    if (sStatus === "C") {
                        return "Rejected";
                    }
                    if (sStatus === "D") {
                        return "To Be Reworked";
                    }
                    return sStatus ? sStatus : "Not Relevant";
                },

                approvalStatusState: function (sStatus) {
                    if (sStatus === "unknown" || sStatus === "A" || sStatus === "D") {
                        return "Warning";
                    }
                    if (sStatus === "B") {
                        return "Success";
                    }
                    if (sStatus === "C") {
                        return "Error";
                    }
                    return "None";
                },

                approvalStatusIcon: function (sStatus) {
                    if (sStatus === "A") {
                        return "sap-icon://pending";
                    }
                    if (sStatus === "B") {
                        return "sap-icon://accept";
                    }
                    if (sStatus === "C") {
                        return "sap-icon://decline";
                    }
                    if (sStatus === "D") {
                        return "sap-icon://reopen-page";
                    }
                    return "";
                }
            }
        };
    }

    var isNode = typeof module !== "undefined" && module.exports;
    var oExports = {
        createSalesOrderFormatters: createSalesOrderFormatters
    };

    if (isNode) {
        module.exports = oExports;
    }
    return oExports;
});
