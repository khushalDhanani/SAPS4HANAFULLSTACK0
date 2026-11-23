(function () {
    "use strict";

    function createCreateCustomerReturnItemManager(deps) {
        deps = deps || {};
        var CustomerReturnService = deps.CustomerReturnService;
        var MessageToast = deps.MessageToast;

        return {
            onCategoryChange: function (oEvent) {
                var oSelectedItem = oEvent.getParameter("selectedItem");
                var sKey = oSelectedItem ? oSelectedItem.getKey() : "";
                var oModel = this.getView().getModel("createReturnModel");
                if (!oModel) return;

                if (!sKey) {
                    // Standalone return: clear reference document
                    oModel.setProperty("/ReferenceSDDocument", "");
                    var aItems = oModel.getProperty("/Items") || [];
                    aItems.forEach(function (it) {
                        it.ReferenceSDDocument = "";
                    });
                    oModel.setProperty("/Items", aItems);
                }
            },

            onReferenceDocChange: function (oEvent) {
                var sVal = oEvent.getParameter("value");
                var oModel = this.getView().getModel("createReturnModel");
                if (sVal && oModel) {
                    var aItems = oModel.getProperty("/Items") || [];
                    aItems.forEach(function (it) {
                        if (!it.ReferenceSDDocument) {
                            it.ReferenceSDDocument = sVal;
                        }
                    });
                    oModel.setProperty("/Items", aItems);
                }
            },

            onHeaderReasonChange: function (oEvent) {
                var oSelectedItem = oEvent.getParameter("selectedItem");
                var sKey = oSelectedItem ? oSelectedItem.getKey() : "";
                var oModel = this.getView().getModel("createReturnModel");
                if (!oModel || !sKey) return;

                var aItems = oModel.getProperty("/Items") || [];
                aItems.forEach(function (it) {
                    it.ReturnReason = sKey;
                });
                oModel.setProperty("/Items", aItems);
            },

            onCustomerChange: function (oEvent) {
                var sVal = oEvent.getParameter("value") || "";
                var oModel = this.getView().getModel("createReturnModel");
                if (!oModel) return;

                if (!sVal.trim()) {
                    oModel.setProperty("/SoldToPartyName", "");
                    return;
                }

                CustomerReturnService.getCustomers(sVal.trim(), 1).then(function (aCusts) {
                    if (Array.isArray(aCusts) && aCusts.length > 0 && aCusts[0].Customer === sVal.trim()) {
                        oModel.setProperty("/SoldToPartyName", aCusts[0].OrganizationBPName1 || aCusts[0].Customer);
                    }
                }).catch(function () {});
                this._applyCustomerDefaults(sVal.trim());
            },

            onAddReturnItem: function () {
                var oModel = this.getView().getModel("createReturnModel");
                if (!oModel) return;

                var aItems = (oModel.getProperty("/Items") || []).slice();
                var iNextIndex = aItems.length + 1;
                var sRefDoc = oModel.getProperty("/ReferenceSDDocument") || "";
                var sReason = oModel.getProperty("/ReturnsOrderReason") || "101";

                aItems.push({
                    ItemIndex: iNextIndex,
                    Material: "",
                    OrderQuantity: "1.000",
                    OrderQuantityUnit: "KG",
                    ProductionPlant: "1110",
                    StorageLocation: "FG01",
                    ReturnReason: sReason,
                    ReferenceSDDocument: sRefDoc,
                    ReferenceSDDocumentItem: ("0000" + (iNextIndex * 10)).slice(-6)
                });
                oModel.setProperty("/Items", aItems);
                oModel.refresh(true);
            },

            onDeleteReturnItem: function () {
                var oModel = this.getView().getModel("createReturnModel");
                if (!oModel) return;

                var aItems = (oModel.getProperty("/Items") || []).slice();
                if (aItems.length > 1) {
                    aItems.pop();
                    oModel.setProperty("/Items", aItems);
                    oModel.refresh(true);
                } else {
                    MessageToast.show(this.getText("msgAtLeastOneItemRequired") || "At least one item is required.");
                }
            }
        };
    }

    var oExports = {
        createCreateCustomerReturnItemManager: createCreateCustomerReturnItemManager
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
