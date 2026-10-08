sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "saps4hana/fiori/service/BarcodeScanService",
    "saps4hana/fiori/modules/wm/mvt261/model/ScanSession",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (BaseController, JSONModel, ODataClient, BarcodeScanService, ScanSession, MessageBox, MessageToast) {
    "use strict";

    var BASE_PATH = "/odata/v4/mvt261";
    var q = function (s) { return "'" + encodeURIComponent(String(s)) + "'"; };

    /**
     * 261 scan screen: scan and validate storage units against a reservation item, and post goods issue.
     */
    return BaseController.extend("saps4hana.fiori.modules.wm.mvt261.controller.Scan261", {

        onInit: function () {
            this.setModel(new JSONModel({ busy: false, error: "", ctx: null, rows: [], units: [], scan: "", state: "Loaded", total: 0, drums: 0, deviations: 0, percent: 0, noSuStock: false, message: "", messageType: "Information" }), "scan261View");
            this._onHardwareScan = this._onHardwareScan.bind(this);
            this.getRouter().getRoute("wmScan261").attachPatternMatched(this._onRoute, this);
            this.getRouter().attachRouteMatched(function (oEvent) {
                if (oEvent.getParameter("name") !== "wmScan261") { BarcodeScanService.detachHardwareScanner(); }
            });
        },

        onExit: function () {
            BarcodeScanService.detachHardwareScanner();
        },

        formatWarnings: function (aWarnings, sSloc, sBin) {
            var oCtx = this.getModel("scan261View").getProperty("/ctx") || {};
            return (aWarnings || []).map(function (sCode) {
                return this.getText("scan261Warn_" + sCode, sCode === "storageLocationDiffers" ? [sSloc, oCtx.StorageLocation] : [sBin, oCtx.ProductionOrder]);
            }.bind(this)).join(" ");
        },

        formatNotes: function (bAccepted, aWarnings, sSloc, sBin, sReason, sValue1, sValue2, bFifo, sOlder, sOlderDate, nOlderQty, sUnit) {
            if (!bAccepted) { return this.formatReason(sReason, sValue1, sValue2); }
            return [bFifo ? this.getText("scan261FifoOlder", [sOlder, sOlderDate, nOlderQty, sUnit]) : "", this.formatWarnings(aWarnings, sSloc, sBin)].filter(Boolean).join(" ");
        },

        formatUnitStatus: function (sStatus) {
            return sStatus ? this.getText("scan261Unit_" + sStatus) : "";
        },

        formatUnitState: function (sStatus) {
            return { Available: "Success", Scanned: "Information", OnHold: "Warning", Blocked: "Error" }[sStatus] || "None";
        },

        formatReason: function (sReason, sValue1, sValue2) {
            return sReason ? this.getText("scan261Reject_" + sReason, [sValue1, sValue2]) : "";
        },

        formatMessage: function (sKey, v1, v2, v3, v4) {
            return sKey ? this.getText(sKey, [v1, v2, v3, v4]) : "";
        },

        _onRoute: function (oEvent) {
            this._args = oEvent.getParameter("arguments");
            this._load();
        },

        /** (Re)loads the scan context from SAP and resets the scanned rows. Used on route match and
         *  after a successful post, so the open quantity and stock are always the live SAP values. */
        _load: function () {
            var oModel = this.getModel("scan261View");
            var oArgs = this._args;
            oModel.setData({ busy: true, error: "", ctx: null, rows: [], units: [], scan: "", state: "Loaded", total: 0, drums: 0, deviations: 0, percent: 0, noSuStock: false, message: "", messageType: "Information" });
            return ODataClient.get(BASE_PATH + "/scanContext(reservation=" + q(oArgs.reservation) + ",item=" + q(oArgs.item) + ")").then(function (oCtx) {
                oModel.setProperty("/ctx", oCtx);
                oModel.setProperty("/noSuStock", oCtx.QuantCount > 0 && oCtx.StorageUnitQuantCount === 0);
                this._refresh();
                if (!oCtx.Blocked) {
                    BarcodeScanService.attachHardwareScanner(this._onHardwareScan);
                    this._focus();
                }
            }.bind(this)).catch(function (oError) {
                oModel.setProperty("/error", (oError && oError.message) || this.getText("mvt261LoadError"));
            }.bind(this)).then(function () {
                oModel.setProperty("/busy", false);
            });
        },

        _refresh: function () {
            var oModel = this.getModel("scan261View");
            var oCtx = oModel.getProperty("/ctx");
            var aRows = oModel.getProperty("/rows");
            var nTotal = ScanSession.total(aRows);
            oModel.setProperty("/total", nTotal);
            oModel.setProperty("/drums", ScanSession.drums(aRows));
            oModel.setProperty("/deviations", ScanSession.deviations(aRows));
            oModel.setProperty("/units", ScanSession.units(oCtx, aRows));
            oModel.setProperty("/percent", oCtx && oCtx.OpenQuantity > 0 ? Math.min(100, nTotal / oCtx.OpenQuantity * 100) : 0);
            oModel.setProperty("/state", ScanSession.state(oCtx, aRows));
        },

        _focus: function () {
            var oInput = this.byId("scan261Input");
            setTimeout(function () { if (oInput) { oInput.focus(); } }, 100);
        },

        _reject: function (oRejection) {
            var oModel = this.getModel("scan261View");
            oModel.setProperty("/messageType", "Error");
            oModel.setProperty("/message", this.formatReason(oRejection.Reason, oRejection.Value1, oRejection.Value2));
        },

        /** Wedge / DataWedge scans arriving while the scan field does not have the focus. */
        _onHardwareScan: function (sBarcode) {
            var oInput = this.byId("scan261Input");
            if (oInput && document.activeElement === oInput.getFocusDomRef()) { return; }
            this._scan(sBarcode);
        },

        onScan: function () {
            this._scan(this.getModel("scan261View").getProperty("/scan"));
        },

        _scan: function (sValue) {
            var oModel = this.getModel("scan261View");
            var oCtx = oModel.getProperty("/ctx");
            var sUnit = String(sValue || "").trim().replace(/^0+(?=\d)/, "");
            oModel.setProperty("/scan", "");
            if (!sUnit || oModel.getProperty("/busy")) { this._focus(); return; }

            var oRejection = ScanSession.precheck(oCtx, oModel.getProperty("/rows"), sUnit);
            if (oRejection) { this._reject(oRejection); this._focus(); return; }

            oModel.setProperty("/busy", true);
            ODataClient.get(BASE_PATH + "/checkStorageUnit(reservation=" + q(this._args.reservation) + ",item=" + q(this._args.item) + ",storageUnit=" + q(sUnit) + ")").then(function (oResult) {
                var oNext = ScanSession.add(oCtx, oModel.getProperty("/rows"), oResult);
                oModel.setProperty("/rows", oNext.rows);
                this._refresh();
                if (oNext.rejection) {
                    this._reject(oNext.rejection);
                } else {
                    oModel.setProperty("/messageType", oNext.older ? "Warning" : "Success");
                    oModel.setProperty("/message", this.getText("scan261Accepted", [oResult.StorageUnit]) + (oNext.older
                        ? " " + this.getText("scan261FifoOlder", [oNext.older.StorageUnit, oNext.older.GoodsReceiptDate, oNext.older.Quantity, oNext.older.Unit]) : ""));
                }
            }.bind(this)).catch(function (oError) {
                oModel.setProperty("/messageType", "Error");
                oModel.setProperty("/message", (oError && oError.message) || this.getText("mvt261LoadError"));
            }.bind(this)).then(function () {
                oModel.setProperty("/busy", false);
                this._focus();
            }.bind(this));
        },

        _index: function (oEvent) {
            return Number(oEvent.getSource().getBindingContext("scan261View").getPath().split("/").pop());
        },

        onQuantityChange: function (oEvent) {
            var oModel = this.getModel("scan261View");
            oModel.setProperty("/rows", ScanSession.setQuantity(oModel.getProperty("/ctx"), oModel.getProperty("/rows"), this._index(oEvent), oEvent.getParameter("value")));
            this._refresh();
        },

        onRemove: function (oEvent) {
            var oModel = this.getModel("scan261View");
            oModel.setProperty("/rows", ScanSession.remove(oModel.getProperty("/rows"), this._index(oEvent)));
            this._refresh();
            this._focus();
        },

        onClearAll: function () {
            var oModel = this.getModel("scan261View");
            oModel.setProperty("/rows", []);
            oModel.setProperty("/message", "");
            this._refresh();
            this._focus();
        },

        onShowCycle: function () {
            this.getRouter().navTo("wmCycle261", this._args);
        },

        onPost: function () {
            var oModel = this.getModel("scan261View");
            var oCtx = oModel.getProperty("/ctx");
            var aRows = oModel.getProperty("/rows") || [];
            var nTotal = ScanSession.total(aRows);
            if (!oCtx || oCtx.Blocked || nTotal <= 0 || oModel.getProperty("/busy")) {
                return;
            }

            // F13 guard: the post sends one batch for the whole quantity, so a scan spanning more than
            // one batch would mis-post. Block it and tell the operator to post one batch at a time.
            var aBatches = [];
            for (var i = 0; i < aRows.length; i++) {
                if (aRows[i].Accepted) {
                    var sB = aRows[i].Batch || "";
                    if (aBatches.indexOf(sB) < 0) { aBatches.push(sB); }
                }
            }
            if (aBatches.length > 1) {
                MessageBox.error(this.getText("scan261MultiBatch"));
                return;
            }
            var sBatch = aBatches[0] || "";

            // Confirmation first; the actual post runs only after the operator confirms.
            MessageBox.confirm(this.getText("scan261PostConfirm", [nTotal, oCtx.Unit, oCtx.Reservation, oCtx.ReservationItem]), {
                title: this.getText("scan261PostTitle"),
                actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.OK,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) { this._doPost(nTotal, sBatch); }
                }.bind(this)
            });
        },

        /** Posts the goods issue. The scan field and Post button are disabled via the busy flag while
         *  the request is in flight; on success the context is reloaded so the next partial post is live. */
        _doPost: function (nTotal, sBatch) {
            var oModel = this.getModel("scan261View");
            var oCtx = oModel.getProperty("/ctx");
            oModel.setProperty("/busy", true);
            ODataClient.post(BASE_PATH + "/postGoodsIssue", {
                reservation: String(oCtx.Reservation),
                item: String(oCtx.ReservationItem),
                quantity: nTotal,
                batch: sBatch || undefined
            }).then(function (oRes) {
                if (oRes && (oRes.Pending || (!oRes.MaterialDocument && oRes.DeliveryNumber))) {
                    // WM-managed location: SAP created an outbound delivery; PGI still has to be posted.
                    MessageBox.warning(oRes.Message || this.getText("scan261PostDelivery", [oRes.DeliveryNumber]), { onClose: function () { this._load(); }.bind(this) });
                    return;
                }
                var sDoc = oRes.MaterialDocument + (oRes.MaterialDocumentYear ? "/" + oRes.MaterialDocumentYear : "");
                MessageToast.show(this.getText("scan261PostSuccess", [sDoc]));
                this._load();
            }.bind(this)).catch(function (oError) {
                this._handlePostError(oError);
            }.bind(this)).then(function () {
                oModel.setProperty("/busy", false);
            });
        },

        /** Maps a failed post to the right dialog: 409 in-progress (info + refresh), 422 actionable
         *  error, and an unknown outcome (network / timeout) that must NOT be blindly retried. */
        _handlePostError: function (oError) {
            var iStatus = oError && oError.status;
            if (!iStatus || iStatus === 502 || iStatus === 504) {
                // Unknown outcome: no HTTP status (browser/network drop) or a gateway/timeout status
                // (502/504 = the CAP->SAP call timed out). The post may or may not have reached SAP -
                // do not offer a blind retry; tell the operator to check the document list.
                MessageBox.warning(this.getText("scan261PostUnknown"));
                return;
            }
            if (iStatus === 409) {
                var sRefresh = this.getText("scan261Refresh");
                MessageBox.information(this.getText("scan261PostInProgress"), {
                    actions: [sRefresh, MessageBox.Action.CLOSE],
                    emphasizedAction: sRefresh,
                    onClose: function (sAction) { if (sAction === sRefresh) { this._load(); } }.bind(this)
                });
                return;
            }
            // 422 (and any other server error): show the actionable reason the service returned.
            MessageBox.error((oError && oError.message) || this.getText("scan261PostFailed"));
        }
    });
});
