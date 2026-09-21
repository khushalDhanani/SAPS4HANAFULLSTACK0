sap.ui.define([
    "sap/ui/core/format/DateFormat"
], function (DateFormat) {
    "use strict";

    function _resolveDisplayStatus(sStatusCode, sStatusName, bReleaseNotCompleted, sDeletionCode, bCompleteness) {
        if (sStatusCode == null && sStatusName == null && bReleaseNotCompleted == null && sDeletionCode == null && bCompleteness == null) {
            return "";
        }
        if (sDeletionCode === "L") {
            return "Deleted";
        }
        if (sStatusName != null && String(sStatusName).trim() !== "") {
            return String(sStatusName).trim();
        }
        if (sStatusCode != null && String(sStatusCode).trim() !== "") {
            var sCode = String(sStatusCode).trim();
            switch (sCode) {
                case "01":
                    return "Draft";
                case "02":
                    return "In Approval";
                case "04":
                    return "Sent";
                case "05":
                    return "Follow-On Documents";
                case "38":
                    return "Rejected";
                default:
                    return sCode;
            }
        }
        var bRelNotDone = bReleaseNotCompleted === true || bReleaseNotCompleted === "true";
        if (bRelNotDone) {
            return "In Approval";
        }
        if (bCompleteness === false || bCompleteness === "false") {
            return "Draft";
        }
        if (bCompleteness === true || bCompleteness === "true") {
            return "Approved";
        }
        return "";
    }

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

        /**
         * Computes the authentic Display Status from S/4HANA Purchasing Document status fields:
         * - 'Deleted' (Deletion code L)
         * - Authentic SAP Status Name if present (e.g. 'Draft', 'In Approval', 'Sent', 'Follow-On Documents', 'Rejected', 'Approved')
         * - Standard status code mapped name ('01' -> 'Draft', '02' -> 'In Approval', '04' -> 'Sent', '05' -> 'Follow-On Documents', '38' -> 'Rejected')
         * - Raw status code if unrecognized (never defaults to 'Approved')
         * - Fallback to release pending ('In Approval') or completeness flags ('Approved' / 'Draft')
         *
         * @param {string} [sStatusCode] - PurchasingDocumentStatus (e.g. '01', '02', '04', '05', '38')
         * @param {string} [sStatusName] - PurchasingDocumentStatusName (e.g. 'Draft', 'In Approval', 'Sent', 'Follow-On Documents', 'Rejected')
         * @param {boolean} [bReleaseNotCompleted] - ReleaseIsNotCompleted
         * @param {string} [sDeletionCode] - PurchasingDocumentDeletionCode ('L')
         * @param {boolean} [bCompleteness] - PurchasingCompletenessStatus
         * @returns {string} Status name, 'Deleted', raw status code, or ''
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
            if (sLower === "approved" || sLower === "sent" || sLower === "follow-on documents") {
                return "Success";
            }
            if (sLower === "draft") {
                return "Information";
            }
            if (sLower === "in approval" || sLower.indexOf("approval") !== -1) {
                return "Warning";
            }
            if (sLower === "rejected" || sLower === "deleted") {
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
            if (sLower === "approved" || sLower === "sent" || sLower === "follow-on documents") {
                return "sap-icon://accept";
            }
            if (sLower === "draft") {
                return "sap-icon://edit";
            }
            if (sLower === "in approval" || sLower.indexOf("approval") !== -1) {
                return "sap-icon://pending";
            }
            if (sLower === "rejected" || sLower === "deleted") {
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
            return bIsComplete ? "Approved" : "Draft";
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
