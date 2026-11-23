(function () {
    "use strict";

    function createCreateCustomerReturnSubmitter(deps) {
        deps = deps || {};
        var MessageBox = deps.MessageBox;
        var BusyIndicator = deps.BusyIndicator;
        var Messaging = deps.Messaging;
        var CustomerReturnService = deps.CustomerReturnService;

        return {
            onConfirmCreateReturn: function () {
                var that = this;
                var oModel = this.getView().getModel("createReturnModel");
                var oCreateData = oModel ? oModel.getData() : null;
                if (!oCreateData || oCreateData.submitBlocked) return;

                if (!oCreateData.SoldToParty || !oCreateData.SoldToParty.trim()) {
                    MessageBox.error(this.getText("msgCreateReturnValidationFailed"));
                    return;
                }
                if (!oCreateData.ReturnsOrderReason) {
                    MessageBox.error(this.getText("msgCreateReturnValidationFailed"));
                    return;
                }
                if (!oCreateData.Items || oCreateData.Items.length === 0 || !oCreateData.Items[0].Material) {
                    MessageBox.error(this.getText("msgCreateReturnValidationFailed"));
                    return;
                }

                BusyIndicator.show(0);

                var oPayload = {
                    CustomerReturnType: oCreateData.CustomerReturnType || "ZRET",
                    SoldToParty: oCreateData.SoldToParty.trim(),
                    ReturnsOrderReason: oCreateData.ReturnsOrderReason,
                    ReferenceSDDocument: oCreateData.ReferenceSDDocument ? oCreateData.ReferenceSDDocument.trim() : "",
                    ReferenceSDDocumentCategory: oCreateData.ReferenceSDDocumentCategory || "",
                    SalesOrganization: oCreateData.SalesOrganization || "1000",
                    DistributionChannel: oCreateData.DistributionChannel || "10",
                    OrganizationDivision: oCreateData.OrganizationDivision || "52",
                    CustomerReturnDate: oCreateData.CustomerReturnDate || new Date().toISOString().slice(0, 10),
                    PurchaseOrderByCustomer: oCreateData.PurchaseOrderByCustomer ? oCreateData.PurchaseOrderByCustomer.trim() : "",
                    Items: (oCreateData.Items || []).map(function (it, idx) {
                        return {
                            Material: it.Material ? it.Material.trim() : "",
                            OrderQuantity: parseFloat(it.OrderQuantity) || 1,
                            OrderQuantityUnit: it.OrderQuantityUnit || "KG",
                            ProductionPlant: it.ProductionPlant || "1110",
                            StorageLocation: it.StorageLocation || "FG01",
                            ReturnReason: it.ReturnReason || oCreateData.ReturnsOrderReason || "101",
                            ReferenceSDDocument: it.ReferenceSDDocument || oCreateData.ReferenceSDDocument || "",
                            ReferenceSDDocumentItem: it.ReferenceSDDocumentItem || ("0000" + ((idx + 1) * 10)).slice(-6)
                        };
                    })
                };

                CustomerReturnService.createCustomerReturn(oPayload, this.getView().getModel("customerReturn"))
                    .then(function (oResult) {
                        BusyIndicator.hide();
                        var sDocNum = oResult && (oResult.CustomerReturn || (oResult.d && oResult.d.CustomerReturn));
                        MessageBox.success(
                            that.getText("msgReturnCreatedSuccess", [sDocNum || ""]),
                            {
                                title: that.getText("msgReturnCreatedSuccessTitle"),
                                onClose: function () {
                                    that.onNavBack();
                                }
                            }
                        );
                    })
                    .catch(function (oErr) {
                        BusyIndicator.hide();
                        var sMsg = "";
                        if (oErr && oErr.message && oErr.message.indexOf("Communication error") === -1) {
                            sMsg = oErr.message;
                        }
                        if (!sMsg) {
                            try {
                                var aMessages = [];
                                if (typeof Messaging !== "undefined" && Messaging && typeof Messaging.getMessageModel === "function") {
                                    aMessages = Messaging.getMessageModel().getData() || [];
                                }
                                if (Array.isArray(aMessages)) {
                                    for (var i = aMessages.length - 1; i >= 0; i--) {
                                        if (aMessages[i].type === "Error" && aMessages[i].message && aMessages[i].message.indexOf("Communication error") === -1) {
                                            sMsg = aMessages[i].message;
                                            break;
                                        }
                                    }
                                }
                            } catch (e) {
                                // ignore
                            }
                        }
                        if (!sMsg) {
                            sMsg = (oErr && oErr.error && oErr.error.message) || (oErr && oErr.message) || JSON.stringify(oErr);
                        }
                        MessageBox.error(that.blockSubmitIfNotConfirmed(oModel, sMsg) || that.getText("msgCreateReturnFailed", [sMsg]), {
                            title: that.getText("titleCreateReturnFailed") || "Create Customer Return Failed",
                            details: (oErr && oErr.originalError && oErr.originalError.message) || (oErr && oErr.stack) || ""
                        });
                    });
            }
        };
    }

    var oExports = {
        createCreateCustomerReturnSubmitter: createCreateCustomerReturnSubmitter
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
