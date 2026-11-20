(function () {
    "use strict";

    var LIST_MAX_DAYS = 31; // same limit as the server (QuarantineLabelAdapter.normalizeListInput)

    /** Date -> "yyyy-MM-dd" in local time ("" for no date). */
    function isoDay(d) {
        if (!(d instanceof Date) || isNaN(d.getTime())) {
            return "";
        }
        return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    }

    /** Same rules as the server; the server stays authoritative. Returns an i18n key or "". */
    function validateList(oList) {
        if (!/^[A-Za-z0-9]{4}$/.test(String(oList.plant || "").trim())) {
            return "qlListPlantInvalid";
        }
        if (String(oList.materialDocument || "").trim()) {
            return /^\d{1,10}$/.test(String(oList.materialDocument).trim()) && /^\d{4}$/.test(String(oList.year || "").trim())
                ? "" : "qlListDocInvalid";
        }
        if (!isoDay(oList.dateFrom) || !isoDay(oList.dateTo)) {
            return "qlListDatesMissing";
        }
        var iDays = Math.round((Date.UTC(oList.dateTo.getFullYear(), oList.dateTo.getMonth(), oList.dateTo.getDate())
            - Date.UTC(oList.dateFrom.getFullYear(), oList.dateFrom.getMonth(), oList.dateFrom.getDate())) / 86400000) + 1;
        return iDays > LIST_MAX_DAYS ? "qlListRangeTooLong" : "";
    }

    function createQuarantineLabelTableManager(deps) {
        deps = deps || {};
        var QuarantineLabelService = deps.QuarantineLabelService;

        return {
            /** Pre-fills the plant with the user's first plant; the server checks the plant on every list read. */
            _initPlant: function () {
                var that = this;
                return QuarantineLabelService.getPlantContext().then(function (oCtx) {
                    var oList = that.getModel("qlList");
                    if (!String(oList.getProperty("/plant") || "").trim() && oCtx.plants[0]) {
                        oList.setProperty("/plant", oCtx.plants[0]);
                    }
                }).catch(function () {
                    // the user types the plant instead; the list read still checks it on the server
                });
            },

            onListGo: function () {
                var oVm = this.getModel("qlView");
                if (oVm.getProperty("/busy")) {
                    return;
                }
                var oList = this.getModel("qlList");
                var sError = validateList(oList.getData());
                if (sError) {
                    oVm.setProperty("/message", this.getText(sError));
                    oVm.setProperty("/messageType", "Error");
                    return;
                }
                var oData = oList.getData();
                var bDoc = !!String(oData.materialDocument || "").trim();
                var that = this;
                oVm.setProperty("/busy", true);
                oVm.setProperty("/message", "");
                return QuarantineLabelService.listDocuments({
                    plant: String(oData.plant).trim().toUpperCase(),
                    dateFrom: bDoc ? "" : isoDay(oData.dateFrom),
                    dateTo: bDoc ? "" : isoDay(oData.dateTo),
                    materialDocument: bDoc ? String(oData.materialDocument).trim() : "",
                    year: bDoc ? String(oData.year).trim() : ""
                }).then(function (oResult) {
                    var aDocs = (oResult && oResult.Documents) || [];
                    oList.setProperty("/documents", aDocs);
                    oList.setProperty("/more", !!(oResult && oResult.More));
                    oList.setProperty("/listed", true);
                    oList.setProperty("/selectedCount", 0);
                    var oTable = that.byId && that.byId("qlDocTable");
                    if (oTable) {
                        oTable.removeSelections(true);
                    }
                    if (oResult && oResult.More) {
                        oVm.setProperty("/message", that.getText("qlListMore", [aDocs.length]));
                        oVm.setProperty("/messageType", "Warning");
                    }
                }).catch(function (oError) {
                    oList.setProperty("/documents", []);
                    oList.setProperty("/listed", false);
                    oVm.setProperty("/message", (oError && oError.message) || that.getText("qlListFailed"));
                    oVm.setProperty("/messageType", "Error");
                }).finally(function () {
                    oVm.setProperty("/busy", false);
                });
            },

            formatCount: function (sPattern, aDocs) {
                return String(sPattern || "").replace("{0}", (aDocs || []).length);
            },

            formatSelected: function (sPattern, iCount) {
                return String(sPattern || "").replace("{0}", iCount || 0);
            },

            onListSelectionChange: function (oEvent) {
                this.getModel("qlList").setProperty("/selectedCount", oEvent.getSource().getSelectedItems().length);
            }
        };
    }

    var oExports = {
        createQuarantineLabelTableManager: createQuarantineLabelTableManager,
        isoDay: isoDay,
        validateList: validateList,
        LIST_MAX_DAYS: LIST_MAX_DAYS
    };

    var isNode = typeof module !== "undefined" && module.exports;
    if (isNode) {
        module.exports = oExports;
    }
    if (!isNode && typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function") {
        sap.ui.define([], function () {
            return oExports;
        });
    }
})();
