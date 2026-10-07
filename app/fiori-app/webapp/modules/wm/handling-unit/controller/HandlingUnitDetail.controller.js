sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "sap/ui/core/Fragment",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelPrinter"
], function (BaseController, JSONModel, ODataClient, Fragment, MessageToast, MessageBox, HuLabelPrinter) {
    "use strict";

    var BASE_PATH = "/odata/v4/handling-unit";

    /** Flat [{Node, ParentNode, ...}] -> nested roots with a children[] array for the TreeTable. */
    function buildTree(aNodes) {
        var mById = {};
        var aRoots = [];
        (aNodes || []).forEach(function (n) {
            mById[n.Node] = Object.assign({ children: [] }, n);
        });
        (aNodes || []).forEach(function (n) {
            var oNode = mById[n.Node];
            var oParent = n.ParentNode && mById[n.ParentNode];
            if (oParent) {
                oParent.children.push(oNode);
            } else {
                aRoots.push(oNode);
            }
        });
        return aRoots;
    }

    return BaseController.extend("saps4hana.fiori.modules.wm.handling-unit.controller.HandlingUnitDetail", {

        onInit: function () {
            this.setModel(new JSONModel({
                busy: false,
                message: "",
                messageType: "Information",
                header: {},
                items: [],
                tree: [],
                serials: []
            }), "huDetail");
            this.getModel("huDetail").setSizeLimit(5000);
            this.setModel(new JSONModel({ material: "", quantity: "", unit: "", batch: "", plant: "", storageLocation: "", busy: false, error: "" }), "huPack");
            this.getRouter().getRoute("wmHandlingUnitDetail").attachPatternMatched(this.onRouteMatched, this);
        },

        /** Prints the loaded handling unit as a browser-rendered 4x4 label (via a hidden iframe). */
        onPrint: function () {
            var o = this.getModel("huDetail").getData();
            HuLabelPrinter.printRecords([{ header: o.header, items: o.items, serials: o.serials || [] }], this._labelTexts())
                .catch(function (oError) {
                    MessageBox.error((oError && oError.message) || this.getText("huLoadError"));
                }.bind(this));
        },

        _labelTexts: function () {
            var m = {};
            HuLabelPrinter.TEXT_KEYS.forEach(function (k) { m[k] = this.getText(k); }, this);
            return m;
        },

        onRouteMatched: function (oEvent) {
            var oArgs = oEvent.getParameter("arguments");
            this._sHu = decodeURIComponent(oArgs.hu);
            this._oQuery = oArgs["?query"] || {};
            this._load();
        },

        /** (Re)loads header, items, tree and serials for the current HU; called on route match and after every write. */
        _load: function () {
            var sHu = this._sHu;
            var oQuery = this._oQuery;
            var oModel = this.getModel("huDetail");
            var q = function (s) { return "'" + encodeURIComponent((s || "").trim().replace(/'/g, "''")) + "'"; };

            oModel.setData({ busy: true, message: "", messageType: "Information", header: {}, items: [], tree: [], serials: [] });

            ODataClient.get(BASE_PATH + "/detail(handlingUnitExternalID=" + q(sHu) + ",warehouse=" + q(oQuery.wh) + ")")
                .then(function (oResult) {
                    oModel.setProperty("/header", oResult);
                    oModel.setProperty("/items", oResult.Items || []);
                }).catch(function (oError) {
                    oModel.setProperty("/messageType", "Error");
                    oModel.setProperty("/message", (oError && oError.message) || this.getText("huLoadError"));
                }.bind(this)).then(function () {
                    var oHeader = oModel.getProperty("/header") || {};
                    // char32 the packing tree needs: from the URL query on navigation, else resolved by detail()
                    // from the monitor so a direct link / refresh still loads the tree.
                    var sChar32 = oQuery.char32 || oHeader.HandlingUnitIDChar32;
                    var sOrigin = oQuery.origin || oHeader.HandlingUnitOrigin || "ERP";
                    var sVenum = oHeader.HandlingUnitInternalNumber;
                    var aTasks = [];
                    if (sChar32) {
                        aTasks.push(ODataClient.get(BASE_PATH + "/hierarchy(handlingUnitIDChar32=" + q(sChar32) + ",handlingUnitOrigin=" + q(sOrigin) + ")")
                            .then(function (oHier) { oModel.setProperty("/tree", buildTree(oHier.Nodes)); })
                            .catch(function () { /* tree failure must not blank the page */ }));
                    }
                    if (sVenum) {
                        aTasks.push(ODataClient.get(BASE_PATH + "/serials(handlingUnitInternalNumber=" + q(sVenum) + ")")
                            .then(function (oSer) { oModel.setProperty("/serials", oSer.Items || []); })
                            .catch(function () { /* serials via RFC are optional; detail stays usable without them */ }));
                    }
                    return Promise.all(aTasks).then(function () { oModel.setProperty("/busy", false); });
                });
        },

        _afterWrite: function (sTextKey, aArgs) {
            MessageToast.show(this.getText(sTextKey, aArgs));
            this._load();
        },

        _writeError: function (oError) {
            var oModel = this.getModel("huDetail");
            oModel.setProperty("/busy", false);
            oModel.setProperty("/messageType", "Error");
            oModel.setProperty("/message", (oError && oError.message) || this.getText("huActionError"));
        },

        // Pack item (CAP action pack -> BAPI_HU_PACK + commit). Plant / SLoc prefilled from the header, else the first item.
        onOpenPack: function () {
            var oView = this.getView();
            var oHeader = this.getModel("huDetail").getProperty("/header") || {};
            var oFirst = (this.getModel("huDetail").getProperty("/items") || [])[0] || {};
            this.getModel("huPack").setData({
                material: "", quantity: "", unit: oFirst.Unit || "", batch: "",
                plant: oHeader.Plant || oFirst.Plant || "", storageLocation: oHeader.StorageLocation || oFirst.StorageLocation || "",
                busy: false, error: ""
            });
            if (!this._pPackDialog) {
                this._pPackDialog = Fragment.load({
                    id: oView.getId(),
                    name: "saps4hana.fiori.modules.wm.handling-unit.view.PackHandlingUnitItemDialog",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }
            this._pPackDialog.then(function (oDialog) { oDialog.open(); });
        },

        onCancelPack: function () {
            this._pPackDialog.then(function (oDialog) { oDialog.close(); });
        },

        onSubmitPack: function () {
            var oModel = this.getModel("huPack");
            var o = oModel.getData();
            oModel.setProperty("/busy", true);
            oModel.setProperty("/error", "");
            ODataClient.post(BASE_PATH + "/pack", {
                handlingUnitExternalID: this._sHu, material: o.material, quantity: Number(o.quantity), unit: o.unit,
                batch: o.batch, plant: o.plant, storageLocation: o.storageLocation
            }).then(function () {
                this._pPackDialog.then(function (oDialog) { oDialog.close(); });
                this._afterWrite("huPackOk", [o.quantity, o.unit, o.material]);
            }.bind(this)).catch(function (oError) {
                oModel.setProperty("/error", (oError && oError.message) || this.getText("huPackError"));
            }.bind(this)).then(function () { oModel.setProperty("/busy", false); });
        },

        // Unpack one item row (CAP action unpack -> BAPI_HU_UNPACK + commit), after confirmation.
        onUnpack: function (oEvent) {
            var oRow = oEvent.getSource().getBindingContext("huDetail").getObject();
            var oHeader = this.getModel("huDetail").getProperty("/header") || {};
            var that = this;
            MessageBox.confirm(this.getText("huUnpackConfirm", [oRow.Quantity, oRow.Unit, oRow.Material]), {
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) { return; }
                    that.getModel("huDetail").setProperty("/busy", true);
                    ODataClient.post(BASE_PATH + "/unpack", {
                        handlingUnitExternalID: that._sHu, item: String(oRow.HandlingUnitItem), material: oRow.Material,
                        quantity: oRow.Quantity, unit: oRow.Unit, batch: oRow.Batch || "",
                        plant: oRow.Plant || oHeader.Plant, storageLocation: oRow.StorageLocation || oHeader.StorageLocation
                    }).then(function () {
                        that._afterWrite("huUnpackOk", [oRow.Material]);
                    }).catch(that._writeError.bind(that));
                }
            });
        },

        // Delete the (empty) HU (CAP action remove -> BAPI_HU_DELETE + commit), after a warning; then back to the list.
        onDelete: function () {
            var that = this;
            MessageBox.warning(this.getText("huDeleteConfirm", [this._sHu]), {
                actions: [MessageBox.Action.DELETE, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.DELETE,
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.DELETE) { return; }
                    that.getModel("huDetail").setProperty("/busy", true);
                    ODataClient.post(BASE_PATH + "/remove", { handlingUnitExternalID: that._sHu }).then(function () {
                        MessageToast.show(that.getText("huDeleteOk", [that._sHu]));
                        that.getModel("huDetail").setProperty("/busy", false);
                        // replace the history entry: browser Back must not reopen the deleted HU (SAP would answer 404)
                        that.getRouter().navTo("wmHandlingUnits", {}, true);
                    }).catch(that._writeError.bind(that));
                }
            });
        },

        onExpandAll: function () {
            this.byId("huTree").expandToLevel(99);
        },

        onCollapseAll: function () {
            this.byId("huTree").collapseAll();
        }
        // Back navigation is owned by the ShellBar (App.controller.onNavButtonPressed → wmHandlingUnits).
    });
});
