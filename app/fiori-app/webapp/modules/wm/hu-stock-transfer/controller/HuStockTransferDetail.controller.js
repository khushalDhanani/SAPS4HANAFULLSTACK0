sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "sap/ui/core/Fragment",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (BaseController, JSONModel, ODataClient, Fragment, MessageToast, MessageBox) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.wm.hu-stock-transfer.controller.HuStockTransferDetail", {

        onInit: function () {
            var oViewModel = new JSONModel({
                busy: false,
                reservationNo: "",
                reservationItem: "",
                cockpit: {},
                scanUnitNumber: "",
                validatedUnit: null,
                isFullUnit: true,
                transferQty: 0,
                maxAllowedQty: 0,
                statusMessage: "",
                statusStateType: "None",
                storageBins: [],
                visualRack: []
            });
            this.setModel(oViewModel, "cockpitView");

            this.getRouter().getRoute("wmHuStockTransferDetail").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            var oArgs = oEvent.getParameter("arguments");
            var sRes = oArgs.reservation;
            var sItem = oArgs.item;

            var oViewModel = this.getModel("cockpitView");
            oViewModel.setProperty("/reservationNo", sRes);
            oViewModel.setProperty("/reservationItem", sItem);
            oViewModel.setProperty("/scanUnitNumber", "");
            oViewModel.setProperty("/validatedUnit", null);
            oViewModel.setProperty("/transferQty", 0);
            oViewModel.setProperty("/statusMessage", "");
            oViewModel.setProperty("/statusStateType", "None");

            this.loadCockpitDetail(sRes, sItem);

            var that = this;
            setTimeout(function () {
                var oInput = that.byId("inputUnitNumber");
                if (oInput && oInput.focus) {
                    oInput.focus();
                }
            }, 300);
        },

        loadCockpitDetail: function (sRes, sItem) {
            var oViewModel = this.getModel("cockpitView");
            oViewModel.setProperty("/busy", true);

            var sUrl = "/odata/v4/hu-stock-transfer/getCockpitDetail(" +
                "reservation='" + encodeURIComponent(sRes) + "'," +
                "item='" + encodeURIComponent(sItem) + "')";

            ODataClient.get(sUrl)
                .then(function (data) {
                    var oData = (data && data.value) ? data.value : (data || {});
                    oViewModel.setProperty("/cockpit", oData);
                    oViewModel.setProperty("/maxAllowedQty", (oData && oData.OpenQty) || 0);
                    oViewModel.setProperty("/busy", false);
                })
                .catch(function (err) {
                    oViewModel.setProperty("/busy", false);
                    MessageBox.error("Failed to load transfer cockpit: " + (err && err.message ? err.message : String(err)));
                });
        },

        onValidateUnit: function () {
            var oViewModel = this.getModel("cockpitView");
            var sRes = oViewModel.getProperty("/reservationNo");
            var sItem = oViewModel.getProperty("/reservationItem");
            var sUnit = oViewModel.getProperty("/scanUnitNumber");

            if (!sUnit || !sUnit.trim()) {
                MessageToast.show("Please enter or scan a Unit number (HU / SU)");
                return;
            }

            oViewModel.setProperty("/busy", true);
            var sUrl = "/odata/v4/hu-stock-transfer/validateUnit(" +
                "reservation='" + encodeURIComponent(sRes) + "'," +
                "item='" + encodeURIComponent(sItem) + "'," +
                "unitNumber='" + encodeURIComponent(sUnit.trim()) + "')";

            ODataClient.get(sUrl)
                .then(function (data) {
                    var oData = (data && data.value) ? data.value : data;
                    oViewModel.setProperty("/busy", false);
                    oViewModel.setProperty("/validatedUnit", oData);

                    if (!oData || !oData.Valid) {
                        var sMsg = (oData && oData.StatusMessage) || "Unit validation failed";
                        oViewModel.setProperty("/statusMessage", sMsg);
                        oViewModel.setProperty("/statusStateType", "Error");
                        MessageBox.error(sMsg);
                        return;
                    }

                    oViewModel.setProperty("/statusMessage", oData.StatusMessage);
                    oViewModel.setProperty("/statusStateType", oData.StatusState || "Information");

                    // Auto set transfer qty
                    var bFull = oViewModel.getProperty("/isFullUnit");
                    if (bFull) {
                        oViewModel.setProperty("/transferQty", oData.DefaultTransferQty);
                    } else if (oViewModel.getProperty("/transferQty") <= 0) {
                        oViewModel.setProperty("/transferQty", oData.DefaultTransferQty);
                    }

                    MessageToast.show((oData.UnitType || "Unit") + " validated successfully!");
                })
                .catch(function (err) {
                    oViewModel.setProperty("/busy", false);
                    MessageBox.error("Unit validation error: " + (err && err.message ? err.message : String(err)));
                });
        },

        onFullUnitChange: function (oEvent) {
            var bState = oEvent.getParameter("state");
            var oViewModel = this.getModel("cockpitView");
            var oUnit = oViewModel.getProperty("/validatedUnit");

            if (bState && oUnit && oUnit.DefaultTransferQty) {
                oViewModel.setProperty("/transferQty", oUnit.DefaultTransferQty);
            }
        },

        onShowStorageBins: function () {
            var oViewModel = this.getModel("cockpitView");
            var sRes = oViewModel.getProperty("/reservationNo");
            var sItem = oViewModel.getProperty("/reservationItem");
            var that = this;

            var sUrl = "/odata/v4/hu-stock-transfer/getStorageBins(" +
                "reservation='" + encodeURIComponent(sRes) + "'," +
                "item='" + encodeURIComponent(sItem) + "')";

            ODataClient.get(sUrl)
                .then(function (data) {
                    var aBins = (data && data.value) || (Array.isArray(data) ? data : []);
                    oViewModel.setProperty("/storageBins", aBins);
                    oViewModel.setProperty("/allStorageBins", aBins);

                    if (!that._pStorageBinsDialog) {
                        that._pStorageBinsDialog = Fragment.load({
                            id: that.getView().getId(),
                            name: "saps4hana.fiori.modules.wm.hu-stock-transfer.view.fragment.StorageBinsDialog",
                            controller: that
                        }).then(function (oDialog) {
                            that.getView().addDependent(oDialog);
                            return oDialog;
                        });
                    }
                    that._pStorageBinsDialog.then(function (oDialog) {
                        oDialog.open();
                    });
                })
                .catch(function (err) {
                    MessageBox.error("Failed to load storage bins: " + (err && err.message ? err.message : String(err)));
                });
        },

        onSearchStorageBins: function (oEvent) {
            var sQuery = oEvent.getParameter("query") || oEvent.getParameter("newValue") || "";
            var oViewModel = this.getModel("cockpitView");
            var aAll = oViewModel.getProperty("/allStorageBins") || [];

            if (!sQuery.trim()) {
                oViewModel.setProperty("/storageBins", aAll);
                return;
            }

            var sLower = sQuery.toLowerCase();
            var aFiltered = aAll.filter(function (it) {
                return (it.UnitNumber && it.UnitNumber.toLowerCase().includes(sLower)) ||
                       (it.StorageBin && it.StorageBin.toLowerCase().includes(sLower)) ||
                       (it.StorageType && it.StorageType.toLowerCase().includes(sLower)) ||
                       (it.Batch && it.Batch.toLowerCase().includes(sLower)) ||
                       (it.SutCode && it.SutCode.toLowerCase().includes(sLower));
            });
            oViewModel.setProperty("/storageBins", aFiltered);
        },

        onCloseStorageBinsDialog: function () {
            if (this._pStorageBinsDialog) {
                this._pStorageBinsDialog.then(function (oDialog) {
                    oDialog.close();
                });
            }
        },

        onSelectBinItem: function (oEvent) {
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
            var oCtx = oItem.getBindingContext("cockpitView");
            if (!oCtx) return;

            var sUnit = oCtx.getProperty("UnitNumber");
            if (sUnit) {
                this.getModel("cockpitView").setProperty("/scanUnitNumber", sUnit);
                this.onCloseStorageBinsDialog();
                this.onValidateUnit();
            }
        },

        onShowVisualRack: function () {
            var oViewModel = this.getModel("cockpitView");
            var sRes = oViewModel.getProperty("/reservationNo");
            var sItem = oViewModel.getProperty("/reservationItem");
            var that = this;

            var sUrl = "/odata/v4/hu-stock-transfer/getVisualRack(" +
                "reservation='" + encodeURIComponent(sRes) + "'," +
                "item='" + encodeURIComponent(sItem) + "')";

            ODataClient.get(sUrl)
                .then(function (data) {
                    var aRack = (data && data.value) || (Array.isArray(data) ? data : []);
                    oViewModel.setProperty("/visualRack", aRack);
                    oViewModel.setProperty("/allVisualRack", aRack);

                    if (!that._pVisualRackDialog) {
                        that._pVisualRackDialog = Fragment.load({
                            id: that.getView().getId(),
                            name: "saps4hana.fiori.modules.wm.hu-stock-transfer.view.fragment.VisualRackDialog",
                            controller: that
                        }).then(function (oDialog) {
                            that.getView().addDependent(oDialog);
                            return oDialog;
                        });
                    }
                    that._pVisualRackDialog.then(function (oDialog) {
                        oDialog.open();
                    });
                })
                .catch(function (err) {
                    MessageBox.error("Failed to load visual rack: " + (err && err.message ? err.message : String(err)));
                });
        },

        onSearchVisualRack: function (oEvent) {
            var sQuery = oEvent.getParameter("query") || oEvent.getParameter("newValue") || "";
            var oViewModel = this.getModel("cockpitView");
            var aAll = oViewModel.getProperty("/allVisualRack") || [];

            if (!sQuery.trim()) {
                oViewModel.setProperty("/visualRack", aAll);
                return;
            }

            var sLower = sQuery.toLowerCase();
            var aFiltered = aAll.filter(function (it) {
                return (it.UnitNumber && it.UnitNumber.toLowerCase().includes(sLower)) ||
                       (it.ActualStorageBin && it.ActualStorageBin.toLowerCase().includes(sLower)) ||
                       (it.ShelfLevelDesc && it.ShelfLevelDesc.toLowerCase().includes(sLower)) ||
                       (it.LevelCode && it.LevelCode.toLowerCase().includes(sLower));
            });
            oViewModel.setProperty("/visualRack", aFiltered);
        },

        onCloseVisualRackDialog: function () {
            if (this._pVisualRackDialog) {
                this._pVisualRackDialog.then(function (oDialog) {
                    oDialog.close();
                });
            }
        },

        onSelectRackItem: function (oEvent) {
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
            var oCtx = oItem.getBindingContext("cockpitView");
            if (!oCtx) return;

            var sUnit = oCtx.getProperty("UnitNumber");
            if (sUnit) {
                this.getModel("cockpitView").setProperty("/scanUnitNumber", sUnit);
                this.onCloseVisualRackDialog();
                this.onValidateUnit();
            }
        },

        onPostTransfer: function () {
            var oViewModel = this.getModel("cockpitView");
            var sRes = oViewModel.getProperty("/reservationNo");
            var sItem = oViewModel.getProperty("/reservationItem");
            var sUnit = oViewModel.getProperty("/scanUnitNumber");
            var nQty = parseFloat(oViewModel.getProperty("/transferQty") || 0);
            var bFull = oViewModel.getProperty("/isFullUnit");
            var oCockpit = oViewModel.getProperty("/cockpit") || {};
            var that = this;

            if (!sUnit) {
                MessageBox.error("Please scan and validate a unit first");
                return;
            }
            if (nQty <= 0) {
                MessageBox.error("Please enter a valid transfer quantity greater than 0");
                return;
            }

            var oBundle = this.getView().getModel("i18n") ? this.getView().getModel("i18n").getResourceBundle() : null;
            var sTitle = oBundle ? oBundle.getText("confirmPostTitle") : "Confirm SAP Stock Transfer";
            var sPrompt = oBundle ? oBundle.getText("confirmPostPrompt", [
                sUnit,
                oCockpit.Material || "",
                nQty,
                oCockpit.BaseUnit || "",
                oCockpit.StorageLocation || "",
                oCockpit.ReceivingStorageLocation || "",
                oCockpit.Plant || ""
            ]) : ("Post 311 Stock Transfer for Unit " + sUnit + " (" + nQty + " " + (oCockpit.BaseUnit || "") + ")?");

            MessageBox.confirm(sPrompt, {
                title: sTitle,
                actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.OK,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        that._executePost(sRes, sItem, sUnit, nQty, bFull);
                    }
                }
            });
        },

        _executePost: function (sRes, sItem, sUnit, nQty, bFull) {
            var oViewModel = this.getModel("cockpitView");
            oViewModel.setProperty("/busy", true);
            var that = this;

            // Generate unique client attempt ID for idempotency protection
            var sAttemptId = "mvt311-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);

            var oPayload = {
                ReservationNo: sRes,
                ReservationItem: sItem,
                UnitNumber: sUnit,
                TransferQty: nQty,
                IsFullUnit: bFull,
                ClientAttemptId: sAttemptId
            };

            ODataClient.post("/odata/v4/hu-stock-transfer/executeHuStockTransfer", oPayload)
                .then(function (data) {
                    oViewModel.setProperty("/busy", false);
                    var oData = (data && data.value) ? data.value : data;
                    var sDoc = (oData && oData.MaterialDocument) || "";
                    var sYear = (oData && oData.MaterialDocYear) || "";

                    MessageBox.success("Success! Stock Transfer Posted.\nMaterial Document: " + sDoc + " / " + sYear + "\nAlerts dispatched to requester.", {
                        title: "Stock Transfer Posted",
                        onClose: function () {
                            that.getRouter().navTo("wmHuStockTransfer");
                        }
                    });
                })
                .catch(function (err) {
                    oViewModel.setProperty("/busy", false);
                    MessageBox.error("Goods Movement Posting Failed:\n" + (err && err.message ? err.message : String(err)));
                });
        },

        onNavBack: function () {
            this.getRouter().navTo("wmHuStockTransfer");
        }
    });
});
