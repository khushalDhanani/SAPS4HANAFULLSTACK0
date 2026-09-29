sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "saps4hana/fiori/modules/wm/goods-issue/model/GoodsIssue201Model",
    "saps4hana/fiori/modules/wm/goods-issue/service/GoodsIssue201Service"
], function (
    BaseController,
    JSONModel,
    MessageBox,
    MessageToast,
    SelectDialog,
    StandardListItem,
    Filter,
    FilterOperator,
    GoodsIssue201Model,
    GoodsIssue201Service
) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.wm.goods-issue.controller.GoodsIssue201", {

        onInit: function () {
            this._oModel = GoodsIssue201Model.createInitialModel();
            this.getView().setModel(this._oModel, "gi201");

            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.getRoute("wmGoodsIssue201").attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _onRouteMatched: function (oEvent) {
            this._resetModel();
            var oArgs = oEvent && oEvent.getParameter("arguments");
            var oQuery = oArgs && oArgs["?query"];
            var sResv = oQuery && oQuery.resv;
            if (sResv) {
                this._prefillFromReservation(sResv);
            }
        },

        /**
         * Pre-fill the 201 form from an open cost-center reservation (opened from the 201 Pending list),
         * so the user can review and complete/post it. Material, plant, storage location, unit, open
         * quantity and cost center all come from the reservation item; the reservation link is carried
         * on the post so SAP marks the reservation withdrawn.
         */
        _prefillFromReservation: function (sResv) {
            var that = this;
            var oModel = this._oModel;
            oModel.setProperty("/busy", true);
            GoodsIssue201Service.fetchReservationItems(sResv)
                .then(function (aItems) {
                    var oItem = (aItems || []).find(function (i) { return Number(i.OpenQty) > 0; }) || (aItems || [])[0];
                    if (!oItem) {
                        MessageToast.show(that.getText("gi201PrefillNoOpenItem", [sResv]));
                        return;
                    }
                    oModel.setProperty("/fromReservation", true);
                    oModel.setProperty("/reservationNo", oItem.ReservationNo || sResv);
                    oModel.setProperty("/reservationItem", oItem.ReservationItem || "");
                    oModel.setProperty("/costCenter", oItem.CostCenter || "");
                    oModel.setProperty("/material", oItem.Material || "");
                    oModel.setProperty("/materialName", oItem.MaterialDesc || "");
                    oModel.setProperty("/plant", oItem.Plant || oModel.getProperty("/plant"));
                    oModel.setProperty("/storageLocation", oItem.StorageLocation || oModel.getProperty("/storageLocation"));
                    var nOpen = Number(oItem.OpenQty);
                    if (!isNaN(nOpen) && nOpen > 0) {
                        oModel.setProperty("/quantity", nOpen);
                    }
                    if (oItem.Unit) {
                        oModel.setProperty("/unit", oItem.Unit);
                    }
                    // Enrich the material (batch/serial flags, available stock) and re-validate.
                    that._loadMaterialInfo(oItem.Material || "");
                    // Detect whether this line is unit-managed (scan-to-complete) or plain quantity.
                    that._detectScanMode(oItem.ReservationNo || sResv, oItem.ReservationItem || "", Number(oItem.OpenQty) || 0);
                    that._validateLive();
                })
                .catch(function (err) {
                    MessageBox.error((err && err.message) || that.getText("gi201PrefillError"));
                })
                .finally(function () {
                    oModel.setProperty("/busy", false);
                });
        },

        _resetModel: function () {
            var oInitData = GoodsIssue201Model.getInitialData();
            this._oModel.setData(oInitData);
            this._validateLive();
        },

        // =============================================================
        // FORMATTERS
        // =============================================================

        formatSuccessBanner: function (sDoc, sYear) {
            if (!sDoc) return "";
            return this.getText("gi201SuccessBannerText", [sDoc, sYear || ""]);
        },

        formatReversalBanner: function (sDoc, sYear) {
            if (!sDoc) return "";
            return this.getText("gi201ReversalBannerText", [sDoc, sYear || ""]);
        },

        formatAvailableStock: function (nStock, sUnit) {
            if (nStock === null || nStock === undefined) return "";
            return nStock + " " + (sUnit || "") + " " + this.getText("gi201StockAvailable");
        },

        // =============================================================
        // LIVE VALIDATION
        // =============================================================

        _validateLive: function () {
            var oData = this._oModel.getData();
            var oResult = GoodsIssue201Model.validate(oData);
            this._oModel.setProperty("/errors", oResult.errors);
            this._oModel.setProperty("/isValid", oResult.isValid);
            return oResult.isValid;
        },

        onFieldLiveChange: function () {
            this._validateLive();
        },

        onCostCenterLiveChange: function (oEvent) {
            var sVal = oEvent.getParameter("value") || "";
            this._oModel.setProperty("/costCenter", sVal.toUpperCase());
            this._validateLive();
        },

        onQuantityLiveChange: function (oEvent) {
            var sVal = oEvent.getParameter("value") || "";
            var nVal = parseFloat(sVal);
            this._oModel.setProperty("/quantity", isNaN(nVal) ? sVal : nVal);
            this._validateLive();
        },

        onMaterialChange: function (oEvent) {
            var sMat = (oEvent.getParameter("value") || "").trim().toUpperCase();
            this._oModel.setProperty("/material", sMat);
            this._loadMaterialInfo(sMat);
        },

        _loadMaterialInfo: function (sMat) {
            if (!sMat) {
                this._validateLive();
                return;
            }

            var that = this;
            var sPlant = this._oModel.getProperty("/plant") || "1120";
            this._oModel.setProperty("/stockLoading", true);

            GoodsIssue201Service.fetchMaterialDetails(sMat, sPlant)
                .then(function (oInfo) {
                    if (oInfo) {
                        that._oModel.setProperty("/materialName", oInfo.materialName || "");
                        if (oInfo.unit) {
                            that._oModel.setProperty("/unit", oInfo.unit);
                            that._oModel.setProperty("/isUnitEditable", false);
                        } else {
                            that._oModel.setProperty("/isUnitEditable", true);
                        }
                        that._oModel.setProperty("/isBatchManaged", !!oInfo.isBatchManaged);
                        // Serial management comes from SAP master data only (no hardcoded material list).
                        // For reservation-completion, unit scanning is driven by the scan-to-complete
                        // section (scanEnabled) which auto-detects serial vs storage unit per scan.
                        that._oModel.setProperty("/isSerialManaged", !!oInfo.isSerialManaged);
                        that._oModel.setProperty("/availableStock", oInfo.availableStock);
                    }
                })
                .catch(function () {
                    // Non-blocking fallback
                    that._oModel.setProperty("/isUnitEditable", true);
                })
                .finally(function () {
                    that._oModel.setProperty("/stockLoading", false);
                    that._validateLive();
                });
        },

        // =============================================================
        // SCAN-TO-COMPLETE (unit-managed reservations: serial or storage unit)
        // =============================================================

        /**
         * Decide whether the opened reservation line is unit-managed (scannable) or plain quantity.
         * Unit-managed lines expose scannable stock units via getStockUnitsForItem; plain-quantity
         * lines have none and skip straight to quantity/cost-center confirmation.
         */
        _detectScanMode: function (sResv, sItem, nOpenQty) {
            var that = this;
            var oModel = this._oModel;
            oModel.setProperty("/scanEnabled", false);
            oModel.setProperty("/scannedUnits", []);
            oModel.setProperty("/lastScanState", "None");
            oModel.setProperty("/lastScanText", "");
            if (!sResv || !sItem) {
                return;
            }
            GoodsIssue201Service.fetchStockUnitsForItem(sResv, sItem)
                .then(function (oData) {
                    var aUnits = (oData && oData.StockUnits) || [];
                    if (aUnits.length > 0) {
                        oModel.setProperty("/scanEnabled", true);
                        oModel.setProperty("/requiredScanCount", Math.max(1, Math.floor(nOpenQty || 1)));
                        // The scan section takes over from the plain serial-entry section.
                        oModel.setProperty("/isSerialManaged", false);
                    }
                })
                .catch(function () { /* no scannable units -> plain quantity confirmation */ })
                .finally(function () { that._validateLive(); });
        },

        _setScanFeedback: function (sState, sText) {
            this._oModel.setProperty("/lastScanState", sState);
            this._oModel.setProperty("/lastScanText", sText);
        },

        /**
         * Handle one scanned unit barcode: auto-fetch + auto-match against S/4 via resolveStockUnit,
         * show clear pass/fail feedback, and on a match auto-fill the line. Never a silent fill.
         */
        onScanUnit: function () {
            var that = this;
            var oModel = this._oModel;
            var sBarcode = String(oModel.getProperty("/scanInput") || "").trim();
            if (!sBarcode) {
                return;
            }
            var sResv = oModel.getProperty("/reservationNo");
            var sItem = oModel.getProperty("/reservationItem");
            oModel.setProperty("/scanInput", "");
            GoodsIssue201Service.resolveScanUnit(sBarcode, sResv, sItem)
                .then(function (oRes) {
                    var oData = oModel.getData();
                    var oFb = GoodsIssue201Model.applyScanResolution(oData, oRes, sBarcode);
                    oModel.setProperty("/scannedUnits", oData.scannedUnits);
                    that._setScanFeedback(oFb.state, oFb.text);
                })
                .catch(function (err) {
                    // Hard SAP condition (no open qty, wrong plant, etc.) - surface the real message.
                    that._setScanFeedback("Error", (err && err.message) || "Scan could not be validated in S/4HANA.");
                })
                .finally(function () { that._validateLive(); });
        },

        onScanInputSubmit: function () {
            this.onScanUnit();
        },

        onDeleteScannedUnit: function (oEvent) {
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
            var oCtx = oItem && oItem.getBindingContext("gi201");
            if (!oCtx) {
                return;
            }
            var iIdx = parseInt(oCtx.getPath().split("/").pop(), 10);
            var aUnits = this._oModel.getProperty("/scannedUnits") || [];
            if (iIdx >= 0 && iIdx < aUnits.length) {
                aUnits.splice(iIdx, 1);
                this._oModel.setProperty("/scannedUnits", aUnits);
                this._setScanFeedback("None", "");
                this._validateLive();
            }
        },

        // =============================================================
        // SERIAL NUMBERS SCAN & MANAGEMENT (unplanned serial entry)
        // =============================================================

        onAddSerialPress: function () {
            var sInput = this._oModel.getProperty("/serialInput") || "";
            var oData = this._oModel.getData();
            var oRes = GoodsIssue201Model.addSerialNumber(oData, sInput);

            if (!oRes.success) {
                MessageToast.show(oRes.message);
                return;
            }

            this._oModel.refresh(true);
            this._validateLive();
            MessageToast.show(this.getText("gi201SerialAdded", [sInput.trim().toUpperCase()]));
        },

        onSerialInputSubmit: function () {
            this.onAddSerialPress();
        },

        onDeleteSerial: function (oEvent) {
            var oSource = oEvent.getSource();
            var oCtx = oSource.getBindingContext("gi201");
            if (!oCtx) return;

            var sPath = oCtx.getPath();
            var nIndex = parseInt(sPath.split("/").pop(), 10);
            var oData = this._oModel.getData();
            GoodsIssue201Model.removeSerialNumber(oData, nIndex);

            this._oModel.refresh(true);
            this._validateLive();
            MessageToast.show(this.getText("gi201SerialRemoved"));
        },

        // =============================================================
        // VALUE HELP DIALOGS
        // =============================================================

        onCostCenterValueHelp: function () {
            var that = this;
            var oDialog = new SelectDialog({
                title: this.getText("gi201SelectCostCenter"),
                noDataText: this.getText("gi201NoCostCentersFound"),
                search: function (oEvt) {
                    var sVal = oEvt.getParameter("value") || "";
                    var oBinding = oEvt.getSource().getBinding("items");
                    if (oBinding) {
                        var aFilters = sVal ? [
                            new Filter({
                                filters: [
                                    new Filter("CostCenter", FilterOperator.Contains, sVal),
                                    new Filter("CostCenterName", FilterOperator.Contains, sVal)
                                ],
                                and: false
                            })
                        ] : [];
                        oBinding.filter(aFilters);
                    }
                },
                confirm: function (oEvt) {
                    var oSelectedItem = oEvt.getParameter("selectedItem");
                    if (oSelectedItem) {
                        var sKey = oSelectedItem.getTitle();
                        var sDesc = oSelectedItem.getDescription();
                        that._oModel.setProperty("/costCenter", sKey);
                        that._oModel.setProperty("/costCenterName", sDesc);
                        that._validateLive();
                    }
                }
            });

            var oItemTemplate = new StandardListItem({
                title: "{CostCenter}",
                description: "{CostCenterName}",
                info: "{ControllingArea}"
            });

            GoodsIssue201Service.fetchCostCenters()
                .then(function (aItems) {
                    var oHelpModel = new JSONModel(aItems);
                    oDialog.setModel(oHelpModel);
                    oDialog.bindAggregation("items", "/", oItemTemplate);
                    oDialog.open();
                })
                .catch(function (err) {
                    MessageBox.error("Failed to load Cost Centers: " + (err.message || err));
                });
        },

        onMaterialValueHelp: function () {
            var that = this;
            var oDialog = new SelectDialog({
                title: this.getText("gi201SelectMaterial"),
                noDataText: this.getText("gi201NoMaterialsFound"),
                search: function (oEvt) {
                    var sVal = oEvt.getParameter("value") || "";
                    var oBinding = oEvt.getSource().getBinding("items");
                    if (oBinding) {
                        var aFilters = sVal ? [
                            new Filter({
                                filters: [
                                    new Filter("Material", FilterOperator.Contains, sVal),
                                    new Filter("MaterialName", FilterOperator.Contains, sVal)
                                ],
                                and: false
                            })
                        ] : [];
                        oBinding.filter(aFilters);
                    }
                },
                confirm: function (oEvt) {
                    var oSelectedItem = oEvt.getParameter("selectedItem");
                    if (oSelectedItem) {
                        var sKey = oSelectedItem.getTitle();
                        var sDesc = oSelectedItem.getDescription();
                        that._oModel.setProperty("/material", sKey);
                        that._oModel.setProperty("/materialName", sDesc);
                        that._loadMaterialInfo(sKey);
                    }
                }
            });

            var oItemTemplate = new StandardListItem({
                title: "{Material}",
                description: "{MaterialName}",
                info: "{MaterialBaseUnit}"
            });

            // Use view's unnamed / purchase-order OData model if bound, or fetch
            var oODataModel = this.getModel();
            if (oODataModel) {
                oDialog.setModel(oODataModel);
                oDialog.bindAggregation("items", "/MaterialVH", oItemTemplate);
                oDialog.open();
            } else {
                var sMat = that._oModel.getProperty("/material") || "8000009753";
                GoodsIssue201Service.fetchMaterialDetails(sMat, "1120")
                    .then(function (oInfo) {
                        var aList = oInfo ? [oInfo] : [];
                        var oListModel = new JSONModel(aList);
                        oDialog.setModel(oListModel);
                        oDialog.bindAggregation("items", "/", oItemTemplate);
                        oDialog.open();
                    });
            }
        },

        onPlantValueHelp: function () {
            var that = this;
            var oDialog = new SelectDialog({
                title: this.getText("gi201SelectPlant"),
                confirm: function (oEvt) {
                    var oItem = oEvt.getParameter("selectedItem");
                    if (oItem) {
                        var sPlant = oItem.getTitle();
                        that._oModel.setProperty("/plant", sPlant);
                        that._oModel.setProperty("/plantName", oItem.getDescription());
                        var sMat = that._oModel.getProperty("/material");
                        if (sMat) {
                            that._loadMaterialInfo(sMat);
                        }
                        that._validateLive();
                    }
                }
            });

            var oTemplate = new StandardListItem({
                title: "{Plant}",
                description: "{PlantName}"
            });

            GoodsIssue201Service.fetchPlants()
                .then(function (aPlants) {
                    var oModel = new JSONModel(aPlants);
                    oDialog.setModel(oModel);
                    oDialog.bindAggregation("items", "/", oTemplate);
                    oDialog.open();
                })
                .catch(function () {
                    // Fallback to enterprise defaults
                    var oModel = new JSONModel([
                        { Plant: "1120", PlantName: "Aether Main Plant" },
                        { Plant: "1110", PlantName: "Aether Specialty Plant" }
                    ]);
                    oDialog.setModel(oModel);
                    oDialog.bindAggregation("items", "/", oTemplate);
                    oDialog.open();
                });
        },

        onStorageLocationValueHelp: function () {
            var that = this;
            var sPlant = this._oModel.getProperty("/plant") || "1120";

            var oDialog = new SelectDialog({
                title: this.getText("gi201SelectStorageLocation"),
                confirm: function (oEvt) {
                    var oItem = oEvt.getParameter("selectedItem");
                    if (oItem) {
                        that._oModel.setProperty("/storageLocation", oItem.getTitle());
                        that._oModel.setProperty("/storageLocationName", oItem.getDescription());
                        that._validateLive();
                    }
                }
            });

            var oTemplate = new StandardListItem({
                title: "{StorageLocation}",
                description: "{StorageLocationName}",
                info: "{Plant}"
            });

            GoodsIssue201Service.fetchStorageLocations(sPlant)
                .then(function (aLocations) {
                    var oModel = new JSONModel(aLocations);
                    oDialog.setModel(oModel);
                    oDialog.bindAggregation("items", "/", oTemplate);
                    oDialog.open();
                })
                .catch(function () {
                    var oModel = new JSONModel([
                        { StorageLocation: "HS01", StorageLocationName: "High Security 01", Plant: sPlant },
                        { StorageLocation: "MT01", StorageLocationName: "Material Store 01", Plant: sPlant }
                    ]);
                    oDialog.setModel(oModel);
                    oDialog.bindAggregation("items", "/", oTemplate);
                    oDialog.open();
                });
        },

        // =============================================================
        // SUBMIT POST GOODS ISSUE 201
        // =============================================================

        onPostGoodsIssue: function () {
            if (!this._validateLive()) {
                MessageBox.error(this.getText("gi201ValidationErrorsSummary"));
                return;
            }

            var that = this;
            var oData = this._oModel.getData();
            var oPayload = GoodsIssue201Model.toBackendPayload(oData);

            this._oModel.setProperty("/busy", true);

            GoodsIssue201Service.postGoodsIssue(oPayload)
                .then(function (res) {
                    that._oModel.setProperty("/busy", false);

                    // Honest outcome: a QUEUED result (no SAP material document) means SAP has NOT
                    // persisted the document - it was only recorded in the dispatch queue while the
                    // S/4HANA Gateway service is inactive. Never claim a successful SAP posting or
                    // offer reversal for a document that does not exist in SAP.
                    if (res && (res.Queued === true || !res.MaterialDocument)) {
                        that._oModel.setProperty("/hasPosted", false);
                        MessageBox.warning(res.Message || that.getText("giPostQueuedMsg"), {
                            title: that.getText("giPostQueuedTitle")
                        });
                        return;
                    }

                    that._oModel.setProperty("/hasPosted", true);
                    that._oModel.setProperty("/postedDocument", res.MaterialDocument || "");
                    that._oModel.setProperty("/postedYear", res.MaterialDocYear || new Date().getFullYear().toString());

                    var sDocMsg = that.getText("gi201PostSuccessMsg", [
                        res.MaterialDocument || "Document",
                        res.MaterialDocYear || ""
                    ]);

                    MessageBox.success(sDocMsg, {
                        title: that.getText("gi201PostSuccessTitle"),
                        actions: [that.getText("gi201ActionReverseNow"), MessageBox.Action.CLOSE],
                        emphasizedAction: MessageBox.Action.CLOSE,
                        onClose: function (sAction) {
                            if (sAction === that.getText("gi201ActionReverseNow")) {
                                that.onReverseGoodsIssue();
                            }
                        }
                    });
                })
                .catch(function (err) {
                    that._oModel.setProperty("/busy", false);
                    var sErrMsg = err.message || that.getText("gi201PostGenericError");
                    if (err.response && err.response.data && err.response.data.error) {
                        var oErr = err.response.data.error;
                        sErrMsg = (oErr.message && oErr.message.value) || oErr.message || sErrMsg;
                    }
                    MessageBox.error(sErrMsg, {
                        title: that.getText("gi201PostFailedTitle")
                    });
                });
        },

        // =============================================================
        // REVERSAL (202 via CancelHeader)
        // =============================================================

        onReverseGoodsIssue: function () {
            var sDoc = this._oModel.getProperty("/postedDocument");
            var sYear = this._oModel.getProperty("/postedYear") || new Date().getFullYear().toString();
            var sPostingDate = this._oModel.getProperty("/postingDate");

            if (!sDoc) {
                MessageToast.show(this.getText("gi201NoDocumentToReverse"));
                return;
            }

            var that = this;
            var sConfirmMsg = this.getText("gi201ReverseConfirmPrompt", [sDoc, sYear]);

            MessageBox.confirm(sConfirmMsg, {
                title: this.getText("gi201ReverseConfirmTitle"),
                actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.OK,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        that._executeReversal(sDoc, sYear, sPostingDate);
                    }
                }
            });
        },

        _executeReversal: function (sDoc, sYear, sPostingDate) {
            var that = this;
            this._oModel.setProperty("/reversalBusy", true);

            GoodsIssue201Service.reverseGoodsIssue(sDoc, sYear, sPostingDate, "01")
                .then(function (res) {
                    that._oModel.setProperty("/reversalBusy", false);
                    that._oModel.setProperty("/hasReversed", true);
                    that._oModel.setProperty("/reversalDocument", res.ReversalMaterialDocument || "");
                    that._oModel.setProperty("/reversalYear", res.ReversalMaterialDocYear || sYear);

                    var sSuccess = that.getText("gi201ReverseSuccessMsg", [
                        sDoc,
                        res.ReversalMaterialDocument || ""
                    ]);

                    MessageBox.success(sSuccess, {
                        title: that.getText("gi201ReverseSuccessTitle"),
                        onClose: function () {
                            that._resetModel();
                        }
                    });
                })
                .catch(function (err) {
                    that._oModel.setProperty("/reversalBusy", false);
                    var sErrMsg = err.message || that.getText("gi201ReverseGenericError");
                    if (err.response && err.response.data && err.response.data.error) {
                        var oErr = err.response.data.error;
                        sErrMsg = (oErr.message && oErr.message.value) || oErr.message || sErrMsg;
                    }
                    MessageBox.error(sErrMsg, {
                        title: that.getText("gi201ReverseFailedTitle")
                    });
                });
        },

        onResetForm: function () {
            var that = this;
            MessageBox.confirm(this.getText("gi201ResetConfirm"), {
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        that._resetModel();
                        MessageToast.show(that.getText("gi201FormReset"));
                    }
                }
            });
        },

        onNavBack: function () {
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.navTo("wmGoodsIssue");
            }
        }
    });
});
