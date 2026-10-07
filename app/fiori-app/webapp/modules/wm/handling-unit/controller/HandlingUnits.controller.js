sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "sap/ui/core/Fragment",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/BusyDialog",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelPrinter"
], function (BaseController, JSONModel, ODataClient, Fragment, MessageToast, MessageBox, BusyDialog, HuLabelPrinter) {
    "use strict";

    var BASE_PATH = "/odata/v4/handling-unit";
    var PRINT_SAFE_LIMIT = 500; // Print All asks for extra confirmation above this many labels
    var READ_CHUNK = 8; // each label costs a detail (+ serials) read; cap concurrent reads
    var READ_TIMEOUT = 30000; // ms per HU read before one retry, then abort
    var q = function (s) { return "'" + encodeURIComponent((s || "").trim().replace(/'/g, "''")) + "'"; };
    // Value-help input kind -> model path for its suggestion list.
    var VALUE_HELPS = { plant: "/vhPlant", packaging: "/vhPackaging", status: "/vhStatus", shippingpoint: "/vhShippingPoint", storagelocation: "/vhStorageLocation" };
    // Export columns: i18n label key -> result property (-> type), in table order. Same shape as Open261.
    var EXPORT_COLUMNS = [
        ["huColHandlingUnit", "HandlingUnitExternalID"], ["huColPackaging", "PackagingMaterial"], ["huPackagingMaterial", "PackagingMaterialName"],
        ["huPlant", "Plant"], ["huStorageLocation", "StorageLocation"], ["huColGrossWeight", "GrossWeight", "Number"], ["huColGrossWeight", "WeightUnit"],
        ["huColStatus", "StatusText"], ["huColReference", "ReferenceDocument"], ["huCreatedBy", "CreatedByUser"], ["huColCreated", "CreationDateTime"]
    ];

    return BaseController.extend("saps4hana.fiori.modules.wm.handling-unit.controller.HandlingUnits", {

        onInit: function () {
            this.setModel(new JSONModel({
                plant: "",
                storageLocation: "",
                packagingMaterial: "",
                handlingUnitExternalID: "",
                status: "",
                shippingPoint: "",
                busy: false,
                message: "",
                messageType: "Information",
                items: [],
                selectedCount: 0,
                vhPlant: [],
                vhPackaging: [],
                vhStatus: [],
                vhShippingPoint: [],
                vhStorageLocation: [],
                kpiTotal: 0,
                kpis: []
            }), "huView");
            this.getModel("huView").setSizeLimit(2000);
            this.setModel(new JSONModel({ packagingMaterial: "", plant: "", storageLocation: "", content: "", busy: false, error: "" }), "huCreate");
            this._loadValueHelps();
            this._loadKpis();
            this.getRouter().getRoute("wmHandlingUnits").attachPatternMatched(this.onRouteMatched, this);
        },

        _loadKpis: function () {
            var oModel = this.getModel("huView");
            ODataClient.get(BASE_PATH + "/statusKpis()").then(function (oResult) {
                oModel.setProperty("/kpiTotal", (oResult && oResult.Total) || 0);
                oModel.setProperty("/kpis", (oResult && oResult.Items) || []);
            }).catch(function () {
                // KPI cards are informational; a failure must not break the list.
            });
        },

        _loadValueHelps: function () {
            var oModel = this.getModel("huView");
            Object.keys(VALUE_HELPS).forEach(function (sKind) {
                ODataClient.get(BASE_PATH + "/valueHelp(kind='" + sKind + "')").then(function (oResult) {
                    oModel.setProperty(VALUE_HELPS[sKind], (oResult && oResult.Items) || []);
                }).catch(function () {
                    // A value-help failure must not break the filter bar; the input stays a plain text field.
                });
            });
        },

        // Entry via route: load the list straight away (no Go click). The adapter caps the result
        // at MAX_LIST (1000) server-side, so an unfiltered load is bounded; Go re-filters manually.
        onRouteMatched: function () {
            this.onGo();
        },

        onGo: function () {
            var oModel = this.getModel("huView");
            var o = oModel.getData();
            var q = function (s) { return "'" + encodeURIComponent((s || "").trim().replace(/'/g, "''")) + "'"; };
            var sUrl = BASE_PATH + "/list(plant=" + q(o.plant) + ",storageLocation=" + q(o.storageLocation) +
                ",warehouse=" + q("") + ",packagingMaterial=" + q(o.packagingMaterial) +
                ",handlingUnitExternalID=" + q(o.handlingUnitExternalID) + ",status=" + q(o.status) +
                ",shippingPoint=" + q(o.shippingPoint) + ")";

            oModel.setProperty("/selectedCount", 0);
            oModel.setProperty("/busy", true);
            oModel.setProperty("/message", "");
            ODataClient.get(sUrl).then(function (oResult) {
                oModel.setProperty("/items", oResult.Items || []);
                oModel.setProperty("/messageType", oResult.Truncated ? "Warning" : "Information");
                oModel.setProperty("/message", this.getText(oResult.Truncated ? "huTruncated" : "huSummary", [oResult.TotalCount, oResult.SapCount]));
            }.bind(this)).catch(function (oError) {
                oModel.setProperty("/items", []);
                oModel.setProperty("/messageType", "Error");
                oModel.setProperty("/message", (oError && oError.message) || this.getText("huLoadError"));
            }.bind(this)).then(function () {
                oModel.setProperty("/busy", false);
            });
        },

        onSelectionChange: function (oEvent) {
            this.getModel("huView").setProperty("/selectedCount", oEvent.getSource().getSelectedItems().length);
        },

        _rowsToObjects: function (aItems) {
            return aItems.map(function (i) { return i.getBindingContext("huView").getObject(); });
        },

        /** Reads detail (+ serials) for one HU row -> a { header, items, serials } label; serials/materialName live only on the HU, not the list row. */
        _readLabel: function (o) {
            return ODataClient.get(BASE_PATH + "/detail(handlingUnitExternalID=" + q(o.HandlingUnitExternalID) + ",warehouse=" + q(o.Warehouse) + ")")
                .then(function (h) {
                    var p = h.HandlingUnitInternalNumber
                        ? ODataClient.get(BASE_PATH + "/serials(handlingUnitInternalNumber=" + q(h.HandlingUnitInternalNumber) + ")").catch(function () { return {}; })
                        : Promise.resolve({});
                    return p.then(function (s) { return { header: h, items: h.Items || [], serials: s.Items || [] }; });
                });
        },

        _withTimeout: function (oPromise, nMs) {
            return new Promise(function (resolve, reject) {
                var t = setTimeout(function () { reject(new Error("Read timed out after " + (nMs / 1000) + "s")); }, nMs);
                oPromise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
            });
        },

        /** One HU read with a timeout and a single retry; a second failure rejects (the whole job then aborts, nothing prints). */
        _readLabelRetry: function (o) {
            var self = this;
            return self._withTimeout(self._readLabel(o), READ_TIMEOUT)
                .catch(function () { return self._withTimeout(self._readLabel(o), READ_TIMEOUT); });
        },

        /** Reads all rows in chunks of READ_CHUNK (bounded concurrency); reports progress and stops when fnCancelled() turns true. */
        _readLabels: function (aRows, fnProgress, fnCancelled) {
            var self = this;
            var aOut = [];
            function next(i) {
                if (fnCancelled() || i >= aRows.length) { return Promise.resolve(aOut); }
                return Promise.all(aRows.slice(i, i + READ_CHUNK).map(self._readLabelRetry.bind(self)))
                    .then(function (a) {
                        aOut = aOut.concat(a);
                        fnProgress(aOut.length);
                        return next(i + READ_CHUNK);
                    });
            }
            return next(0);
        },

        /** Reads every chosen HU (progress + cancel + timeout/retry), validates, then prints one 4x4 page per valid HU via a hidden iframe. */
        _printRows: function (aRows) {
            if (!aRows.length) { return; }
            var self = this;
            var nTotal = aRows.length;
            var bCancel = false;
            var oDialog = new BusyDialog({
                title: this.getText("huPrintMenu"),
                text: this.getText("huPrintProgress", [0, nTotal]),
                showCancelButton: true,
                cancel: function () { bCancel = true; }
            });
            oDialog.open();
            var tFetch = performance.now();
            this._readLabels(aRows, function (nDone) {
                oDialog.setText(self.getText("huPrintProgress", [nDone, nTotal]));
            }, function () { return bCancel; })
                .then(function (aWrappers) {
                    oDialog.close();
                    if (bCancel) { MessageToast.show(self.getText("huPrintCancelled")); return undefined; }
                    // eslint-disable-next-line no-console
                    console.log("[HU print] fetch " + Math.round(performance.now() - tFetch) + "ms for " + nTotal + " HUs");
                    var tPrint = performance.now();
                    return HuLabelPrinter.printRecords(aWrappers, self._labelTexts()).then(function (oRes) {
                        // eslint-disable-next-line no-console
                        console.log("[HU print] validate+render+dialog " + Math.round(performance.now() - tPrint) + "ms, " + oRes.printed + " labels");
                        self._showPrintSummary(oRes, nTotal);
                    });
                })
                .catch(function (oError) {
                    oDialog.close();
                    MessageBox.error((oError && oError.message) || self.getText("huLoadError"));
                })
                .then(function () { oDialog.destroy(); });
        },

        /** "Printed X of Y" + removed-duplicates note + skipped list (with a CSV download when any were skipped). */
        _showPrintSummary: function (oRes, nRequested) {
            var aSkipped = oRes.skipped || [];
            var sMsg = this.getText("huPrintSummary", [oRes.printed, nRequested]);
            if (oRes.duplicatesRemoved) { sMsg += "\n" + this.getText("huPrintDupes", [oRes.duplicatesRemoved]); }
            if (!aSkipped.length) {
                if (oRes.duplicatesRemoved) { MessageToast.show(sMsg); }
                return; // all good, no skips: the print dialog is enough
            }
            sMsg += "\n" + this.getText("huPrintSkipped", [aSkipped.length]) + "\n" +
                aSkipped.slice(0, 10).map(function (s) { return "• " + (s.huNumber || "(blank)") + " - " + s.reason; }).join("\n");
            var sDownload = this.getText("huPrintDownloadSkipped");
            MessageBox.warning(sMsg, {
                actions: [sDownload, MessageBox.Action.CLOSE],
                emphasizedAction: MessageBox.Action.CLOSE,
                onClose: function (a) { if (a === sDownload) { this._downloadSkipped(aSkipped); } }.bind(this)
            });
        },

        _downloadSkipped: function (aSkipped) {
            var sCsv = "HU Number,Reason\n" + aSkipped.map(function (s) {
                return '"' + String(s.huNumber || "").replace(/"/g, '""') + '","' + String(s.reason).replace(/"/g, '""') + '"';
            }).join("\n");
            var sUrl = URL.createObjectURL(new Blob([sCsv], { type: "text/csv" }));
            var oA = document.createElement("a");
            oA.href = sUrl;
            oA.download = "skipped-handling-units.csv";
            document.body.appendChild(oA);
            oA.click();
            document.body.removeChild(oA);
            setTimeout(function () { URL.revokeObjectURL(sUrl); }, 1000);
        },

        /** Print All: every HU matching the current filters (the full /items set, server-capped at MAX_LIST), with a confirm. */
        onPrintAll: function () {
            var aAll = this.getModel("huView").getProperty("/items") || [];
            var n = aAll.length;
            if (!n) { return; }
            var fnConfirm = function (a) { if (a === MessageBox.Action.OK) { this._printRows(aAll); } }.bind(this);
            if (n > PRINT_SAFE_LIMIT) {
                MessageBox.warning(this.getText("huPrintAllLarge", [n, PRINT_SAFE_LIMIT]), { onClose: fnConfirm });
            } else {
                MessageBox.confirm(this.getText("huPrintAllConfirm", [n]), { onClose: fnConfirm });
            }
        },

        /** Print Selected: only the ticked rows. */
        onPrintSelected: function () {
            this._printRows(this._rowsToObjects(this.byId("huTable").getSelectedItems()));
        },

        /** Print Current Page: only the rows currently rendered (the current growing page). */
        onPrintCurrentPage: function () {
            this._printRows(this._rowsToObjects(this.byId("huTable").getItems()));
        },

        _labelTexts: function () {
            var m = {};
            HuLabelPrinter.TEXT_KEYS.forEach(function (k) { m[k] = this.getText(k); }, this);
            return m;
        },

        onOpenDetail: function (oEvent) {
            var o = oEvent.getSource().getBindingContext("huView").getObject();
            this.getRouter().navTo("wmHandlingUnitDetail", {
                hu: encodeURIComponent(o.HandlingUnitExternalID),
                "?query": { wh: o.Warehouse || "", char32: o.HandlingUnitIDChar32 || "", origin: o.HandlingUnitOrigin || "ERP" }
            });
        },

        // Create HU (CAP action create -> BAPI_HU_CREATE + commit). Plant / SLoc / packaging prefilled from the filter bar.
        onOpenCreate: function () {
            var oView = this.getView();
            var o = this.getModel("huView").getData();
            this.getModel("huCreate").setData({
                packagingMaterial: o.packagingMaterial || "", plant: o.plant || "", storageLocation: o.storageLocation || "",
                content: "", busy: false, error: ""
            });
            if (!this._pCreateDialog) {
                this._pCreateDialog = Fragment.load({
                    id: oView.getId(),
                    name: "saps4hana.fiori.modules.wm.handling-unit.view.CreateHandlingUnitDialog",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }
            this._pCreateDialog.then(function (oDialog) { oDialog.open(); });
        },

        onCancelCreate: function () {
            this._pCreateDialog.then(function (oDialog) { oDialog.close(); });
        },

        onSubmitCreate: function () {
            var oModel = this.getModel("huCreate");
            var o = oModel.getData();
            oModel.setProperty("/busy", true);
            oModel.setProperty("/error", "");
            ODataClient.post(BASE_PATH + "/create", { packagingMaterial: o.packagingMaterial, plant: o.plant, storageLocation: o.storageLocation, content: o.content })
                .then(function (oResult) {
                    MessageToast.show(this.getText("huCreateOk", [oResult.HandlingUnitExternalID]));
                    this._pCreateDialog.then(function (oDialog) { oDialog.close(); });
                    // detail() resolves the monitor key itself, so no char32 is needed for a fresh HU
                    this.getRouter().navTo("wmHandlingUnitDetail", {
                        hu: encodeURIComponent(oResult.HandlingUnitExternalID),
                        "?query": { wh: "", char32: "", origin: "ERP" }
                    });
                }.bind(this))
                .catch(function (oError) {
                    oModel.setProperty("/error", (oError && oError.message) || this.getText("huCreateError"));
                }.bind(this))
                .then(function () { oModel.setProperty("/busy", false); });
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
                    dataSource: that.getModel("huView").getProperty("/items"),
                    fileName: that.getText("huExportFile") + ".xlsx"
                });
                oSheet.build().finally(function () { oSheet.destroy(); });
            });
        }
    });
});
