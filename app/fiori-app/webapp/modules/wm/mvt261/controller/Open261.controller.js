sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient"
], function (BaseController, JSONModel, ODataClient) {
    "use strict";

    var BASE_PATH = "/odata/v4/mvt261";
    // Export columns: i18n label key -> result property, in table order.
    var EXPORT_COLUMNS = [
        ["open261Reservation", "Reservation"], ["open261Item", "ReservationItem"], ["mvt261Order", "ProductionOrder"],
        ["open261OrderDescription", "OrderDescription"], ["open261OrderStatus", "OrderStatus"], ["mvt261Material", "Material"], ["open261MaterialName", "MaterialName"],
        ["mvt261Plant", "Plant"], ["open261Sloc", "StorageLocation"], ["open261RequirementDate", "RequirementDate"],
        ["open261Required", "RequiredQuantity", "Number"], ["open261Withdrawn", "WithdrawnQuantity", "Number"],
        ["open261Open", "OpenQuantity", "Number"], ["open261ReadyUnits", "ReadyStorageUnits", "Number"], ["open261ReadyQuantity", "ReadyQuantity", "Number"], ["open261Unit", "Unit"], ["open261MovementAllowed", "MovementAllowed", "Boolean"],
        ["open261Status", "StatusText"], ["open261BlockReason", "BlockReason"]
    ];

    function ymd(oDate) {
        if (!oDate) {
            return "";
        }
        return oDate.getFullYear() + "-" + String(oDate.getMonth() + 1).padStart(2, "0") + "-" + String(oDate.getDate()).padStart(2, "0");
    }

    function sortItems(aItems, bDesc) {
        return (aItems || []).slice().sort(function (a, b) {
            var sDateA = a.RequirementDate || "";
            var sDateB = b.RequirementDate || "";
            var nDateCmp = sDateB.localeCompare(sDateA);
            if (nDateCmp !== 0) {
                return bDesc ? nDateCmp : -nDateCmp;
            }
            var sResA = String(a.Reservation || "").padStart(10, "0");
            var sResB = String(b.Reservation || "").padStart(10, "0");
            var nResCmp = sResB.localeCompare(sResA);
            if (nResCmp !== 0) {
                return bDesc ? nResCmp : -nResCmp;
            }
            var sItmA = String(a.ReservationItem || "").padStart(4, "0");
            var sItmB = String(b.ReservationItem || "").padStart(4, "0");
            var nItmCmp = sItmB.localeCompare(sItmA);
            return bDesc ? nItmCmp : -nItmCmp;
        });
    }

    return BaseController.extend("saps4hana.fiori.modules.wm.mvt261.controller.Open261", {

        onInit: function () {
            this._aAllItems = [];
            this._oLastResult = null;
            this.setModel(new JSONModel({
                plant: "",
                productionOrder: "",
                material: "",
                reservation: "",
                dateFrom: null,
                dateTo: null,
                includeFullyWithdrawn: false,
                scanPossibleOnly: true,
                selectedTab: "open",
                openCount: 0,
                blockedCount: 0,
                allCount: 0,
                sortDescending: true,
                busy: false,
                message: "",
                messageType: "Information",
                items: []
            }), "open261View");
            this.getModel("open261View").setSizeLimit(5000);
            this.getRouter().getRoute("wmOpen261").attachPatternMatched(this.onGo, this);
        },

        onGo: function () {
            var oModel = this.getModel("open261View");
            var o = oModel.getData();
            var q = function (s) { return "'" + encodeURIComponent((s || "").trim().replace(/'/g, "''")) + "'"; };
            var sUrl = BASE_PATH + "/openItems(plant=" + q(o.plant) + ",material=" + q(o.material) +
                ",productionOrder=" + q(o.productionOrder) + ",reservation=" + q(o.reservation) +
                ",dateFrom=" + q(ymd(o.dateFrom)) + ",dateTo=" + q(ymd(o.dateTo)) +
                ",includeFullyWithdrawn=" + !!o.includeFullyWithdrawn + ",scanPossibleOnly=false)";

            oModel.setProperty("/busy", true);
            oModel.setProperty("/message", "");
            ODataClient.get(sUrl).then(function (oResult) {
                var that = this;
                var aItems = (oResult.Items || []).map(function (item) {
                    item.StatusText = item.ScanPossible
                        ? (item.PartialCoverage ? that.getText("open261Status_Partial") : that.getText("open261Status_Open"))
                        : that.getText("open261Status_Blocked");
                    return item;
                });
                this._aAllItems = aItems;
                this._oLastResult = oResult;

                var nOpen = 0;
                var nBlocked = 0;
                for (var i = 0; i < aItems.length; i++) {
                    if (aItems[i].ScanPossible) {
                        nOpen++;
                    } else {
                        nBlocked++;
                    }
                }
                oModel.setProperty("/openCount", nOpen);
                oModel.setProperty("/blockedCount", nBlocked);
                oModel.setProperty("/allCount", aItems.length);
                this._applyTabFilter();
            }.bind(this)).catch(function (oError) {
                this._aAllItems = [];
                this._oLastResult = null;
                oModel.setProperty("/items", []);
                oModel.setProperty("/openCount", 0);
                oModel.setProperty("/blockedCount", 0);
                oModel.setProperty("/allCount", 0);
                oModel.setProperty("/messageType", "Error");
                oModel.setProperty("/message", (oError && oError.message) || this.getText("mvt261LoadError"));
            }.bind(this)).then(function () {
                oModel.setProperty("/busy", false);
            });
        },

        _applyTabFilter: function () {
            var oModel = this.getModel("open261View");
            var sTab = oModel.getProperty("/selectedTab") || "open";
            var bDesc = oModel.getProperty("/sortDescending") !== false;
            var aAll = this._aAllItems || [];
            var aFiltered;
            if (sTab === "open") {
                aFiltered = aAll.filter(function (i) { return i.ScanPossible; });
            } else if (sTab === "blocked") {
                aFiltered = aAll.filter(function (i) { return !i.ScanPossible; });
            } else {
                aFiltered = aAll.slice();
            }
            var aSorted = sortItems(aFiltered, bDesc);
            oModel.setProperty("/items", aSorted);

            var oRes = this._oLastResult || {};
            var nSapOpen = oRes.SapOpenCount || aAll.length;
            oModel.setProperty("/messageType", oRes.Truncated ? "Warning" : "Information");
            if (oRes.Truncated) {
                oModel.setProperty("/message", this.getText("open261Truncated", [aSorted.length, nSapOpen]));
            } else if (sTab === "open") {
                oModel.setProperty("/message", this.getText("open261SummaryOpen", [aSorted.length, nSapOpen]));
            } else if (sTab === "blocked") {
                oModel.setProperty("/message", this.getText("open261SummaryBlocked", [aSorted.length]));
            } else {
                oModel.setProperty("/message", this.getText("open261Summary", [aSorted.length, nSapOpen]));
            }
        },

        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key") || oEvent.getSource().getSelectedKey();
            this.getModel("open261View").setProperty("/selectedTab", sKey);
            this._applyTabFilter();
        },

        onToggleSort: function () {
            var oModel = this.getModel("open261View");
            var bNextDesc = !oModel.getProperty("/sortDescending");
            oModel.setProperty("/sortDescending", bNextDesc);
            this._applyTabFilter();
        },

        onOpenCycle: function (oEvent) {
            var o = oEvent.getSource().getBindingContext("open261View").getObject();
            this.getRouter().navTo("wmScan261", { reservation: o.Reservation, item: o.ReservationItem });
        },

        onExport: function () {
            var that = this;
            sap.ui.require(["sap/ui/export/Spreadsheet"], function (Spreadsheet) {
                var oSheet = new Spreadsheet({
                    workbook: {
                        columns: EXPORT_COLUMNS.map(function (a) {
                            return { label: that.getText(a[0]), property: a[1], type: a[2] || "String" };
                        })
                    },
                    dataSource: that.getModel("open261View").getProperty("/items"),
                    fileName: that.getText("open261ExportFile") + ".xlsx"
                });
                oSheet.build().finally(function () { oSheet.destroy(); });
            });
        }
    });
});
