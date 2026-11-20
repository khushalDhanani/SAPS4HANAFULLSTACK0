function createCreateSalesInquiryItemManager(deps) {
    deps = deps || {};
    var SalesInquiryModel = deps.SalesInquiryModel;
    var SalesInquiryService = deps.SalesInquiryService;

    return {
        onAddItem: function () {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.addItem(oModel);
        },

        onDeleteItem: function (oEvent) {
            var oItem = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("listItem") : null;
            if (!oItem) {
                return;
            }
            var oContext = typeof oItem.getBindingContext === "function" ? oItem.getBindingContext("newInquiry") : null;
            if (!oContext || typeof oContext.getPath !== "function") {
                return;
            }
            var sPath = oContext.getPath();
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.deleteItem(oModel, sPath);
        },

        onItemMaterialChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newInquiry");
            if (!oContext) return;

            var sVal = oSource.getValue();
            var oModel = this.getView().getModel("newInquiry");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/Material", sVal);

            if (!sVal || sVal.trim() === "") {
                oModel.setProperty(sPath + "/errors/Material", { state: "Error", text: "Material is required" });
            } else {
                oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
                var oSalesInquiryModel = (this.getModel && this.getModel("salesInquiry")) || null;
                var oChangePromise = oSalesInquiryModel ?
                    SalesInquiryService.getMaterialDetails(oSalesInquiryModel, sVal) :
                    SalesInquiryService.getMaterialDetails(sVal);
                if (oChangePromise && typeof oChangePromise.then === "function") {
                    oChangePromise.then(function (oMaterial) {
                        if (oMaterial) {
                            SalesInquiryModel.applyMaterialDefaults(oModel, sPath, oMaterial, true);
                            SalesInquiryModel.updateStatus(oModel);
                        }
                    });
                }
            }
            SalesInquiryModel.updateStatus(oModel);
        },

        onItemMaterialLiveChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newInquiry");
            if (!oContext) return;

            var sVal = oEvent.getParameter("value");
            var oModel = this.getView().getModel("newInquiry");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/Material", sVal);
            if (sVal && sVal.trim() !== "") {
                oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
            }
        },

        onItemMaterialSelect: function (oEvent) {
            var oRow = oEvent.getParameter("selectedRow") || oEvent.getParameter("selectedItem");
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newInquiry");
            if (!oContext || !oRow) return;

            var oBindingCtx = oRow.getBindingContext("salesInquiry") || oRow.getBindingContext();
            var sKey = "";
            if (oBindingCtx && typeof oBindingCtx.getProperty === "function") {
                sKey = oBindingCtx.getProperty("Material") || "";
            }
            if (!sKey) {
                var aCells = oRow.getCells ? oRow.getCells() : [];
                sKey = aCells[0] && aCells[0].getTitle ? aCells[0].getTitle() : (aCells[0] && aCells[0].getText ? aCells[0].getText() : (oRow.getKey ? oRow.getKey() : (oRow.getText ? oRow.getText() : "")));
            }

            var oModel = this.getView().getModel("newInquiry");
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
                SalesInquiryModel.applyMaterialDefaults(oModel, sPath, oMaterialData, true);
            } else {
                oModel.setProperty(sPath + "/Material", sKey);
                var sDesc = (oRow.getAdditionalText && oRow.getAdditionalText()) || "";
                if (!sDesc && oRow.getCells) {
                    var aCellsDesc = oRow.getCells();
                    sDesc = (aCellsDesc[1] && aCellsDesc[1].getText && aCellsDesc[1].getText()) || "";
                }
                if (sDesc) {
                    oModel.setProperty(sPath + "/SalesInquiryItemText", sDesc);
                }
                oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
            }

            var sMatUnit = oMaterialData && (oMaterialData.MaterialBaseUnit || oMaterialData.BaseUnit);
            var sMatDesc = oMaterialData && (oMaterialData.MaterialName || oMaterialData.Material_Text);
            if (!sMatUnit || !sMatDesc) {
                var oSalesInquiryModel = (this.getModel && this.getModel("salesInquiry")) || null;
                var oDetailsPromise = oSalesInquiryModel ?
                    SalesInquiryService.getMaterialDetails(oSalesInquiryModel, sKey) :
                    SalesInquiryService.getMaterialDetails(sKey);
                if (oDetailsPromise && typeof oDetailsPromise.then === "function") {
                    oDetailsPromise.then(function (oMat) {
                        if (oMat) {
                            SalesInquiryModel.applyMaterialDefaults(oModel, sPath, oMat, true);
                            SalesInquiryModel.updateStatus(oModel);
                        }
                    });
                }
            }

            SalesInquiryModel.updateStatus(oModel);
        },

        onItemCalculationChange: function (oEvent) {
            var oSource = oEvent && typeof oEvent.getSource === "function" ? oEvent.getSource() : null;
            if (oSource) {
                var oContext = oSource.getBindingContext("newInquiry");
                if (oContext) {
                    var sPath = oContext.getPath();
                    var sVal = oSource.getValue();
                    var sProp = oSource.getBindingPath("value");
                    if (sProp) {
                        var oModel = this.getView().getModel("newInquiry");
                        oModel.setProperty(sPath + "/" + sProp, sVal);
                    }
                }
            }
            var oCurrentModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.calculateTotals(oCurrentModel);
            SalesInquiryModel.updateStatus(oCurrentModel);
        },

        onItemFieldChange: function () {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.updateStatus(oModel);
        },

        onItemUnitSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newInquiry");
            if (!oContext || !oItem) return;

            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newInquiry");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/OrderQuantityUnit", sKey);
            oModel.setProperty(sPath + "/errors/OrderQuantityUnit", { state: "None", text: "" });
            this.onItemFieldChange();
        },

        onItemPlantChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newInquiry");
            if (!oContext) return;

            var sVal = oSource.getValue() ? oSource.getValue().trim().toUpperCase() : "";
            var oModel = this.getView().getModel("newInquiry");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/Plant", sVal);

            if (!sVal) {
                oModel.setProperty(sPath + "/errors/Plant", { state: "Error", text: "Plant is required for each line item" });
            } else if (sVal.length > 4) {
                oModel.setProperty(sPath + "/errors/Plant", { state: "Error", text: "Plant cannot exceed 4 characters" });
            } else {
                oModel.setProperty(sPath + "/errors/Plant", { state: "None", text: "" });
            }
            SalesInquiryModel.updateStatus(oModel);
        },

        onItemPlantLiveChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newInquiry");
            if (!oContext) return;

            var sVal = oEvent.getParameter("value");
            var oModel = this.getView().getModel("newInquiry");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/Plant", sVal ? sVal.toUpperCase() : "");
            if (sVal && sVal.trim() !== "") {
                if (sVal.trim().length <= 4) {
                    oModel.setProperty(sPath + "/errors/Plant", { state: "None", text: "" });
                }
            }
        },

        onItemPlantSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newInquiry");
            if (!oContext || !oItem) return;

            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newInquiry");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/Plant", sKey);
            oModel.setProperty(sPath + "/errors/Plant", { state: "None", text: "" });
            SalesInquiryModel.updateStatus(oModel);
        }
    };
}

var oExports = {
    createCreateSalesInquiryItemManager: createCreateSalesInquiryItemManager
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
