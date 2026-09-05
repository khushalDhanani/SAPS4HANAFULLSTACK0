sap.ui.define([
    "sap/ui/core/format/DateFormat"
], function (DateFormat) {
    "use strict";

    function _resolveDisplayStatus(sStatusCode, sStatusName, bReleaseNotCompleted, sDeletionCode, bCompleteness) {
        if (sStatusCode == null && sStatusName == null && bReleaseNotCompleted == null && sDeletionCode == null && bCompleteness == null) {
            return "";
        }
        if (sDeletionCode === "L" || sStatusCode === "38" || (sStatusName && String(sStatusName).toLowerCase() === "rejected")) {
            return "Rejected";
        }
        var bRelNotDone = bReleaseNotCompleted === true || bReleaseNotCompleted === "true";
        if (sStatusCode === "02" || bRelNotDone || (sStatusName && String(sStatusName).toLowerCase().indexOf("approval") !== -1)) {
            return "In Approval";
        }
        if (sStatusCode === "01" || (sStatusName && String(sStatusName).toLowerCase() === "draft")) {
            return "Draft";
        }
        if (sStatusCode === "04" || sStatusCode === "05" || bCompleteness === true || bCompleteness === "true") {
            return "Approved";
        }
        if (bCompleteness === false || bCompleteness === "false") {
            return "Draft";
        }
        return "Approved";
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
         * Computes the clean canonical Display Status from S/4HANA Purchasing Document status fields:
         * - 'Rejected' (Status 38, deletion code L, or rejected text)
         * - 'In Approval' (Status 02, release pending, or approval text)
         * - 'Draft' (Status 01, completeness false, or draft text)
         * - 'Approved' (Status 04 Sent, Status 05 Follow-On Documents, or completeness true)
         *
         * @param {string} [sStatusCode] - PurchasingDocumentStatus (e.g. '01', '02', '04', '05', '38')
         * @param {string} [sStatusName] - PurchasingDocumentStatusName (e.g. 'Draft', 'In Approval', 'Sent', 'Follow-On Documents', 'Rejected')
         * @param {boolean} [bReleaseNotCompleted] - ReleaseIsNotCompleted
         * @param {string} [sDeletionCode] - PurchasingDocumentDeletionCode ('L')
         * @param {boolean} [bCompleteness] - PurchasingCompletenessStatus
         * @returns {string} Clean Display Status: 'Approved', 'Draft', 'Rejected', or 'In Approval'
         */
        displayStatus: function (sStatusCode, sStatusName, bReleaseNotCompleted, sDeletionCode, bCompleteness) {
            return _resolveDisplayStatus(sStatusCode, sStatusName, bReleaseNotCompleted, sDeletionCode, bCompleteness);
        },

        displayStatusState: function (sStatusCode, sStatusName, bReleaseNotCompleted, sDeletionCode, bCompleteness) {
            var sStatus = _resolveDisplayStatus(sStatusCode, sStatusName, bReleaseNotCompleted, sDeletionCode, bCompleteness);
            switch (sStatus) {
                case "Approved":
                    return "Success";
                case "Draft":
                    return "Information";
                case "In Approval":
                    return "Warning";
                case "Rejected":
                    return "Error";
                default:
                    return "None";
            }
        },

        displayStatusIcon: function (sStatusCode, sStatusName, bReleaseNotCompleted, sDeletionCode, bCompleteness) {
            var sStatus = _resolveDisplayStatus(sStatusCode, sStatusName, bReleaseNotCompleted, sDeletionCode, bCompleteness);
            switch (sStatus) {
                case "Approved":
                    return "sap-icon://accept";
                case "Draft":
                    return "sap-icon://edit";
                case "In Approval":
                    return "sap-icon://pending";
                case "Rejected":
                    return "sap-icon://decline";
                default:
                    return "";
            }
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
