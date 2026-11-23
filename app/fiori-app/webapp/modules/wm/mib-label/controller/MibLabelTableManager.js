(function () {
    "use strict";

    var LIST_MAX_DAYS = 31;

    /** Date -> "yyyy-MM-dd" in local time ("" for no date). */
    function isoDay(d) {
        if (!(d instanceof Date) || isNaN(d.getTime())) {
            return "";
        }
        return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    }

    function validateList(oList) {
        if (!/^[A-Za-z0-9]{1,3}$/.test(String(oList.warehouseNumber || "").trim())) {
            return "mibListWarehouseInvalid";
        }
        if (String(oList.transferOrderNumber || "").trim()) {
            return /^\d{1,10}$/.test(String(oList.transferOrderNumber).trim()) ? "" : "mibToInvalid";
        }
        if (!isoDay(oList.dateFrom) || !isoDay(oList.dateTo)) {
            return "mibListDatesMissing";
        }
        var iDays = Math.round((Date.UTC(oList.dateTo.getFullYear(), oList.dateTo.getMonth(), oList.dateTo.getDate())
            - Date.UTC(oList.dateFrom.getFullYear(), oList.dateFrom.getMonth(), oList.dateFrom.getDate())) / 86400000) + 1;
        return iDays > LIST_MAX_DAYS ? "mibListRangeTooLong" : "";
    }

    function createMibLabelTableManager(deps) {
        deps = deps || {};
        var MibLabelService = deps.MibLabelService;

        return {
            onListGo: function () {
                var oVm = this.getModel("mibView");
                if (oVm.getProperty("/busy")) {
                    return;
                }
                var oList = this.getModel("mibList");
                var sError = validateList(oList.getData());
                if (sError) {
                    oVm.setProperty("/message", this.getText(sError));
                    oVm.setProperty("/messageType", "Error");
                    return;
                }
                var oData = oList.getData();
                var bTo = !!String(oData.transferOrderNumber || "").trim();
                var that = this;
                oVm.setProperty("/busy", true);
                oVm.setProperty("/message", "");

                return MibLabelService.listTransferOrders({
                    warehouseNumber: String(oData.warehouseNumber).trim().toUpperCase(),
                    dateFrom: bTo ? "" : isoDay(oData.dateFrom),
                    dateTo: bTo ? "" : isoDay(oData.dateTo),
                    transferOrderNumber: bTo ? String(oData.transferOrderNumber).trim() : ""
                }).then(function (oResult) {
                    var aOrders = (oResult && oResult.TransferOrders) || [];
                    oList.setProperty("/transferOrders", aOrders);
                    oList.setProperty("/more", !!(oResult && oResult.More));
                    oList.setProperty("/listed", true);
                    oList.setProperty("/selectedCount", 0);
                    var oTable = that.byId && that.byId("mibToTable");
                    if (oTable) {
                        oTable.removeSelections(true);
                    }
                    if (oResult && oResult.More) {
                        oVm.setProperty("/message", that.getText("mibListMore", [aOrders.length]));
                        oVm.setProperty("/messageType", "Warning");
                    }
                }).catch(function (oError) {
                    oList.setProperty("/transferOrders", []);
                    oList.setProperty("/listed", false);
                    oVm.setProperty("/message", (oError && oError.message) || that.getText("mibListFailed"));
                    oVm.setProperty("/messageType", "Error");
                }).finally(function () {
                    oVm.setProperty("/busy", false);
                });
            },

            formatCount: function (sPattern, aOrders) {
                return String(sPattern || "").replace("{0}", (aOrders || []).length);
            },

            formatSelected: function (sPattern, iCount) {
                return String(sPattern || "").replace("{0}", iCount || 0);
            },

            onListSelectionChange: function (oEvent) {
                this.getModel("mibList").setProperty("/selectedCount", oEvent.getSource().getSelectedItems().length);
            }
        };
    }

    var oExports = {
        createMibLabelTableManager: createMibLabelTableManager,
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
