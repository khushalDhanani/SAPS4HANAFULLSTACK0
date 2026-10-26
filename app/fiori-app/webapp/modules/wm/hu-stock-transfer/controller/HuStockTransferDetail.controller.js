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
                selectedHus: [],
                selectionValidation: null,
                selectionSummary: "",
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
            oViewModel.setProperty("/selectedHus", []);
            oViewModel.setProperty("/selectionValidation", null);
            oViewModel.setProperty("/selectionSummary", "");
            oViewModel.setProperty("/statusMessage", "");
            oViewModel.setProperty("/statusStateType", "None");

            this.loadCockpitDetail(sRes, sItem);

            var that = this;
            var oShared = this.getOwnerComponent().getModel("cockpitShared");
            var sPreselected = oShared ? oShared.getProperty("/preselectedUnit") : "";
            if (sPreselected) {
                oShared.setProperty("/preselectedUnit", "");
                oViewModel.setProperty("/scanUnitNumber", sPreselected);
                setTimeout(function () {
                    that.onValidateUnit();
                }, 400);
            } else {
                setTimeout(function () {
                    var oInput = that.byId("inputUnitNumber");
                    if (oInput && oInput.focus) {
                        oInput.focus();
                    }
                }, 300);
            }
        },

        loadCockpitDetail: function (sRes, sItem) {
            if (!sRes) return;
            sItem = sItem || "1";
            var oViewModel = this.getModel("cockpitView");
            oViewModel.setProperty("/busy", true);

            var sUrl = "/odata/v4/hu-stock-transfer/getCockpitDetail(" +
                "reservation='" + encodeURIComponent(sRes) + "'," +
                "item='" + encodeURIComponent(sItem) + "')";
            var that = this;

            ODataClient.get(sUrl)
                .then(function (data) {
                    var oData = (data && data.value) ? data.value : (data || {});
                    oViewModel.setProperty("/cockpit", oData);
                    oViewModel.setProperty("/maxAllowedQty", (oData && oData.OpenQty) || 0);
                    that._updateHuSelectionSummary();
                    oViewModel.setProperty("/busy", false);
                })
                .catch(function (err) {
                    oViewModel.setProperty("/busy", false);
                    MessageBox.error("Failed to load transfer cockpit: " + (err && err.message ? err.message : String(err)));
                });
        },

        onValidateUnit: function () {
            var that = this;
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
                        if (oData && oData.BlockerDetails && oData.BlockerDetails.length) {
                            var aMsgs = oData.BlockerDetails.map(function (b) {
                                return that.getText(b.key, b.params, b.message);
                            });
                            sMsg = aMsgs.join("; ");
                        }
                        oViewModel.setProperty("/statusMessage", sMsg);
                        oViewModel.setProperty("/statusStateType", "Error");
                        MessageBox.error(sMsg);
                        return;
                    }

                    var sStatusMsg = oData.StatusMessage;
                    var sStatusState = oData.StatusState || "Information";
                    if (oData.WarningDetails && oData.WarningDetails.length) {
                        var aWarnMsgs = oData.WarningDetails.map(function (w) {
                            return that.getText(w.key, w.params, w.message);
                        });
                        sStatusMsg = aWarnMsgs.join("; ");
                        sStatusState = "Warning";
                    }

                    oViewModel.setProperty("/statusMessage", sStatusMsg);
                    oViewModel.setProperty("/statusStateType", sStatusState);

                    // Auto set transfer qty
                    var bFull = oViewModel.getProperty("/isFullUnit");
                    var aSelected = oViewModel.getProperty("/selectedHus") || [];
                    var nRemaining = Number(oViewModel.getProperty("/maxAllowedQty") || 0) - aSelected.reduce(function (sum, item) {
                        return sum + Number(item.TransferQty || 0);
                    }, 0);
                    if (bFull) {
                        oViewModel.setProperty("/transferQty", Math.max(0, Math.min(Number(oData.AvailableQuantity || 0), nRemaining)));
                    } else if (oViewModel.getProperty("/transferQty") <= 0) {
                        oViewModel.setProperty("/transferQty", Math.max(0, Math.min(Number(oData.AvailableQuantity || 0), nRemaining)));
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
                var aSelected = oViewModel.getProperty("/selectedHus") || [];
                var nRemaining = Number(oViewModel.getProperty("/maxAllowedQty") || 0) - aSelected.reduce(function (sum, item) {
                    return sum + Number(item.TransferQty || 0);
                }, 0);
                oViewModel.setProperty("/transferQty", Math.max(0, Math.min(Number(oUnit.AvailableQuantity || 0), nRemaining)));
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
            var oItem = (oEvent && typeof oEvent.getParameter === "function" && oEvent.getParameter("listItem")) ||
                        (oEvent && oEvent.getSource ? oEvent.getSource() : null);
            if (!oItem || typeof oItem.getBindingContext !== "function") return;
            var oCtx = oItem.getBindingContext("cockpitView");
            if (!oCtx) return;

            var sUnit = oCtx.getProperty("UnitNumber") || oCtx.getProperty("StorageBin");
            if (sUnit) {
                this.getModel("cockpitView").setProperty("/scanUnitNumber", sUnit);
                this.onCloseStorageBinsDialog();
                this.onValidateUnit();
            } else {
                var sBin = oCtx.getProperty("StorageBin");
                MessageToast.show("Selected bin " + sBin + " has no specific HU/SU or Bin number.");
            }
        },

        onShowVisualRack: function () {
            var oViewModel = this.getModel("cockpitView");
            var sRes = oViewModel.getProperty("/reservationNo");
            var sItem = oViewModel.getProperty("/reservationItem") || "1";
            this.getRouter().navTo("wmHuStockTransferRack", {
                reservation: sRes,
                item: sItem
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
            var oItem = (oEvent && typeof oEvent.getParameter === "function" && oEvent.getParameter("listItem")) ||
                        (oEvent && oEvent.getSource ? oEvent.getSource() : null);
            if (!oItem || typeof oItem.getBindingContext !== "function") return;
            var oCtx = oItem.getBindingContext("cockpitView");
            if (!oCtx) return;

            var sUnit = oCtx.getProperty("UnitNumber") || oCtx.getProperty("ActualStorageBin");
            if (sUnit) {
                this.getModel("cockpitView").setProperty("/scanUnitNumber", sUnit);
                this.onCloseVisualRackDialog();
                this.onValidateUnit();
            } else {
                var sBin = oCtx.getProperty("ActualStorageBin");
                MessageToast.show("Selected bin " + sBin + " has no specific HU/SU or Bin number.");
            }
        },

        onAddUnitToSelection: function () {
            var oViewModel = this.getModel("cockpitView");
            var oUnit = oViewModel.getProperty("/validatedUnit");
            var nQty = Number(oViewModel.getProperty("/transferQty"));
            var aSelected = (oViewModel.getProperty("/selectedHus") || []).slice();
            var nOpenQty = Number(oViewModel.getProperty("/maxAllowedQty"));
            var nSelected = aSelected.reduce(function (sum, item) { return sum + Number(item.TransferQty || 0); }, 0);
            var nRemaining = nOpenQty - nSelected;
            var sBehavior = String((oViewModel.getProperty("/cockpit") || {}).OversizeHuSelectionBehavior || "BLOCK").toUpperCase();

            if (!oUnit || !oUnit.Valid || !String(oUnit.UnitType || "").includes("HU")) {
                MessageBox.error(this.getText("huSelectionRequireValidatedHu", null, "Validate a handling unit before adding it."));
                return;
            }
            if (!Number.isFinite(nQty) || nQty <= 0 || nQty > Number(oUnit.AvailableQuantity)) {
                MessageBox.error(this.getText("huSelectionQtyWithinStock", [oUnit.AvailableQuantity], "Quantity must be positive and within HU stock ({0})."));
                return;
            }
            if (aSelected.some(function (item) { return String(item.UnitNumber).toUpperCase() === String(oUnit.UnitNumber).toUpperCase(); })) {
                MessageBox.error(this.getText("huSelectionDuplicateHu", null, "This handling unit is already selected."));
                return;
            }
            if (Number(oUnit.AvailableQuantity) > nRemaining && sBehavior !== "WARN") {
                MessageBox.error(this.getText("huSelectionOversizeBlocked", [nRemaining], "This HU exceeds the remaining reservation quantity ({0}); selection is blocked."));
                return;
            }
            if (nQty > nRemaining) {
                MessageBox.error(this.getText("huSelectionSumOverOpenQty", [nRemaining], "Selected quantities cannot exceed the remaining reservation quantity ({0})."));
                return;
            }

            aSelected.push({
                UnitNumber: oUnit.UnitNumber,
                UnitType: oUnit.UnitType,
                TransferQty: nQty,
                AvailableQuantity: Number(oUnit.AvailableQuantity),
                BaseUnit: oUnit.BaseUnit,
                StorageType: oUnit.StorageType,
                StorageBin: oUnit.StorageBin
            });
            oViewModel.setProperty("/selectedHus", aSelected);
            oViewModel.setProperty("/selectionValidation", null);
            this._updateHuSelectionSummary();
            oViewModel.setProperty("/scanUnitNumber", "");
            oViewModel.setProperty("/validatedUnit", null);
            oViewModel.setProperty("/transferQty", 0);
        },

        onRemoveSelectedHu: function (oEvent) {
            var oItem = oEvent && oEvent.getParameter && oEvent.getParameter("listItem");
            var oContext = oItem && oItem.getBindingContext && oItem.getBindingContext("cockpitView");
            if (!oContext) return;
            var iIndex = Number(oContext.getPath().split("/").pop());
            var oViewModel = this.getModel("cockpitView");
            var aSelected = (oViewModel.getProperty("/selectedHus") || []).slice();
            if (!Number.isInteger(iIndex) || iIndex < 0 || iIndex >= aSelected.length) return;
            aSelected.splice(iIndex, 1);
            oViewModel.setProperty("/selectedHus", aSelected);
            oViewModel.setProperty("/selectionValidation", null);
            this._updateHuSelectionSummary();
        },

        onHuSelectionQuantityChange: function (oEvent) {
            var oSource = oEvent && oEvent.getSource && oEvent.getSource();
            var oContext = oSource && oSource.getBindingContext && oSource.getBindingContext("cockpitView");
            if (!oContext) return;
            var nQty = Number(oSource.getValue());
            var nAvailable = Number(oContext.getProperty("AvailableQuantity"));
            var nTotal = (this.getModel("cockpitView").getProperty("/selectedHus") || []).reduce(function (sum, item) {
                return sum + Number(item.TransferQty || 0);
            }, 0);
            var nOpen = Number(this.getModel("cockpitView").getProperty("/maxAllowedQty") || 0);
            if (!Number.isFinite(nQty) || nQty <= 0 || nQty > nAvailable || nTotal > nOpen) {
                MessageBox.error(this.getText("huSelectionClientValidation", null, "Each selected HU must be unique and its quantity must be within available stock and the open reservation quantity."));
            }
            this.getModel("cockpitView").setProperty("/selectionValidation", null);
            this._updateHuSelectionSummary();
        },

        _updateHuSelectionSummary: function () {
            var oViewModel = this.getModel("cockpitView");
            var aSelected = oViewModel.getProperty("/selectedHus") || [];
            var nTotal = aSelected.reduce(function (sum, item) { return sum + Number(item.TransferQty || 0); }, 0);
            var nOpen = Number(oViewModel.getProperty("/maxAllowedQty") || 0);
            var sUnit = (oViewModel.getProperty("/cockpit") || {}).BaseUnit || "";
            oViewModel.setProperty("/selectionSummary", this.getText(
                "huSelectionTotalSummary", [nTotal.toFixed(3), nOpen.toFixed(3), sUnit],
                "Selected: {0} / open: {1} {2}"
            ));
        },

        onValidateSelectedHus: function () {
            var oViewModel = this.getModel("cockpitView");
            var aSelected = oViewModel.getProperty("/selectedHus") || [];
            var nOpenQty = Number(oViewModel.getProperty("/maxAllowedQty"));
            var nTotal = 0;
            var nRemaining = nOpenQty;
            var sBehavior = String((oViewModel.getProperty("/cockpit") || {}).OversizeHuSelectionBehavior || "BLOCK").toUpperCase();
            var mSeen = Object.create(null);

            if (!aSelected.length) {
                MessageBox.error(this.getText("huSelectionEmpty", null, "Add at least one handling unit."));
                return;
            }
            for (var i = 0; i < aSelected.length; i++) {
                var item = aSelected[i];
                var sKey = String(item.UnitNumber || "").toUpperCase();
                var nQty = Number(item.TransferQty);
                var nAvailable = Number(item.AvailableQuantity);
                if (!sKey || mSeen[sKey] || !Number.isFinite(nQty) || nQty <= 0 || nQty > nAvailable) {
                    MessageBox.error(this.getText("huSelectionClientValidation", null, "Each selected HU must be unique and its quantity must be within available stock."));
                    return;
                }
                if (nAvailable > nRemaining && sBehavior !== "WARN") {
                    MessageBox.error(this.getText("huSelectionOversizeBlocked", [nRemaining], "This HU exceeds the remaining reservation quantity ({0}); selection is blocked."));
                    return;
                }
                if (nQty > nRemaining) {
                    MessageBox.error(this.getText("huSelectionSumOverOpenQty", [nRemaining], "Selected quantities cannot exceed the remaining reservation quantity ({0})."));
                    return;
                }
                mSeen[sKey] = true;
                nTotal += nQty;
                nRemaining -= nQty;
            }
            this._updateHuSelectionSummary();

            oViewModel.setProperty("/busy", true);
            var that = this;
            ODataClient.post("/odata/v4/hu-stock-transfer/validateHuStockTransferSelection", {
                ReservationNo: oViewModel.getProperty("/reservationNo"),
                ReservationItem: oViewModel.getProperty("/reservationItem"),
                Selections: aSelected.map(function (item) {
                    return { UnitNumber: item.UnitNumber, TransferQty: Number(item.TransferQty) };
                })
            }).then(function (data) {
                var result = (data && data.value) || data || {};
                oViewModel.setProperty("/selectionValidation", result);
                oViewModel.setProperty("/busy", false);
                var msg = result.Warnings && result.Warnings.length
                    ? result.Warnings.join("; ")
                    : that.getText("huSelectionValidated", [nTotal, nOpenQty], "Selection validated read-only: {0} of {1} {2}. No transfer was posted.");
                oViewModel.setProperty("/statusMessage", msg);
                oViewModel.setProperty("/statusStateType", result.Warnings && result.Warnings.length ? "Warning" : "Success");
            }).catch(function (error) {
                oViewModel.setProperty("/busy", false);
                MessageBox.error(that.getText("huSelectionValidationFailed", [error && error.message ? error.message : ""], "Selection validation failed: {0}"));
            });
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
        },

        onRouteToStandard311: function () {
            var sRes = this.getModel("cockpitView").getProperty("/reservationNo");
            var sItem = this.getModel("cockpitView").getProperty("/reservationItem") || "1";
            this.getRouter().navTo("wmReservationEntryDetail", {
                ReservationNo: sRes,
                ReservationItem: sItem
            });
        }
    });
});
