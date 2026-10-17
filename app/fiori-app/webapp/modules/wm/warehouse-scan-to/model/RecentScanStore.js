sap.ui.define([
    "saps4hana/fiori/service/AuthService"
], function (AuthService) {
    "use strict";

    var STORAGE_PREFIX = "saps4hana_wm_scan_recent_";

    return {
        /**
         * Resolves storage key for current user.
         * Returns null if user is unknown (no default user fallback).
         * @param {sap.ui.core.UIComponent} [oComponent]
         * @returns {string|null}
         */
        getStorageKey: function (oComponent) {
            var sUser = AuthService && typeof AuthService.getCurrentUserName === "function"
                ? AuthService.getCurrentUserName(oComponent)
                : "";
            if (!sUser || typeof sUser !== "string" || !sUser.trim()) {
                return null;
            }
            return STORAGE_PREFIX + sUser.trim().toLowerCase();
        },

        /**
         * Get recent scans for current user (up to 5 items).
         * @param {sap.ui.core.UIComponent} [oComponent]
         * @returns {Array}
         */
        getRecentScans: function (oComponent) {
            var sKey = this.getStorageKey(oComponent);
            if (!sKey) {
                return [];
            }
            try {
                var sRaw = localStorage.getItem(sKey);
                if (!sRaw) {
                    return [];
                }
                var aList = JSON.parse(sRaw);
                return Array.isArray(aList) ? aList.slice(0, 5) : [];
            } catch (e) {
                return [];
            }
        },

        /**
         * Save recent scan for current user.
         * Skips saving if user is unknown.
         * Deduplicates and caps at 5 items.
         * Timestamp formatted as YYYY-MM-DD HH:mm.
         * Status chip is dropped.
         * @param {sap.ui.core.UIComponent} [oComponent]
         * @param {Object} oScan
         */
        addRecentScan: function (oComponent, oScan) {
            var sKey = this.getStorageKey(oComponent);
            if (!sKey || !oScan || !oScan.number) {
                return;
            }
            var sNumber = String(oScan.number).trim();
            var sDocType = (oScan.docType || "TR").trim().toUpperCase();
            var sLgnum = (oScan.lgnum || "").trim();

            var aList = this.getRecentScans(oComponent);
            aList = aList.filter(function (it) {
                return !(it.number === sNumber && it.docType === sDocType);
            });

            var now = new Date();
            var sMonth = String(now.getMonth() + 1).padStart(2, "0");
            var sDay = String(now.getDate()).padStart(2, "0");
            var sHours = String(now.getHours()).padStart(2, "0");
            var sMinutes = String(now.getMinutes()).padStart(2, "0");
            var sTimestamp = now.getFullYear() + "-" + sMonth + "-" + sDay + " " + sHours + ":" + sMinutes;

            aList.unshift({
                number: sNumber,
                docType: sDocType,
                lgnum: sLgnum,
                timestamp: sTimestamp
            });

            try {
                localStorage.setItem(sKey, JSON.stringify(aList.slice(0, 5)));
            } catch (e) {
                // Ignore localStorage errors
            }
        },

        clearRecentScans: function (oComponent) {
            var sKey = this.getStorageKey(oComponent);
            if (sKey) {
                try {
                    localStorage.removeItem(sKey);
                } catch (e) {}
            }
        }
    };
});
