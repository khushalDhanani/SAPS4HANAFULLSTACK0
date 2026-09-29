sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "saps4hana/fiori/modules/wm/goods-issue/model/GoodsIssue301Model",
    "saps4hana/fiori/modules/wm/goods-issue/service/GoodsIssue301Service"
], function (
    BaseController,
    JSONModel,
    MessageBox,
    MessageToast,
    SelectDialog,
    StandardListItem,
    Filter,
    FilterOperator,
    GoodsIssue301Model,
    GoodsIssue301Service
) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.wm.goods-issue.controller.GoodsIssue301", {

        onInit: function () {
            this._oModel = GoodsIssue301Model.createInitialModel();
            this.getView().setModel(this._oModel, "gi301");

            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.getRoute("wmGoodsIssue301").attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _onRouteMatched: function () {
            this._resetModel();
        },

        _resetModel: function () {
            var oInitData = GoodsIssue301Model.getInitialData();
            this._oModel.setData(oInitData);
            this._aResolvedItems = [];
            this._validateLive();
        },

        // =============================================================
        // FORMATTERS
        // =============================================================

        formatSuccessBanner: function (sDoc, sYear) {
            if (!sDoc) return "";
            return this.getText("gi301SuccessBannerText", [sDoc, sYear || ""]);
        },

        formatReversalBanner: function (sDoc, sYear) {
            if (!sDoc) return "";
            return this.getText("gi301ReversalBannerText", [sDoc, sYear || ""]);
        },

        formatOpenQty: function (nQty, sUnit) {
            if (nQty === null || nQty === undefined) return "";
            return nQty + " " + (sUnit || "");
        },

        // =============================================================
        // LIVE VALIDATION
        // =============================================================

        _validateLive: function () {
            var oData = this._oModel.getData();
            var oResult = GoodsIssue301Model.validate(oData);
            this._oModel.setProperty("/errors", oResult.errors);
            this._oModel.setProperty("/isValid", oResult.isValid);
            return oResult.isValid;
        },

        onFieldLiveChange: function () {
            this._validateLive();
        },

        onQuantityLiveChange: function (oEvent) {
            var sVal = oEvent.getParameter("value") || "";
            var nVal = parseFloat(sVal);
            this._oModel.setProperty("/quantity", isNaN(nVal) ? sVal : nVal);
            this._validateLive();
        },

        // =============================================================
        // RESERVATION VALUE HELP & ITEM RESOLUTION
        // =============================================================
        // This movement type has no unplanned/manual posting path on the backend
        // (GoodsIssuePostingClient.postGoodsIssue requires ReservationNo + ReservationItem for
        // every movement type other than 201), so Material/Plant/Storage Location/Unit/Order are
        // always DERIVED from the resolved reservation item, never freely entered.

        onReservationValueHelp: function () {
            var that = this;
            var oDialog = new SelectDialog({
                title: this.getText("gi301SelectReservation"),
                noDataText: this.getText("gi301NoReservationsFound"),
                search: function (oEvt) {
                    var sVal = oEvt.getParameter("value") || "";
                    var oBinding = oEvt.getSource().getBinding("items");
                    if (oBinding) {
                        var aFilters = sVal ? [
                            new Filter({
                                filters: [
                                    new Filter("ReservationNo", FilterOperator.Contains, sVal),
                                    new Filter("OrderNo", FilterOperator.Contains, sVal),
                                    new Filter("DisplayText", FilterOperator.Contains, sVal)
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
                        var sResv = oSelectedItem.getTitle();
                        that._oModel.setProperty("/reservationNo", sResv);
                        that._oModel.setProperty("/reservationItem", "");
                        that._oModel.setProperty("/orderNo", "");
                        that._oModel.setProperty("/material", "");
                        that._oModel.setProperty("/materialName", "");
                        that._loadReservationItems(sResv);
                    }
                }
            });

            var oItemTemplate = new StandardListItem({
                title: "{ReservationNo}",
                description: "{DisplayText}",
                info: "{OrderNo}"
            });

            GoodsIssue301Service.fetchOpenReservations()
                .then(function (aItems) {
                    var oHelpModel = new JSONModel(aItems);
                    oDialog.setModel(oHelpModel);
                    oDialog.bindAggregation("items", "/", oItemTemplate);
                    oDialog.open();
                })
                .catch(function (err) {
                    MessageBox.error("Failed to load open Reservations: " + (err.message || err));
                });
        },

        /**
         * Load and cache the open items of a Reservation. Auto-applies the item when exactly one
         * is open; otherwise lets the user pick one via a second Value Help (or via typing the
         * Reservation Item number directly and triggering onReservationItemChange).
         */
        _loadReservationItems: function (sReservationNo) {
            var that = this;
            this._oModel.setProperty("/itemLoading", true);

            return GoodsIssue301Service.fetchReservationItems(sReservationNo)
                .then(function (aItems) {
                    that._aResolvedItems = aItems || [];
                    if (that._aResolvedItems.length === 1) {
                        GoodsIssue301Model.applyReservationItem(that._oModel.getData(), that._aResolvedItems[0]);
                        that._oModel.refresh(true);
                    } else if (that._aResolvedItems.length > 1) {
                        that._openReservationItemPicker();
                    } else {
                        MessageToast.show(that.getText("gi301NoItemsFound"));
                    }
                    that._validateLive();
                })
                .catch(function (err) {
                    MessageBox.error("Failed to load Reservation Items: " + (err.message || err));
                })
                .finally(function () {
                    that._oModel.setProperty("/itemLoading", false);
                });
        },

        _openReservationItemPicker: function () {
            var that = this;
            var oDialog = new SelectDialog({
                title: this.getText("gi301SelectReservationItem"),
                confirm: function (oEvt) {
                    var oSelectedItem = oEvt.getParameter("selectedItem");
                    if (oSelectedItem) {
                        var oCtx = oSelectedItem.getBindingContext();
                        var oRow = oCtx ? oCtx.getObject() : null;
                        if (oRow) {
                            GoodsIssue301Model.applyReservationItem(that._oModel.getData(), oRow);
                            that._oModel.refresh(true);
                            that._validateLive();
                        }
                    }
                }
            });

            var oTemplate = new StandardListItem({
                title: "{ReservationItem}",
                description: "{Material} - {MaterialDesc}",
                info: "{OpenQty} {Unit}"
            });

            var oListModel = new JSONModel(this._aResolvedItems);
            oDialog.setModel(oListModel);
            oDialog.bindAggregation("items", "/", oTemplate);
            oDialog.open();
        },

        /**
         * Manual entry path: the user typed a Reservation Item number directly (already knows the
         * combination) instead of using the picker. Matches it against the cached items for the
         * current Reservation, fetching them first if the cache is empty.
         */
        onReservationItemChange: function (oEvent) {
            var that = this;
            var sTyped = (oEvent.getParameter("value") || "").trim();
            var sResv = this._oModel.getProperty("/reservationNo");
            if (!sTyped || !sResv) {
                this._validateLive();
                return;
            }

            var sPadded = sTyped.padStart(4, "0");

            var applyFromCache = function () {
                var oMatch = (that._aResolvedItems || []).filter(function (it) {
                    var sItemNo = it.ReservationItem != null ? String(it.ReservationItem).trim().padStart(4, "0") : "";
                    return sItemNo === sPadded;
                })[0];
                if (oMatch) {
                    GoodsIssue301Model.applyReservationItem(that._oModel.getData(), oMatch);
                    that._oModel.refresh(true);
                } else {
                    MessageToast.show(that.getText("gi301NoItemsFound"));
                }
                that._validateLive();
            };

            if (this._aResolvedItems && this._aResolvedItems.length > 0) {
                applyFromCache();
            } else {
                this._loadReservationItems(sResv).then(applyFromCache);
            }
        },

        // =============================================================
        // SERIAL NUMBERS SCAN & MANAGEMENT
        // =============================================================

        onAddSerialPress: function () {
            var sInput = this._oModel.getProperty("/serialInput") || "";
            var oData = this._oModel.getData();
            var oRes = GoodsIssue301Model.addSerialNumber(oData, sInput);

            if (!oRes.success) {
                MessageToast.show(oRes.message);
                return;
            }

            this._oModel.refresh(true);
            this._validateLive();
            MessageToast.show(this.getText("gi301SerialAdded", [sInput.trim().toUpperCase()]));
        },

        onSerialInputSubmit: function () {
            this.onAddSerialPress();
        },

        onDeleteSerial: function (oEvent) {
            var oSource = oEvent.getSource();
            var oCtx = oSource.getBindingContext("gi301");
            if (!oCtx) return;

            var sPath = oCtx.getPath();
            var nIndex = parseInt(sPath.split("/").pop(), 10);
            var oData = this._oModel.getData();
            GoodsIssue301Model.removeSerialNumber(oData, nIndex);

            this._oModel.refresh(true);
            this._validateLive();
            MessageToast.show(this.getText("gi301SerialRemoved"));
        },

        // =============================================================
        // RECEIVING PLANT / STORAGE LOCATION VALUE HELP (optional fields)
        // =============================================================

        onReceivingPlantValueHelp: function () {
            var that = this;
            var oDialog = new SelectDialog({
                title: this.getText("gi301SelectReceivingPlant"),
                confirm: function (oEvt) {
                    var oItem = oEvt.getParameter("selectedItem");
                    if (oItem) {
                        that._oModel.setProperty("/receivingPlant", oItem.getTitle());
                        that._oModel.setProperty("/receivingPlantName", oItem.getDescription());
                        that._validateLive();
                    }
                }
            });

            var oTemplate = new StandardListItem({
                title: "{Plant}",
                description: "{PlantName}"
            });

            GoodsIssue301Service.fetchPlants()
                .then(function (aPlants) {
                    var oModel = new JSONModel(aPlants);
                    oDialog.setModel(oModel);
                    oDialog.bindAggregation("items", "/", oTemplate);
                    oDialog.open();
                })
                .catch(function () {
                    var oModel = new JSONModel([
                        { Plant: "1120", PlantName: "Aether Main Plant" },
                        { Plant: "1110", PlantName: "Aether Specialty Plant" }
                    ]);
                    oDialog.setModel(oModel);
                    oDialog.bindAggregation("items", "/", oTemplate);
                    oDialog.open();
                });
        },

        onReceivingStorageLocationValueHelp: function () {
            var that = this;
            var sPlant = this._oModel.getProperty("/receivingPlant") || "1120";

            var oDialog = new SelectDialog({
                title: this.getText("gi301SelectReceivingStorageLocation"),
                confirm: function (oEvt) {
                    var oItem = oEvt.getParameter("selectedItem");
                    if (oItem) {
                        that._oModel.setProperty("/receivingStorageLocation", oItem.getTitle());
                        that._oModel.setProperty("/receivingStorageLocationName", oItem.getDescription());
                        that._validateLive();
                    }
                }
            });

            var oTemplate = new StandardListItem({
                title: "{StorageLocation}",
                description: "{StorageLocationName}",
                info: "{Plant}"
            });

            GoodsIssue301Service.fetchStorageLocations(sPlant)
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
        // SUBMIT POST GOODS ISSUE 301
        // =============================================================

        onPostGoodsIssue: function () {
            if (!this._validateLive()) {
                MessageBox.error(this.getText("gi301ValidationErrorsSummary"));
                return;
            }

            var that = this;
            var oData = this._oModel.getData();
            var oPayload = GoodsIssue301Model.toBackendPayload(oData);

            this._oModel.setProperty("/busy", true);

            GoodsIssue301Service.postGoodsIssue(oPayload)
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

                    var sDocMsg = that.getText("gi301PostSuccessMsg", [
                        res.MaterialDocument || "Document",
                        res.MaterialDocYear || ""
                    ]);

                    MessageBox.success(sDocMsg, {
                        title: that.getText("gi301PostSuccessTitle"),
                        actions: [that.getText("gi301ActionReverseNow"), MessageBox.Action.CLOSE],
                        emphasizedAction: MessageBox.Action.CLOSE,
                        onClose: function (sAction) {
                            if (sAction === that.getText("gi301ActionReverseNow")) {
                                that.onReverseGoodsIssue();
                            }
                        }
                    });
                })
                .catch(function (err) {
                    that._oModel.setProperty("/busy", false);
                    // Backend surfaces the real SAP business error (sap-message severity, or a
                    // reclassified 400/409/422) as err.message - see GoodsIssuePostingClient.
                    var sErrMsg = err.message || that.getText("gi301PostGenericError");
                    if (err.response && err.response.data && err.response.data.error) {
                        var oErr = err.response.data.error;
                        sErrMsg = (oErr.message && oErr.message.value) || oErr.message || sErrMsg;
                    }
                    MessageBox.error(sErrMsg, {
                        title: that.getText("gi301PostFailedTitle")
                    });
                });
        },

        // =============================================================
        // REVERSAL (via CancelHeader)
        // =============================================================

        onReverseGoodsIssue: function () {
            var sDoc = this._oModel.getProperty("/postedDocument");
            var sYear = this._oModel.getProperty("/postedYear") || new Date().getFullYear().toString();
            var sPostingDate = this._oModel.getProperty("/postingDate");

            if (!sDoc) {
                MessageToast.show(this.getText("gi301NoDocumentToReverse"));
                return;
            }

            var that = this;
            var sConfirmMsg = this.getText("gi301ReverseConfirmPrompt", [sDoc, sYear]);

            MessageBox.confirm(sConfirmMsg, {
                title: this.getText("gi301ReverseConfirmTitle"),
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

            GoodsIssue301Service.reverseGoodsIssue(sDoc, sYear, sPostingDate, "01")
                .then(function (res) {
                    that._oModel.setProperty("/reversalBusy", false);
                    that._oModel.setProperty("/hasReversed", true);
                    that._oModel.setProperty("/reversalDocument", res.ReversalMaterialDocument || "");
                    that._oModel.setProperty("/reversalYear", res.ReversalMaterialDocYear || sYear);

                    var sSuccess = that.getText("gi301ReverseSuccessMsg", [
                        sDoc,
                        res.ReversalMaterialDocument || ""
                    ]);

                    MessageBox.success(sSuccess, {
                        title: that.getText("gi301ReverseSuccessTitle"),
                        onClose: function () {
                            that._resetModel();
                        }
                    });
                })
                .catch(function (err) {
                    that._oModel.setProperty("/reversalBusy", false);
                    var sErrMsg = err.message || that.getText("gi301ReverseGenericError");
                    if (err.response && err.response.data && err.response.data.error) {
                        var oErr = err.response.data.error;
                        sErrMsg = (oErr.message && oErr.message.value) || oErr.message || sErrMsg;
                    }
                    MessageBox.error(sErrMsg, {
                        title: that.getText("gi301ReverseFailedTitle")
                    });
                });
        },

        onResetForm: function () {
            var that = this;
            MessageBox.confirm(this.getText("gi301ResetConfirm"), {
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        that._resetModel();
                        MessageToast.show(that.getText("gi301FormReset"));
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
