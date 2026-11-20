function createCreateSalesOrderItemManager(deps) {
    deps = deps || {};
    var SalesOrderModel = deps.SalesOrderModel;
    var SalesOrderService = deps.SalesOrderService;
    var MessageToast = deps.MessageToast;

    return {
        onAddItem: function () {
            var oModel = this.getView().getModel("newOrder");
            var aItems = oModel.getProperty("/items") || [];
            var sPlant = (aItems[0] && aItems[0].Plant) || "";
            var sReqDate = oModel.getProperty("/header/RequestedDeliveryDate");
            var oNewItem = SalesOrderModel.createEmptyItem(aItems.length, sPlant, sReqDate);
            aItems.push(oNewItem);
            oModel.setProperty("/items", aItems);
            SalesOrderModel.calculateTotals(oModel);
            SalesOrderModel.updateStatus(oModel);
        },

        onDeleteItem: function (oEvent) {
            var oModel = this.getView().getModel("newOrder");
            var aItems = oModel.getProperty("/items") || [];
            if (aItems.length <= 1) {
                MessageToast.show("An order requires at least one line item.");
                return;
            }

            var oListItem = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("listItem") : null;
            if (!oListItem) {
                return;
            }
            var oContext = typeof oListItem.getBindingContext === "function" ? oListItem.getBindingContext("newOrder") : null;
            if (!oContext || typeof oContext.getPath !== "function") {
                return;
            }

            var sPath = oContext.getPath();
            var iIndex = parseInt(sPath.split("/").pop(), 10);
            if (isNaN(iIndex) || iIndex < 0 || iIndex >= aItems.length) {
                return;
            }

            aItems.splice(iIndex, 1);
            aItems.forEach(function (itm, idx) {
                itm.SalesOrderItem = String((idx + 1) * 10);
            });

            oModel.setProperty("/items", aItems);
            SalesOrderModel.calculateTotals(oModel);
            SalesOrderModel.validateForm(oModel);
        },

        onItemMaterialChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newOrder");
            if (!oContext) return;

            var sVal = oSource.getValue() ? oSource.getValue().trim() : "";
            var oModel = this.getView().getModel("newOrder");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/Material", sVal);

            if (!sVal) {
                oModel.setProperty(sPath + "/errors/Material", { state: "Error", text: "Material is required" });
                SalesOrderModel.updateStatus(oModel);
                return;
            }

            oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });

            var oSalesOrderModel = (this.getModel && this.getModel("salesOrder")) || null;
            var oPromise = oSalesOrderModel ?
                SalesOrderService.getMaterialDetails(oSalesOrderModel, sVal) :
                SalesOrderService.getMaterialDetails(sVal);

            oPromise.then(function (oMat) {
                if (oMat) {
                    SalesOrderModel.applyMaterialDefaults(oModel, sPath, oMat, true);
                }
                SalesOrderModel.updateStatus(oModel);
            });
        },

        onItemMaterialLiveChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newOrder");
            if (!oContext) return;

            var sVal = oEvent.getParameter("value");
            var oModel = this.getView().getModel("newOrder");
            var sPath = oContext.getPath();

            if (sVal && sVal.trim() !== "") {
                oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
            }
        },

        onItemMaterialSelect: function (oEvent) {
            var oRow = oEvent.getParameter("selectedRow") || oEvent.getParameter("selectedItem");
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newOrder");
            if (!oContext || !oRow) return;

            var oBindingCtx = oRow.getBindingContext("salesOrder") || oRow.getBindingContext();
            var sKey = "";
            if (oBindingCtx && typeof oBindingCtx.getProperty === "function") {
                sKey = oBindingCtx.getProperty("Material") || "";
            }
            if (!sKey) {
                var aCells = oRow.getCells ? oRow.getCells() : [];
                sKey = aCells[0] && aCells[0].getTitle ? aCells[0].getTitle() : (aCells[0] && aCells[0].getText ? aCells[0].getText() : (oRow.getKey ? oRow.getKey() : ""));
            }

            var oModel = this.getView().getModel("newOrder");
            var sPath = oContext.getPath();

            var oMaterialData = null;
            if (oBindingCtx) {
                try {
                    oMaterialData = typeof oBindingCtx.getObject === "function" ? oBindingCtx.getObject() : null;
                } catch (e) {
                    oMaterialData = null;
                }
                if (!oMaterialData || typeof oMaterialData !== "object") {
                    var fnGetProp = typeof oBindingCtx.getProperty === "function" ? oBindingCtx.getProperty.bind(oBindingCtx) : function () { return ""; };
                    oMaterialData = {
                        Material: fnGetProp("Material") || sKey,
                        MaterialName: fnGetProp("MaterialName") || fnGetProp("Material_Text") || "",
                        Material_Text: fnGetProp("Material_Text") || fnGetProp("MaterialName") || "",
                        MaterialBaseUnit: fnGetProp("MaterialBaseUnit") || "",
                        MaterialType: fnGetProp("MaterialType") || "",
                        MaterialGroup: fnGetProp("MaterialGroup") || ""
                    };
                }
            }

            if (oMaterialData && oMaterialData.Material) {
                SalesOrderModel.applyMaterialDefaults(oModel, sPath, oMaterialData, true);
            } else {
                oModel.setProperty(sPath + "/Material", sKey);
                var sDesc = (oRow.getAdditionalText && oRow.getAdditionalText()) || "";
                if (!sDesc && oRow.getCells) {
                    var aCellsDesc = oRow.getCells();
                    sDesc = (aCellsDesc[1] && aCellsDesc[1].getText && aCellsDesc[1].getText()) || "";
                }
                if (sDesc) {
                    oModel.setProperty(sPath + "/SalesOrderItemText", sDesc);
                }
                oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
            }

            var sMatUnit = oMaterialData && (oMaterialData.MaterialBaseUnit || oMaterialData.BaseUnit);
            var sMatDesc = oMaterialData && (oMaterialData.MaterialName || oMaterialData.Material_Text);
            if (!sMatUnit || !sMatDesc) {
                var oSalesOrderModel = (this.getModel && this.getModel("salesOrder")) || null;
                var oDetailsPromise = oSalesOrderModel ?
                    SalesOrderService.getMaterialDetails(oSalesOrderModel, sKey) :
                    SalesOrderService.getMaterialDetails(sKey);
                if (oDetailsPromise && typeof oDetailsPromise.then === "function") {
                    oDetailsPromise.then(function (oMat) {
                        if (oMat) {
                            SalesOrderModel.applyMaterialDefaults(oModel, sPath, oMat, true);
                            SalesOrderModel.updateStatus(oModel);
                        }
                    });
                }
            }

            SalesOrderModel.updateStatus(oModel);
        },

        onItemCalculationChange: function (oEvent) {
            var oSource = oEvent && typeof oEvent.getSource === "function" ? oEvent.getSource() : null;
            if (oSource) {
                var oContext = oSource.getBindingContext("newOrder");
                if (oContext) {
                    var sPath = oContext.getPath();
                    var sVal = oSource.getValue();
                    var sProp = oSource.getBindingPath("value");
                    if (sProp) {
                        var oModel = this.getView().getModel("newOrder");
                        oModel.setProperty(sPath + "/" + sProp, sVal);
                    }
                }
            }
            var oModelTotals = this.getView().getModel("newOrder");
            SalesOrderModel.calculateTotals(oModelTotals);
            SalesOrderModel.updateStatus(oModelTotals);
        },

        onItemFieldChange: function () {
            var oModel = this.getView().getModel("newOrder");
            SalesOrderModel.updateStatus(oModel);
        },

        onItemUnitSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newOrder");
            if (!oContext || !oItem) return;

            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/OrderQuantityUnit", sKey);
            oModel.setProperty(sPath + "/errors/OrderQuantityUnit", { state: "None", text: "" });
            this.onItemFieldChange();
        },

        onItemPlantChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newOrder");
            if (!oContext) return;

            var sVal = oSource.getValue() ? oSource.getValue().trim().toUpperCase() : "";
            var oModel = this.getView().getModel("newOrder");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/Plant", sVal);

            if (!sVal) {
                oModel.setProperty(sPath + "/errors/Plant", { state: "Error", text: "Plant is required for each line item" });
            } else if (sVal.length > 4) {
                oModel.setProperty(sPath + "/errors/Plant", { state: "Error", text: "Plant cannot exceed 4 characters" });
            } else {
                oModel.setProperty(sPath + "/errors/Plant", { state: "None", text: "" });
            }
            SalesOrderModel.updateStatus(oModel);
        },

        onItemPlantLiveChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newOrder");
            if (!oContext) return;

            var sVal = oEvent.getParameter("value");
            var oModel = this.getView().getModel("newOrder");
            var sPath = oContext.getPath();

            if (sVal && sVal.trim() !== "") {
                if (sVal.trim().length <= 4) {
                    oModel.setProperty(sPath + "/errors/Plant", { state: "None", text: "" });
                }
            }
        },

        onItemPlantSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newOrder");
            if (!oContext || !oItem) return;

            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/Plant", sKey);
            oModel.setProperty(sPath + "/errors/Plant", { state: "None", text: "" });
            SalesOrderModel.updateStatus(oModel);
        }
    };
}

var oExports = {
    createCreateSalesOrderItemManager: createCreateSalesOrderItemManager
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
