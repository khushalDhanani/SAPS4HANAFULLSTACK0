(function () {
    "use strict";

    function createOrdersDueDeliveryNoRef(deps) {
        deps = deps || {};
        var Fragment = deps.Fragment;
        var MessageBox = deps.MessageBox;
        var OutboundDeliveryService = deps.OutboundDeliveryService;

        return {
            onOpenCreateDeliveryNoRefDialog: function () {
                var oView = this.getView();
                var that = this;

                var oModel = oView.getModel("deliveryNoRefDialog");
                if (oModel) {
                    oModel.setProperty("/submitBlocked", false);
                    oModel.setProperty("/shippingPoint", "1104");
                    oModel.setProperty("/deliveryType", "LO2");
                    oModel.setProperty("/plant", "1110");
                    oModel.setProperty("/storageLocation", "FG01");
                    oModel.setProperty("/salesOrg", "");
                    oModel.setProperty("/distChannel", "");
                    oModel.setProperty("/division", "");
                    oModel.setProperty("/shipToParty", "10135");
                    oModel.setProperty("/plannedGoodsIssueDate", this._getTodayDateString());
                    oModel.setProperty("/busy", false);
                    oModel.setProperty("/items", [
                        { itemNo: "000010", material: "4000000186", quantity: 1, uom: "KG" }
                    ]);
                }

                if (!this._pCreateDeliveryNoRefDialog) {
                    this._pCreateDeliveryNoRefDialog = Fragment.load({
                        id: oView.getId(),
                        name: "saps4hana.fiori.modules.le.outbound-delivery.view.CreateDeliveryNoRefDialog",
                        controller: this
                    }).then(function (oDialog) {
                        oView.addDependent(oDialog);
                        if (oDialog.addStyleClass && that.getContentDensityClass) {
                            oDialog.addStyleClass(that.getContentDensityClass());
                        }
                        return oDialog;
                    });
                }

                this._pCreateDeliveryNoRefDialog.then(function (oDialog) {
                    oDialog.open();
                });
            },

            onCancelCreateDeliveryNoRef: function () {
                if (this._pCreateDeliveryNoRefDialog) {
                    this._pCreateDeliveryNoRefDialog.then(function (oDialog) {
                        oDialog.close();
                    });
                }
            },

            onAddDeliveryNoRefItem: function () {
                var oModel = this.getView().getModel("deliveryNoRefDialog");
                if (!oModel) return;
                var aItems = oModel.getProperty("/items") || [];
                var nextItemNo = String((aItems.length + 1) * 10).padStart(6, "0");
                aItems.push({
                    itemNo: nextItemNo,
                    material: "4000000187",
                    quantity: 1,
                    uom: "KG"
                });
                oModel.setProperty("/items", aItems);
            },

            onDeleteDeliveryNoRefItem: function (oEvent) {
                var oCtx = oEvent.getSource().getBindingContext("deliveryNoRefDialog");
                if (!oCtx) return;
                var sPath = oCtx.getPath();
                var iIndex = parseInt(sPath.split("/").pop(), 10);
                var oModel = this.getView().getModel("deliveryNoRefDialog");
                var aItems = oModel.getProperty("/items") || [];
                if (aItems.length <= 1) {
                    MessageBox.warning("At least one line item is required for delivery.");
                    return;
                }
                aItems.splice(iIndex, 1);
                oModel.setProperty("/items", aItems);
            },

            onConfirmCreateDeliveryNoRef: function () {
                var that = this;
                var oModel = this.getView().getModel("deliveryNoRefDialog");
                if (!oModel || oModel.getProperty("/busy") || oModel.getProperty("/submitBlocked")) return;

                var sShippingPoint = oModel.getProperty("/shippingPoint");
                var sDeliveryType = oModel.getProperty("/deliveryType");
                var sPlant = oModel.getProperty("/plant");
                var sStorageLocation = oModel.getProperty("/storageLocation");
                var sShipToParty = oModel.getProperty("/shipToParty");
                var sSalesOrg = oModel.getProperty("/salesOrg");
                var sDistChannel = oModel.getProperty("/distChannel");
                var sDivision = oModel.getProperty("/division");
                var sPlannedGIDate = oModel.getProperty("/plannedGoodsIssueDate");
                var aItems = oModel.getProperty("/items") || [];

                if (!sShippingPoint || !sDeliveryType || !sPlant || !sStorageLocation || !sShipToParty) {
                    MessageBox.error(this._text("msgDeliveryNoRefValidationFailed", "Please fill all required fields: Shipping Point, Delivery Type, Plant, Storage Location, Ship-To Party, and at least one item with Material and Quantity."));
                    return;
                }

                if (aItems.length === 0 || !aItems.some(function (it) { return it.material && Number(it.quantity) > 0; })) {
                    MessageBox.error("At least one item with a valid Material and positive Quantity is required.");
                    return;
                }

                oModel.setProperty("/busy", true);

                OutboundDeliveryService.createDeliveryWithoutRef({
                    shippingPoint: sShippingPoint,
                    deliveryType: sDeliveryType,
                    plant: sPlant,
                    storageLocation: sStorageLocation,
                    salesOrg: sSalesOrg,
                    distChannel: sDistChannel,
                    division: sDivision,
                    shipToParty: sShipToParty,
                    plannedGoodsIssueDate: sPlannedGIDate,
                    items: aItems
                })
                    .then(function (oResult) {
                        var sDeliveryNo = (oResult && oResult.OutboundDelivery) || (typeof oResult === "string" ? oResult : "");
                        that.onCancelCreateDeliveryNoRef();

                        if (sDeliveryNo) {
                            var sSuccessTemplate = that._text("msgDeliveryNoRefCreatedSuccess", "Outbound Delivery {0} created successfully in SAP S/4HANA without reference.");
                            var sSuccessMsg = sSuccessTemplate.replace("{0}", sDeliveryNo);
                            var oFollowUp = that.getView().getModel("deliveryFollowUp");
                            if (oFollowUp) {
                                oFollowUp.setProperty("/delivery", String(sDeliveryNo));
                                oFollowUp.setProperty("/billingTypes", []);
                                oFollowUp.setProperty("/billingType", "");
                                that.onLoadDeliveryStatus();
                            }
                            MessageBox.success(sSuccessMsg, {
                                onClose: function () {
                                    that.onRefresh();
                                }
                            });
                        } else {
                            MessageBox.success("Outbound Delivery created successfully in SAP S/4HANA.");
                        }
                    })
                    .catch(function (err) {
                        var sErrMsg = (err && (err.message || err.statusText)) || "Failed to create outbound delivery without reference.";
                        MessageBox.error(that.blockSubmitIfNotConfirmed(oModel, sErrMsg) || sErrMsg);
                    })
                    .finally(function () {
                        oModel.setProperty("/busy", false);
                    });
            }
        };
    }

    var oExports = {
        createOrdersDueDeliveryNoRef: createOrdersDueDeliveryNoRef
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
