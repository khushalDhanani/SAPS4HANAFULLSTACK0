sap.ui.define([
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "sap/m/MessageToast"
], function (JSONModel, ODataClient, MessageToast) {
    "use strict";

    var PRESETS_SM21_MINUTES = {
        "15m": 15,
        "1h": 60,
        "4h": 240,
        "24h": 1440
    };

    var PRESETS_SM20_MINUTES = {
        "15m": 15,
        "1h": 60,
        "4h": 240,
        "6h": 360
    };

    var SapLogsLogic = {
        /**
         * Creates and returns the default JSON model for sapLogsView.
         * @returns {sap.ui.model.json.JSONModel}
         */
        createModel: function () {
            var oWindowSm21 = this.calculateUtcWindow("1h", PRESETS_SM21_MINUTES);
            var oWindowSm20 = this.calculateUtcWindow("1h", PRESETS_SM20_MINUTES);

            return new JSONModel({
                selectedTab: "sm21",
                busy: false,
                errorMessage: "",
                warningMessage: "",
                sm21: {
                    preset: "1h",
                    fromUtc: oWindowSm21.fromUtc,
                    toUtc: oWindowSm21.toUtc,
                    instance: "",
                    maxRows: 500,
                    search: "",
                    entries: [],
                    filteredEntries: [],
                    count: 0,
                    truncated: false,
                    lastFetched: null
                },
                sm20: {
                    preset: "1h",
                    fromUtc: oWindowSm20.fromUtc,
                    toUtc: oWindowSm20.toUtc,
                    userFilter: "",
                    maxRows: 500,
                    search: "",
                    entries: [],
                    filteredEntries: [],
                    count: 0,
                    truncated: false,
                    lastFetched: null,
                    warnings: []
                },
                selectedEntry: null
            });
        },

        /**
         * Calculates start and end UTC timestamps for a given preset string.
         * The end timestamp is set 5 seconds in the past to ensure compliance with the
         * backend future-window guard across network latency.
         *
         * @param {string} sPreset
         * @param {Object} mPresetMap
         * @returns {{ fromUtc: string, toUtc: string }}
         */
        calculateUtcWindow: function (sPreset, mPresetMap) {
            var iMinutes = (mPresetMap && mPresetMap[sPreset]) || 60;
            var dNow = new Date(Date.now() - 5000); // 5s past buffer
            var dFrom = new Date(dNow.getTime() - (iMinutes * 60 * 1000));
            return {
                fromUtc: dFrom.toISOString(),
                toUtc: dNow.toISOString()
            };
        },

        /**
         * Builds the OData V4 function URL for getSystemLog.
         * @param {Object} mState
         * @returns {string}
         */
        buildSystemLogUrl: function (mState) {
            var aParams = [
                "fromUtc='" + encodeURIComponent(mState.fromUtc) + "'",
                "toUtc='" + encodeURIComponent(mState.toUtc) + "'"
            ];
            if (mState.instance && mState.instance.trim() !== "") {
                aParams.push("instance='" + encodeURIComponent(mState.instance.trim()) + "'");
            }
            if (mState.maxRows) {
                aParams.push("top=" + parseInt(mState.maxRows, 10));
            }
            return "/odata/v4/sap-logs/getSystemLog(" + aParams.join(",") + ")";
        },

        /**
         * Builds the OData V4 function URL for getSecurityAuditLog.
         * @param {Object} mState
         * @returns {string}
         */
        buildSecurityAuditLogUrl: function (mState) {
            var aParams = [
                "fromUtc='" + encodeURIComponent(mState.fromUtc) + "'",
                "toUtc='" + encodeURIComponent(mState.toUtc) + "'"
            ];
            if (mState.userFilter && mState.userFilter.trim() !== "") {
                aParams.push("user='" + encodeURIComponent(mState.userFilter.trim().toUpperCase()) + "'");
            }
            if (mState.maxRows) {
                aParams.push("top=" + parseInt(mState.maxRows, 10));
            }
            return "/odata/v4/sap-logs/getSecurityAuditLog(" + aParams.join(",") + ")";
        },

        /**
         * Filters log entries client-side using substring search across relevant fields.
         * @param {Array} aEntries
         * @param {string} sQuery
         * @returns {Array}
         */
        filterEntries: function (aEntries, sQuery) {
            if (!Array.isArray(aEntries)) {
                return [];
            }
            if (!sQuery || sQuery.trim() === "") {
                return aEntries;
            }
            var sLower = sQuery.trim().toLowerCase();
            return aEntries.filter(function (oEntry) {
                if (!oEntry) return false;
                var sSearchTarget = [
                    oEntry.entryType || "",
                    oEntry.eventId || "",
                    oEntry.eventText || "",
                    oEntry.message || "",
                    oEntry.messageText || "",
                    oEntry.tcode || "",
                    oEntry.program || "",
                    oEntry.user || "",
                    oEntry.instance || "",
                    oEntry.client || ""
                ].join(" ").toLowerCase();
                return sSearchTarget.indexOf(sLower) !== -1;
            });
        },

        /**
         * Fetches SM21 System Log entries.
         * @param {sap.ui.model.json.JSONModel} oModel
         * @returns {Promise<Object>}
         */
        loadSystemLogs: function (oModel) {
            var that = this;
            var mSm21 = oModel.getProperty("/sm21");

            // Refresh window based on current preset
            var oWindow = this.calculateUtcWindow(mSm21.preset, PRESETS_SM21_MINUTES);
            oModel.setProperty("/sm21/fromUtc", oWindow.fromUtc);
            oModel.setProperty("/sm21/toUtc", oWindow.toUtc);
            mSm21.fromUtc = oWindow.fromUtc;
            mSm21.toUtc = oWindow.toUtc;

            oModel.setProperty("/busy", true);
            oModel.setProperty("/errorMessage", "");
            oModel.setProperty("/warningMessage", "");

            var sUrl = this.buildSystemLogUrl(mSm21);

            return ODataClient.get(sUrl)
                .then(function (oData) {
                    var oResult = oData && (oData.value !== undefined ? oData.value : oData);
                    var aEntries = (oResult && oResult.entries) || [];
                    var iCount = (oResult && oResult.count) || aEntries.length;
                    var bTruncated = Boolean(oResult && oResult.truncated);

                    oModel.setProperty("/sm21/entries", aEntries);
                    oModel.setProperty("/sm21/count", iCount);
                    oModel.setProperty("/sm21/truncated", bTruncated);
                    oModel.setProperty("/sm21/lastFetched", new Date().toLocaleTimeString());

                    var aFiltered = that.filterEntries(aEntries, oModel.getProperty("/sm21/search"));
                    oModel.setProperty("/sm21/filteredEntries", aFiltered);

                    if (bTruncated) {
                        oModel.setProperty("/warningMessage", "Result row cap (" + mSm21.maxRows + ") reached. Consider narrowing the time window.");
                    }

                    return oResult;
                })
                .catch(function (err) {
                    var sMsg = (err && err.message) || "Failed to load System Log from SAP backend.";
                    oModel.setProperty("/errorMessage", sMsg);
                    oModel.setProperty("/sm21/entries", []);
                    oModel.setProperty("/sm21/filteredEntries", []);
                    oModel.setProperty("/sm21/count", 0);
                    throw err;
                })
                .finally(function () {
                    oModel.setProperty("/busy", false);
                });
        },

        /**
         * Fetches SM20 Security Audit Log entries.
         * @param {sap.ui.model.json.JSONModel} oModel
         * @returns {Promise<Object>}
         */
        loadSecurityAuditLogs: function (oModel) {
            var that = this;
            var mSm20 = oModel.getProperty("/sm20");

            // Refresh window based on current preset
            var oWindow = this.calculateUtcWindow(mSm20.preset, PRESETS_SM20_MINUTES);
            oModel.setProperty("/sm20/fromUtc", oWindow.fromUtc);
            oModel.setProperty("/sm20/toUtc", oWindow.toUtc);
            mSm20.fromUtc = oWindow.fromUtc;
            mSm20.toUtc = oWindow.toUtc;

            oModel.setProperty("/busy", true);
            oModel.setProperty("/errorMessage", "");
            oModel.setProperty("/warningMessage", "");

            var sUrl = this.buildSecurityAuditLogUrl(mSm20);

            return ODataClient.get(sUrl)
                .then(function (oData) {
                    var oResult = oData && (oData.value !== undefined ? oData.value : oData);
                    var aEntries = (oResult && oResult.entries) || [];
                    var iCount = (oResult && oResult.count) || aEntries.length;
                    var bTruncated = Boolean(oResult && oResult.truncated);
                    var aWarnings = (oResult && oResult.warnings) || [];

                    oModel.setProperty("/sm20/entries", aEntries);
                    oModel.setProperty("/sm20/count", iCount);
                    oModel.setProperty("/sm20/truncated", bTruncated);
                    oModel.setProperty("/sm20/warnings", aWarnings);
                    oModel.setProperty("/sm20/lastFetched", new Date().toLocaleTimeString());

                    var aFiltered = that.filterEntries(aEntries, oModel.getProperty("/sm20/search"));
                    oModel.setProperty("/sm20/filteredEntries", aFiltered);

                    if (bTruncated) {
                        oModel.setProperty("/warningMessage", "Result row cap (" + mSm20.maxRows + ") reached. Consider narrowing the time window.");
                    } else if (aWarnings.length > 0) {
                        oModel.setProperty("/warningMessage", aWarnings.join(" | "));
                    }

                    return oResult;
                })
                .catch(function (err) {
                    var sMsg = (err && err.message) || "Failed to load Security Audit Log from SAP backend.";
                    oModel.setProperty("/errorMessage", sMsg);
                    oModel.setProperty("/sm20/entries", []);
                    oModel.setProperty("/sm20/filteredEntries", []);
                    oModel.setProperty("/sm20/count", 0);
                    throw err;
                })
                .finally(function () {
                    oModel.setProperty("/busy", false);
                });
        },

        /**
         * Formats severity state for ObjectStatus controls.
         * @param {string} sEntryType
         * @param {number} [iSeverity]
         * @returns {string} ValueState (Error|Warning|Information|None)
         */
        formatSeverityState: function (sEntryType, iSeverity) {
            if (typeof iSeverity === "number") {
                if (iSeverity >= 3) return "Error";
                if (iSeverity === 2) return "Warning";
                return "Information";
            }
            if (!sEntryType) return "None";
            var s = String(sEntryType).trim();
            if (s.startsWith("l") || s.indexOf("AB1") !== -1 || s.indexOf("AB6") !== -1) {
                return "Error";
            }
            if (s.startsWith("m") || s.indexOf("S23") !== -1 || s.indexOf("R47") !== -1) {
                return "Warning";
            }
            return "Information";
        },

        /**
         * Formats severity icon for ObjectStatus controls.
         * @param {string} sEntryType
         * @param {number} [iSeverity]
         * @returns {string} Icon URI
         */
        formatSeverityIcon: function (sEntryType, iSeverity) {
            var sState = this.formatSeverityState(sEntryType, iSeverity);
            switch (sState) {
                case "Error": return "sap-icon://error";
                case "Warning": return "sap-icon://alert";
                case "Information": return "sap-icon://hint";
                default: return "sap-icon://sys-enter-2";
            }
        },

        /**
         * Formats an ISO datetime string into UTC display string: YYYY-MM-DD HH:mm:ss UTC
         * @param {string} sIso
         * @returns {string}
         */
        formatUtcTimestamp: function (sIso) {
            if (!sIso) return "-";
            try {
                var d = new Date(sIso);
                if (isNaN(d.getTime())) return String(sIso);
                var pad = function (n) { return n < 10 ? "0" + n : String(n); };
                return d.getUTCFullYear() + "-" +
                    pad(d.getUTCMonth() + 1) + "-" +
                    pad(d.getUTCDate()) + " " +
                    pad(d.getUTCHours()) + ":" +
                    pad(d.getUTCMinutes()) + ":" +
                    pad(d.getUTCSeconds()) + " UTC";
            } catch (e) {
                return String(sIso);
            }
        }
    };

    return SapLogsLogic;
});
