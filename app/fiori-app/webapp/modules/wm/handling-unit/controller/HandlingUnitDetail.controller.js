sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient"
], function (BaseController, JSONModel, ODataClient) {
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
                tree: []
            }), "huDetail");
            this.getModel("huDetail").setSizeLimit(5000);
            this.getRouter().getRoute("wmHandlingUnitDetail").attachPatternMatched(this.onRouteMatched, this);
        },

        onRouteMatched: function (oEvent) {
            var oArgs = oEvent.getParameter("arguments");
            var sHu = decodeURIComponent(oArgs.hu);
            var oQuery = oArgs["?query"] || {};
            var oModel = this.getModel("huDetail");
            var q = function (s) { return "'" + encodeURIComponent((s || "").trim().replace(/'/g, "''")) + "'"; };

            oModel.setData({ busy: true, message: "", messageType: "Information", header: {}, items: [], tree: [] });

            ODataClient.get(BASE_PATH + "/detail(handlingUnitExternalID=" + q(sHu) + ",warehouse=" + q(oQuery.wh) + ")")
                .then(function (oResult) {
                    oModel.setProperty("/header", oResult);
                    oModel.setProperty("/items", oResult.Items || []);
                }).catch(function (oError) {
                    oModel.setProperty("/messageType", "Error");
                    oModel.setProperty("/message", (oError && oError.message) || this.getText("huLoadError"));
                }.bind(this)).then(function () {
                    // char32 the packing tree needs: from the URL query on navigation, else resolved by detail()
                    // from the monitor so a direct link / refresh still loads the tree.
                    var sChar32 = oQuery.char32 || oModel.getProperty("/header/HandlingUnitIDChar32");
                    var sOrigin = oQuery.origin || oModel.getProperty("/header/HandlingUnitOrigin") || "ERP";
                    if (!sChar32) {
                        oModel.setProperty("/busy", false);
                        return null;
                    }
                    return ODataClient.get(BASE_PATH + "/hierarchy(handlingUnitIDChar32=" + q(sChar32) + ",handlingUnitOrigin=" + q(sOrigin) + ")")
                        .then(function (oHier) {
                            oModel.setProperty("/tree", buildTree(oHier.Nodes));
                        }).catch(function () {
                            // Header already shown; a tree failure must not blank the page.
                        }).then(function () {
                            oModel.setProperty("/busy", false);
                        });
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
