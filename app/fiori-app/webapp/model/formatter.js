sap.ui.define([
    "sap/ui/core/format/DateFormat"
], function (DateFormat) {
    "use strict";

    /**
     * Verified SAP S/4HANA Purchasing Document Status codes and names
     * from Gateway service C_PURCHASEORDER_FS_SRV (entity set I_PurchasingDocumentStatusText, Language 'EN').
     */
    var SAP_PURCHASING_DOCUMENT_STATUS = {
        "01": "Draft",
        "02": "In Approval",
        "03": "Not Yet Sent",
        "04": "Sent",
        "05": "Follow-On Documents",
        "06": "Release Orders Exist",
        "07": "Expiring Soon",
        "08": "Released",
        "09": "Expired",
        "10": "Deleted",
        "11": "Paid",
        "12": "Unpaid",
        "13": "Blocked",
        "14": "Canceled",
        "15": "Partially Paid",
        "16": "Release Refused",
        "21": "Invoice Completed",
        "22": "Completed",
        "23": "Ordered",
        "24": "Quantity Mismatch",
        "25": "Value Mismatch",
        "26": "Missing Confirmation",
        "27": "Created",
        "31": "Reversed",
        "32": "With Errors",
        "33": "Correct",
        "34": "Parked and Held",
        "35": "Entered and Held",
        "36": "Empty Item",
        "37": "Output Error",
        "38": "Rejected",
        "39": "Marked for Deletion",
        "40": "Not Yet Relevant"
    };

    function _resolveDisplayStatus(sStatusCode, sStatusName, bReleaseNotCompleted, sDeletionCode, bCompleteness) {
        if (sDeletionCode === "L") {
            return "Deleted";
        }
        if (sStatusName != null && String(sStatusName).trim() !== "") {
            return String(sStatusName).trim();
        }
        if (sStatusCode != null && String(sStatusCode).trim() !== "") {
            var sCode = String(sStatusCode).trim();
            if (SAP_PURCHASING_DOCUMENT_STATUS[sCode]) {
                return SAP_PURCHASING_DOCUMENT_STATUS[sCode];
            }
            return sCode;
        }
        // Show SAP's status name only; never synthesize status from completeness or release flags
        return "";
    }

    return {
        /** SAP purchasing document status name for a status code (e.g. "04" → "Sent"); code itself when unknown. */
        statusCodeName: function (sCode) {
            return SAP_PURCHASING_DOCUMENT_STATUS[sCode] || sCode;
        },

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

        /**
         * Computes the authentic Display Status from S/4HANA Purchasing Document status fields:
         * - 'Deleted' (Deletion code L)
         * - Authentic SAP Status Name if present (e.g. 'Draft', 'In Approval', 'Sent', 'Follow-On Documents', 'Rejected', etc.)
         * - Verified status code lookup against SAP I_PurchasingDocumentStatusText table (33 codes)
         * - Raw status code if unrecognized (never defaults to 'Approved')
         * - Blank string if no status information is provided (never guesses from completeness or release flags)
         *
         * @param {string} [sStatusCode] - PurchasingDocumentStatus (e.g. '01', '02', '04', '05', '38')
         * @param {string} [sStatusName] - PurchasingDocumentStatusName (e.g. 'Draft', 'In Approval', 'Sent', 'Follow-On Documents', 'Rejected')
         * @param {boolean} [bReleaseNotCompleted] - ReleaseIsNotCompleted
         * @param {string} [sDeletionCode] - PurchasingDocumentDeletionCode ('L')
         * @param {boolean} [bCompleteness] - PurchasingCompletenessStatus
         * @returns {string} Authentic SAP status name, 'Deleted', raw status code, or ''
         */
        displayStatus: function (sStatusCode, sStatusName, bReleaseNotCompleted, sDeletionCode, bCompleteness) {
            return _resolveDisplayStatus(sStatusCode, sStatusName, bReleaseNotCompleted, sDeletionCode, bCompleteness);
        },

        displayStatusState: function (sStatusCode, sStatusName, bReleaseNotCompleted, sDeletionCode, bCompleteness) {
            var sStatus = _resolveDisplayStatus(sStatusCode, sStatusName, bReleaseNotCompleted, sDeletionCode, bCompleteness);
            if (!sStatus) {
                return "None";
            }
            var sLower = sStatus.toLowerCase();
            if (sLower === "approved" || sLower === "sent" || sLower === "follow-on documents" || sLower === "released" || sLower === "completed" || sLower === "ordered" || sLower === "correct") {
                return "Success";
            }
            if (sLower === "draft" || sLower === "created" || sLower === "entered and held" || sLower === "parked and held") {
                return "Information";
            }
            if (sLower === "in approval" || sLower.indexOf("approval") !== -1 || sLower === "not yet sent" || sLower === "expiring soon") {
                return "Warning";
            }
            if (sLower === "rejected" || sLower === "deleted" || sLower === "canceled" || sLower === "blocked" || sLower === "with errors" || sLower === "release refused" || sLower === "output error" || sLower === "marked for deletion") {
                return "Error";
            }
            return "None";
        },

        displayStatusIcon: function (sStatusCode, sStatusName, bReleaseNotCompleted, sDeletionCode, bCompleteness) {
            var sStatus = _resolveDisplayStatus(sStatusCode, sStatusName, bReleaseNotCompleted, sDeletionCode, bCompleteness);
            if (!sStatus) {
                return "";
            }
            var sLower = sStatus.toLowerCase();
            if (sLower === "approved" || sLower === "sent" || sLower === "follow-on documents" || sLower === "released" || sLower === "completed" || sLower === "ordered" || sLower === "correct") {
                return "sap-icon://accept";
            }
            if (sLower === "draft" || sLower === "created" || sLower === "entered and held" || sLower === "parked and held") {
                return "sap-icon://edit";
            }
            if (sLower === "in approval" || sLower.indexOf("approval") !== -1 || sLower === "not yet sent" || sLower === "expiring soon") {
                return "sap-icon://pending";
            }
            if (sLower === "rejected" || sLower === "deleted" || sLower === "canceled" || sLower === "blocked" || sLower === "with errors" || sLower === "release refused" || sLower === "output error" || sLower === "marked for deletion") {
                return "sap-icon://decline";
            }
            return "";
        },

        completenessState: function (bComplete) {
            var bIsComplete = bComplete === true || bComplete === "true";
            return bIsComplete ? "Success" : "Information";
        },

        completenessIcon: function (bComplete) {
            var bIsComplete = bComplete === true || bComplete === "true";
            return bIsComplete ? "sap-icon://accept" : "sap-icon://edit";
        },

        completenessText: function (bComplete) {
            var bIsComplete = bComplete === true || bComplete === "true";
            return bIsComplete ? "Complete" : "Incomplete";
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
