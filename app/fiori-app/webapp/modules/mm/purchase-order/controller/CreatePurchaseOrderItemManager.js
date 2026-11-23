function createCreatePurchaseOrderItemManager(deps) {
    deps = deps || {};
    var PurchaseOrderModel = deps.PurchaseOrderModel;
    var PurchaseOrderService = deps.PurchaseOrderService;

    return {
        onItemMaterialChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newPO");
            if (!oContext) return;

            var sVal = oSource.getValue();
            var oModel = this.getView().getModel("newPO");
            var sPath = oContext.getPath();
            var sPlant = oModel.getProperty(sPath + "/Plant") || "";

            if (!sVal || sVal.trim() === "") {
                oModel.setProperty(sPath + "/errors/Material", {
                    state: "Error",
                    text: this.getText("poValMaterialRequired", null, "Material is required")
                });
            } else {
                oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
                var that = this;
                var oPoModel = this.getModel();
                PurchaseOrderService.getMaterialDetails(oPoModel, sVal, sPlant).then(function (oMaterial) {
                    if (oMaterial) {
                        PurchaseOrderModel.applyMaterialDefaults(oModel, sPath, oMaterial, true);
                        that.onItemFieldChange();
                    }
                });
            }
            this.onItemFieldChange();
        },

        onItemMaterialSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newPO");
            if (!oContext || !oItem) return;

            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newPO");
            var sPath = oContext.getPath();
            var sPlant = oModel.getProperty(sPath + "/Plant") || "";

            var oBindingCtx = oItem.getBindingContext();
            var oMaterialData = null;
            if (oBindingCtx) {
                try {
                    oMaterialData = oBindingCtx.getObject();
                } catch (e) {
                    oMaterialData = null;
                }
                if (!oMaterialData || typeof oMaterialData !== "object") {
                    oMaterialData = {
                        Material: oBindingCtx.getProperty("Material") || sKey,
                        MaterialName: oBindingCtx.getProperty("MaterialName") || oBindingCtx.getProperty("Material_Text") || "",
                        MaterialBaseUnit: oBindingCtx.getProperty("MaterialBaseUnit"),
                        Plant: oBindingCtx.getProperty("Plant"),
                        MaterialGroup: oBindingCtx.getProperty("MaterialGroup")
                    };
                }
            }

            if (oMaterialData && oMaterialData.Material) {
                PurchaseOrderModel.applyMaterialDefaults(oModel, sPath, oMaterialData, true);
            } else {
                oModel.setProperty(sPath + "/Material", sKey);
                oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
            }

            var that = this;
            if (!oMaterialData || !oMaterialData.MaterialBaseUnit || !oMaterialData.MaterialGroup) {
                var oPoModel = this.getModel();
                PurchaseOrderService.getMaterialDetails(oPoModel, sKey, sPlant).then(function (oMat) {
                    if (oMat) {
                        PurchaseOrderModel.applyMaterialDefaults(oModel, sPath, oMat, true);
                        that.onItemFieldChange();
                    }
                });
            }

            this.onItemFieldChange();
        },

        onItemFieldChange: function () {
            var oModel = this.getView().getModel("newPO");
            PurchaseOrderModel.updateStatus(oModel);
            if (oModel.getProperty("/hasError")) {
                PurchaseOrderModel.validateForm(oModel);
            }
        },

        onAddItem: function () {
            var oModel = this.getView().getModel("newPO");
            var sUser = PurchaseOrderModel.getCurrentUserName(this.getOwnerComponent());
            PurchaseOrderModel.addItem(oModel, sUser);
            PurchaseOrderModel.updateStatus(oModel);
            if (oModel.getProperty("/hasError")) {
                PurchaseOrderModel.validateForm(oModel);
            }
        },

        onDeleteItem: function (oEvent) {
            var oItem = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("listItem") : null;
            if (!oItem) return;
            var oContext = typeof oItem.getBindingContext === "function" ? oItem.getBindingContext("newPO") : null;
            if (!oContext || typeof oContext.getPath !== "function") return;

            var sPath = oContext.getPath();
            var aParts = sPath ? sPath.split("/") : [];
            var iIndex = aParts.length > 2 ? parseInt(aParts[2], 10) : NaN;
            if (isNaN(iIndex) || iIndex < 0) return;

            var oModel = this.getView().getModel("newPO");
            PurchaseOrderModel.deleteItem(oModel, iIndex);
            PurchaseOrderModel.updateStatus(oModel);
            if (oModel.getProperty("/hasError")) {
                PurchaseOrderModel.validateForm(oModel);
            }
        },

        onCalculateNetAmount: function (oEvent) {
            var oSource = oEvent && typeof oEvent.getSource === "function" ? oEvent.getSource() : null;
            var oContext = oSource && typeof oSource.getBindingContext === "function" ? oSource.getBindingContext("newPO") : null;
            if (!oContext || typeof oContext.getPath !== "function") return;

            var sPath = oContext.getPath();
            var oModel = this.getView().getModel("newPO");

            PurchaseOrderModel.calculateItemNetAmount(oModel, sPath);
            PurchaseOrderModel.updateStatus(oModel);
            if (oModel.getProperty("/hasError")) {
                PurchaseOrderModel.validateForm(oModel);
            }
        }
    };
}

var oExports = {
    createCreatePurchaseOrderItemManager: createCreatePurchaseOrderItemManager
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
