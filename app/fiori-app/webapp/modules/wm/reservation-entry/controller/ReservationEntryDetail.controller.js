sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "../service/ReservationEntryService",
    "saps4hana/fiori/service/ValueHelpService",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (BaseController, JSONModel, MessageBox, MessageToast, ReservationEntryService, ValueHelpService, Filter, FilterOperator) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.wm.reservation-entry.controller.ReservationEntryDetail", {

        onInit: function () {
            this._oService = new ReservationEntryService();

            this._oViewModel = new JSONModel({
                isCreate: false,
                busy: false,
                errorMessage: "",
                successMessage: ""
            });
            this.getView().setModel(this._oViewModel, "view");

            this._oCreateModel = new JSONModel(this._getDefaultCreateData());
            this.getView().setModel(this._oCreateModel, "create");

            this._oDetailModel = new JSONModel({});
            this.getView().setModel(this._oDetailModel, "detail");

            const oRouter = this.getRouter();
            if (oRouter) {
                const oRouteCreate = oRouter.getRoute("wmReservationEntryCreate");
                if (oRouteCreate) {
                    oRouteCreate.attachPatternMatched(this._onRouteCreateMatched, this);
                }
                const oRouteDetail = oRouter.getRoute("wmReservationEntryDetail");
                if (oRouteDetail) {
                    oRouteDetail.attachPatternMatched(this._onRouteDetailMatched, this);
                }
            }
        },

        // No master-data defaults: plant, storage locations, material, unit, account assignment and
        // order data come from the user via the value helps (PlantVH, StorageLocationVH, MaterialVH,
        // CostCenterVH, OrderTypeVH, InternalOrderVH). MovementType is the first entry of the select.
        _getDefaultCreateData: function () {
            return {
                MovementType: "",
                Plant: "",
                StorageLocation: "",
                WarehouseNumber: "",
                Material: "",
                MaterialName: "",
                Quantity: "",
                Unit: "",
                Batch: "",
                ReceivingStorageLocation: "",
                ReceivingPlant: "",
                CostCenter: "",
                AssetNo: "",
                SubNumber: "",
                OrderType: "",
                OrderID: ""
            };
        },

        // One id per create form instance: a re-submit of the same form (double click, retry after a
        // timeout) carries the same id, so the backend can answer with the reservation it already created.
        _newClientAttemptId: function () {
            this._sClientAttemptId = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
            return this._sClientAttemptId;
        },

        _onRouteCreateMatched: function () {
            this._newClientAttemptId();
            this._oViewModel.setProperty("/isCreate", true);
            this._oViewModel.setProperty("/isTracked", false);
            this._oViewModel.setProperty("/busy", false);
            this._oViewModel.setProperty("/errorMessage", "");
            this._oViewModel.setProperty("/successMessage", "");
            this._oCreateModel.setData(this._getDefaultCreateData());
        },

        _onRouteDetailMatched: function (oEvent) {
            const oArgs = oEvent.getParameter("arguments") || {};
            const sResNo = oArgs.ReservationNo;
            const sResItem = oArgs.ReservationItem || "0001";

            this._oViewModel.setProperty("/isCreate", false);
            this._oViewModel.setProperty("/busy", true);
            this._oViewModel.setProperty("/errorMessage", "");
            this._oViewModel.setProperty("/successMessage", "");

            this._loadDetail(sResNo, sResItem);
        },

        _loadDetail: function (sResNo, sResItem) {
            const that = this;
            this._sCurrentResNo = sResNo;
            this._sCurrentResItem = sResItem;
            this._oViewModel.setProperty("/busy", true);

            if (!sResNo || !String(sResNo).trim()) {
                this._oViewModel.setProperty("/busy", false);
                this._oViewModel.setProperty("/isTracked", false);
                this._oViewModel.setProperty("/errorMessage", "Reservation number is required");
                this._oDetailModel.setData({});
                return Promise.resolve();
            }

            return this._oService.getEntry(sResNo, sResItem).then(function (oData) {
                if (oData) {
                    oData.CreatedByUser = oData.CreatedByUser || oData.createdBy || "";
                }
                that._oDetailModel.setData(oData || {});
                that._oViewModel.setProperty("/isTracked", true);
                that._oViewModel.setProperty("/busy", false);
                if (oData && (!oData.TransferRequirement || !oData.TransferOrder || !oData.MaterialDocument || !oData.CreatedByUser)) {
                    return that._oService.getReservationDetail(sResNo, sResItem).then(function (oLive) {
                        if (oLive) {
                            var oMerged = Object.assign({}, oLive, oData);
                            if (!oData.CreatedByUser && (oLive.CreatedByUser || oLive.createdBy)) {
                                oMerged.CreatedByUser = oLive.CreatedByUser || oLive.createdBy;
                            }
                            if (!oData.TransferRequirement && oLive.TransferRequirement) {
                                oMerged.TransferRequirement = oLive.TransferRequirement;
                            }
                            if (!oData.TransferOrder && oLive.TransferOrder) {
                                oMerged.TransferOrder = oLive.TransferOrder;
                            }
                            if (!oData.MaterialDocument && oLive.MaterialDocument) {
                                oMerged.MaterialDocument = oLive.MaterialDocument;
                                oMerged.MaterialDocYear = oLive.MaterialDocYear;
                            }
                            that._oDetailModel.setData(oMerged);
                        }
                    }).catch(function () {});
                }
            }).catch(function () {
                // Not tracked locally (reservation created outside this app) -> read it live from SAP.
                return that._oService.getReservationDetail(sResNo, sResItem).then(function (oLive) {
                    oLive = oLive || {};
                    oLive.CreatedByUser = oLive.CreatedByUser || oLive.createdBy || "";
                    if (!oLive.Logs) { oLive.Logs = []; }
                    that._oDetailModel.setData(oLive);
                    that._oViewModel.setProperty("/isTracked", false);
                    that._oViewModel.setProperty("/busy", false);
                });
            }).catch(function (err) {
                that._oViewModel.setProperty("/isTracked", false);
                that._oViewModel.setProperty("/busy", false);
                that._oViewModel.setProperty("/errorMessage", err.message || "Failed to load reservation");
            });
        },

        onRefresh: function () {
            if (this._sCurrentResNo) {
                this._loadDetail(this._sCurrentResNo, this._sCurrentResItem);
                MessageToast.show("Details refreshed");
            }
        },

        onRetryStepPress: function () {
            const that = this;
            if (this._oViewModel.getProperty("/busy")) return;
            if (!this._sCurrentResNo) return;

            this._oViewModel.setProperty("/busy", true);
            this._oViewModel.setProperty("/errorMessage", "");

            this._oService.retryStep(this._sCurrentResNo, this._sCurrentResItem || "0001", "AUTO").then(function (oUpdated) {
                that._oViewModel.setProperty("/busy", false);
                const sStatus = oUpdated.Status_code;
                if (["11", "12", "13", "90", "99"].indexOf(sStatus) >= 0) {
                    const sErr = oUpdated.ErrorMessage || "Retry completed with errors";
                    that._oViewModel.setProperty("/errorMessage", sErr);
                    MessageBox.warning(sErr);
                } else {
                    MessageToast.show("Step successfully executed! Current Status: " + sStatus);
                }
                that._loadDetail(that._sCurrentResNo, that._sCurrentResItem);
            }).catch(function (err) {
                that._oViewModel.setProperty("/busy", false);
                const sError = err.message || "Retry failed";
                that._oViewModel.setProperty("/errorMessage", sError);
                MessageBox.error(sError);
            });
        },

        onMovementTypeChange: function (oEvent) {
            const sMvt = oEvent.getParameter("selectedItem") ? oEvent.getParameter("selectedItem").getKey() : this._oCreateModel.getProperty("/MovementType");
            this._oCreateModel.setProperty("/MovementType", sMvt);
            this._oViewModel.setProperty("/errorMessage", "");

            // Clear the fields the selected movement type does not use; never prefill business values.
            switch (sMvt) {
                case "201":
                    this._oCreateModel.setProperty("/ReceivingStorageLocation", "");
                    this._oCreateModel.setProperty("/ReceivingPlant", "");
                    this._oCreateModel.setProperty("/AssetNo", "");
                    this._oCreateModel.setProperty("/SubNumber", "");
                    this._oCreateModel.setProperty("/OrderType", "");
                    this._oCreateModel.setProperty("/OrderID", "");
                    break;
                case "241":
                    this._oCreateModel.setProperty("/ReceivingStorageLocation", "");
                    this._oCreateModel.setProperty("/ReceivingPlant", "");
                    this._oCreateModel.setProperty("/CostCenter", "");
                    this._oCreateModel.setProperty("/OrderType", "");
                    this._oCreateModel.setProperty("/OrderID", "");
                    break;
                case "311":
                    // A receiving SLoc equal to the issuing one is invalid for 311: clear it, the user picks another.
                    if (this._oCreateModel.getProperty("/ReceivingStorageLocation") === this._oCreateModel.getProperty("/StorageLocation")) {
                        this._oCreateModel.setProperty("/ReceivingStorageLocation", "");
                    }
                    this._oCreateModel.setProperty("/ReceivingPlant", "");
                    this._oCreateModel.setProperty("/CostCenter", "");
                    this._oCreateModel.setProperty("/AssetNo", "");
                    this._oCreateModel.setProperty("/SubNumber", "");
                    this._oCreateModel.setProperty("/OrderType", "");
                    this._oCreateModel.setProperty("/OrderID", "");
                    break;
                case "301":
                    this._oCreateModel.setProperty("/CostCenter", "");
                    this._oCreateModel.setProperty("/AssetNo", "");
                    this._oCreateModel.setProperty("/SubNumber", "");
                    this._oCreateModel.setProperty("/OrderType", "");
                    this._oCreateModel.setProperty("/OrderID", "");
                    break;
                case "261":
                    this._oCreateModel.setProperty("/OrderID", "");
                    this._oCreateModel.setProperty("/ReceivingStorageLocation", "");
                    this._oCreateModel.setProperty("/ReceivingPlant", "");
                    this._oCreateModel.setProperty("/CostCenter", "");
                    this._oCreateModel.setProperty("/AssetNo", "");
                    this._oCreateModel.setProperty("/SubNumber", "");
                    break;
            }
        },

        onFieldLiveChange: function () {
            if (this._oViewModel.getProperty("/errorMessage")) {
                this._oViewModel.setProperty("/errorMessage", "");
            }
        },

        onSuggest: function (oEvent) {
            var oInput = oEvent.getSource();
            var sValue = oEvent.getParameter("suggestValue") || "";
            var aContextFilters = [];
            var sId = oInput.getId();

            if (sId.indexOf("inputStorageLocation") !== -1) {
                var sPlant = this._oCreateModel.getProperty("/Plant");
                if (sPlant) {
                    aContextFilters.push(new Filter("Plant", FilterOperator.EQ, sPlant));
                }
            } else if (sId.indexOf("inputRecSLoc") !== -1) {
                var sRecPlant = this._oCreateModel.getProperty("/ReceivingPlant") || this._oCreateModel.getProperty("/Plant");
                if (sRecPlant) {
                    aContextFilters.push(new Filter("Plant", FilterOperator.EQ, sRecPlant));
                }
            } else if (sId.indexOf("inputMaterial") !== -1) {
                var sMatPlant = this._oCreateModel.getProperty("/Plant");
                if (sMatPlant) {
                    aContextFilters.push(new Filter("Plant", FilterOperator.EQ, sMatPlant));
                }
            } else if (sId.indexOf("inputOrderId") !== -1) {
                var sOrderTypeSug = this._oCreateModel.getProperty("/OrderType");
                if (sOrderTypeSug) {
                    aContextFilters.push(new Filter("OrderType", FilterOperator.EQ, sOrderTypeSug));
                }
                var sOrdPlantSug = this._oCreateModel.getProperty("/Plant");
                if (sOrdPlantSug) {
                    aContextFilters.push(new Filter("Plant", FilterOperator.EQ, sOrdPlantSug));
                }
            }

            if (ValueHelpService && typeof ValueHelpService.applySuggestionFilter === "function") {
                ValueHelpService.applySuggestionFilter(oInput, sValue, aContextFilters);
            }
        },

        onValueHelpRequest: function (oEvent) {
            var oInput = oEvent.getSource();
            var oView = this.getView();
            var that = this;
            var aInitialFilters = [];
            var sId = oInput.getId();

            if (sId.indexOf("inputStorageLocation") !== -1) {
                var sPlant = this._oCreateModel.getProperty("/Plant");
                if (sPlant) {
                    aInitialFilters.push(new Filter("Plant", FilterOperator.EQ, sPlant));
                }
            } else if (sId.indexOf("inputRecSLoc") !== -1) {
                var sRecPlant = this._oCreateModel.getProperty("/ReceivingPlant") || this._oCreateModel.getProperty("/Plant");
                if (sRecPlant) {
                    aInitialFilters.push(new Filter("Plant", FilterOperator.EQ, sRecPlant));
                }
            } else if (sId.indexOf("inputMaterial") !== -1) {
                var sMatPlant = this._oCreateModel.getProperty("/Plant");
                if (sMatPlant) {
                    aInitialFilters.push(new Filter("Plant", FilterOperator.EQ, sMatPlant));
                }
            } else if (sId.indexOf("inputOrderId") !== -1) {
                var sOrderTypeVH = this._oCreateModel.getProperty("/OrderType");
                if (sOrderTypeVH) {
                    aInitialFilters.push(new Filter("OrderType", FilterOperator.EQ, sOrderTypeVH));
                }
                var sOrdPlantVH = this._oCreateModel.getProperty("/Plant");
                if (sOrdPlantVH) {
                    aInitialFilters.push(new Filter("Plant", FilterOperator.EQ, sOrdPlantVH));
                }
            }

            if (ValueHelpService && typeof ValueHelpService.openValueHelp === "function") {
                ValueHelpService.openValueHelp(oView, oInput, function (sKey, oSelectedItem, oData) {
                    that._handleValueHelpSelected(oInput, sKey, oSelectedItem, oData);
                }, aInitialFilters);
            }
        },

        _handleValueHelpSelected: function (oInput, sKey, oSelectedItem, oData) {
            if (!oInput || !sKey) return;
            var sId = oInput.getId();

            if (sId.indexOf("inputMaterial") !== -1) {
                this._oCreateModel.setProperty("/Material", sKey);
                var sMatName = (oData && (oData.MaterialName || oData.Material_Text)) || (oSelectedItem && oSelectedItem.getDescription && oSelectedItem.getDescription()) || "";
                if (!sMatName && oSelectedItem && oSelectedItem.getCells) {
                    var aCells = oSelectedItem.getCells();
                    sMatName = (aCells[1] && aCells[1].getText && aCells[1].getText()) || "";
                }
                if (sMatName) {
                    this._oCreateModel.setProperty("/MaterialName", sMatName);
                }
                var sUnit = (oData && oData.MaterialBaseUnit) || "";
                if (!sUnit && oSelectedItem && oSelectedItem.getCells) {
                    var aCells2 = oSelectedItem.getCells();
                    sUnit = (aCells2[4] && aCells2[4].getText && aCells2[4].getText()) || "";
                }
                if (sUnit) {
                    this._oCreateModel.setProperty("/Unit", sUnit);
                }
                oInput.setValueState("None");
            } else if (sId.indexOf("inputPlant") !== -1) {
                this._oCreateModel.setProperty("/Plant", sKey);
                oInput.setValueState("None");
            } else if (sId.indexOf("inputStorageLocation") !== -1) {
                this._oCreateModel.setProperty("/StorageLocation", sKey);
                if (oData && oData.Plant && !this._oCreateModel.getProperty("/Plant")) {
                    this._oCreateModel.setProperty("/Plant", oData.Plant);
                }
                if (this._oCreateModel.getProperty("/MovementType") === "311" && this._oCreateModel.getProperty("/ReceivingStorageLocation") === sKey) {
                    this._oCreateModel.setProperty("/ReceivingStorageLocation", ""); // same SLoc is invalid for 311
                }
                oInput.setValueState("None");
            } else if (sId.indexOf("inputRecSLoc") !== -1) {
                this._oCreateModel.setProperty("/ReceivingStorageLocation", sKey);
                oInput.setValueState("None");
            } else if (sId.indexOf("inputRecPlant") !== -1) {
                this._oCreateModel.setProperty("/ReceivingPlant", sKey);
                oInput.setValueState("None");
            } else if (sId.indexOf("inputCostCenter") !== -1) {
                this._oCreateModel.setProperty("/CostCenter", sKey);
                oInput.setValueState("None");
            } else if (sId.indexOf("inputBatch") !== -1) {
                this._oCreateModel.setProperty("/Batch", sKey);
                oInput.setValueState("None");
            } else if (sId.indexOf("inputOrderType") !== -1) {
                var sOldTypeVal = this._oCreateModel.getProperty("/OrderType");
                this._oCreateModel.setProperty("/OrderType", sKey);
                if (sOldTypeVal !== sKey) {
                    this._oCreateModel.setProperty("/OrderID", "");
                }
                oInput.setValueState("None");
            } else if (sId.indexOf("inputOrderId") !== -1) {
                this._oCreateModel.setProperty("/OrderID", sKey);
                if (oData && oData.OrderType) {
                    this._oCreateModel.setProperty("/OrderType", oData.OrderType);
                }
                oInput.setValueState("None");
            }
            this.onFieldLiveChange();
        },

        onCostCenterSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            var oContext = oItem.getBindingContext();
            var oData = oContext ? oContext.getObject() : null;
            this._handleValueHelpSelected(oEvent.getSource(), sKey, oItem, oData);
        },

        onMaterialSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            var oContext = oItem.getBindingContext();
            var oData = oContext ? oContext.getObject() : null;
            this._handleValueHelpSelected(oEvent.getSource(), sKey, oItem, oData);
        },

        onPlantSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            this._handleValueHelpSelected(oEvent.getSource(), sKey, oItem, null);
        },

        onStorageLocationSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            var oContext = oItem.getBindingContext();
            var oData = oContext ? oContext.getObject() : null;
            this._handleValueHelpSelected(oEvent.getSource(), sKey, oItem, oData);
        },

        onRecSLocSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            this._handleValueHelpSelected(oEvent.getSource(), sKey, oItem, null);
        },

        onRecPlantSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            this._handleValueHelpSelected(oEvent.getSource(), sKey, oItem, null);
        },

        onOrderTypeValueHelpRequest: function (oEvent) {
            this.onValueHelpRequest(oEvent);
        },

        onInternalOrderValueHelpRequest: function (oEvent) {
            var sOrderType = this._oCreateModel.getProperty("/OrderType");
            if (!sOrderType) {
                var oBundle = this.getView().getModel("i18n") ? this.getView().getModel("i18n").getResourceBundle() : null;
                var sMsg = oBundle ? oBundle.getText("resErrorSelectOrderTypeFirst") : "Please select an Order Type from the list before entering or selecting the Order.";
                MessageBox.warning(sMsg);
                return;
            }
            this.onValueHelpRequest(oEvent);
        },

        onOrderTypeSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            var sOldKey = this._oCreateModel.getProperty("/OrderType");
            this._handleValueHelpSelected(oEvent.getSource(), sKey, oItem, null);
            if (sOldKey !== sKey) {
                this._oCreateModel.setProperty("/OrderID", "");
            }
        },

        onOrderTypeChange: function (oEvent) {
            var sNewType = oEvent.getParameter("value") !== undefined ? oEvent.getParameter("value") : this._oCreateModel.getProperty("/OrderType");
            var sOldType = this._oCreateModel.getProperty("/OrderType");
            this._oCreateModel.setProperty("/OrderType", sNewType);
            if (sOldType !== sNewType) {
                this._oCreateModel.setProperty("/OrderID", "");
            }
            this.onFieldLiveChange();
        },

        onInternalOrderSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            this._handleValueHelpSelected(oEvent.getSource(), sKey, oItem, null);
        },

        onCloseErrorMessage: function () {
            this._oViewModel.setProperty("/errorMessage", "");
        },

        onCloseSuccessMessage: function () {
            this._oViewModel.setProperty("/successMessage", "");
        },

        validateForm: function (oData) {
            if (!oData.MovementType) {
                return "Movement Type is required (201, 241, 311, 301, 261)";
            }
            if (!oData.Plant || !oData.Plant.trim()) {
                return "Plant is required";
            }
            if (!oData.StorageLocation || !oData.StorageLocation.trim()) {
                return "Issuing Storage Location is required";
            }
            if (!oData.Material || !oData.Material.trim()) {
                return "Material is required";
            }
            if (!oData.Quantity || Number(oData.Quantity) <= 0) {
                return "Quantity must be greater than 0";
            }
            if (oData.Unit !== undefined && oData.Unit !== null && !String(oData.Unit).trim()) {
                return "Unit of Measure is required";
            }

            switch (oData.MovementType) {
                case "201":
                    if (!oData.CostCenter || !oData.CostCenter.trim()) {
                        return "Cost Center is mandatory for Movement Type 201 (Goods Issue to Cost Center)";
                    }
                    break;
                case "241":
                    if (!oData.AssetNo || !oData.AssetNo.trim()) {
                        return "Asset Number is mandatory for Movement Type 241 (Goods Issue to Asset)";
                    }
                    if (!oData.SubNumber || !String(oData.SubNumber).trim()) {
                        return "Asset Sub-number is mandatory for Movement Type 241 (Goods Issue to Asset)";
                    }
                    break;
                case "311":
                    if (!oData.ReceivingStorageLocation || !oData.ReceivingStorageLocation.trim()) {
                        return "Receiving Storage Location is mandatory for Movement Type 311 (Storage Location Transfer)";
                    }
                    if (oData.ReceivingStorageLocation.trim() === oData.StorageLocation.trim()) {
                        return "Receiving Storage Location must be different from Issuing Storage Location";
                    }
                    break;
                case "301":
                    if (!oData.ReceivingPlant || !oData.ReceivingPlant.trim()) {
                        return "Receiving Plant is mandatory for Movement Type 301 (Plant to Plant Transfer)";
                    }
                    if (oData.ReceivingPlant.trim() === oData.Plant.trim()) {
                        return "Receiving Plant must be different from Issuing Plant";
                    }
                    if (!oData.ReceivingStorageLocation || !oData.ReceivingStorageLocation.trim()) {
                        return "Receiving Storage Location is mandatory for Movement Type 301 (Plant to Plant Transfer)";
                    }
                    break;
                case "261":
                    if (!oData.OrderType || !oData.OrderType.trim()) {
                        return "Order Type is mandatory for Movement Type 261 (Goods Issue to Order)";
                    }
                    if (!oData.OrderID || !oData.OrderID.trim()) {
                        return "Internal Order number is mandatory for Movement Type 261 (Goods Issue to Order)";
                    }
                    if (oData.CostCenter && oData.CostCenter.trim()) {
                        return "Cost Center must be empty for Movement Type 261";
                    }
                    if (oData.AssetNo && oData.AssetNo.trim()) {
                        return "Asset must be empty for Movement Type 261";
                    }
                    if (oData.ReceivingPlant && oData.ReceivingPlant.trim()) {
                        return "Receiving Plant must be empty for Movement Type 261";
                    }
                    if (oData.ReceivingStorageLocation && oData.ReceivingStorageLocation.trim()) {
                        return "Receiving Storage Location must be empty for Movement Type 261";
                    }
                    break;
                default:
                    return "Unsupported Movement Type: " + oData.MovementType;
            }

            return null;
        },

        onSave: function () {
            const that = this;
            if (this._oViewModel.getProperty("/busy")) return;
            const oData = this._oCreateModel.getData();
            const sValidationError = this.validateForm(oData);

            if (sValidationError) {
                this._oViewModel.setProperty("/errorMessage", sValidationError);
                return;
            }

            this._oViewModel.setProperty("/errorMessage", "");
            this._oViewModel.setProperty("/busy", true);

            const oPayload = {
                MovementType: oData.MovementType,
                Plant: oData.Plant.trim(),
                StorageLocation: oData.StorageLocation.trim(),
                WarehouseNumber: (oData.WarehouseNumber || "").trim(),
                Material: oData.Material.trim(),
                MaterialName: (oData.MaterialName || "").trim(),
                Quantity: Number(oData.Quantity),
                Unit: (oData.Unit || "").trim().toUpperCase(),
                ReceivingStorageLocation: (oData.ReceivingStorageLocation || "").trim(),
                ReceivingPlant: (oData.ReceivingPlant || "").trim(),
                CostCenter: (oData.CostCenter || "").trim(),
                AssetNo: (oData.AssetNo || "").trim(),
                SubNumber: (oData.SubNumber || "").trim(),
                OrderType: (oData.OrderType || "").trim(),
                OrderID: (oData.OrderID || "").trim(),
                Batch: (oData.Batch || "").trim(),
                ClientAttemptId: this._sClientAttemptId || this._newClientAttemptId()
            };

            return this._oService.createReservationEntry(oPayload).then(function (oResult) {
                that._oViewModel.setProperty("/busy", false);
                that._newClientAttemptId(); // the form's next submit is a new attempt

                const sResNo = oResult.ReservationNo;
                const sItem = oResult.ReservationItem || "0001";
                const oDesc = that.describeCreateResult(oResult);
                const fnOpen = function () {
                    that.getRouter().navTo("wmReservationEntryDetail", { ReservationNo: sResNo, ReservationItem: sItem });
                };
                // The dialog kind follows the backend stage: "success" only when the whole create step (reservation + TR) succeeded.
                (MessageBox[oDesc.kind] || MessageBox.information)(oDesc.text, { onClose: fnOpen });
            }).catch(function (err) {
                that._oViewModel.setProperty("/busy", false);
                const sError = err.message || "Failed to create reservation and auto TR";
                that._oViewModel.setProperty("/errorMessage", sError);
                const sResNo = that.reservationNumberFromError(sError);
                if (!sResNo) {
                    MessageBox.error(sError);
                    return;
                }
                // SAP holds a reservation for this request (created before a later failure, or an earlier attempt):
                // keep the number in front of the user and offer the page where it can be imported / retried.
                const sOpen = "Open reservation " + sResNo;
                const sClose = (MessageBox.Action && MessageBox.Action.CLOSE) || "Close";
                MessageBox.error(sError, {
                    actions: [sOpen, sClose],
                    emphasizedAction: sOpen,
                    onClose: function (sAction) {
                        if (sAction === sOpen) {
                            that.getRouter().navTo("wmReservationEntryDetail", { ReservationNo: sResNo, ReservationItem: "0001" });
                        }
                    }
                });
            });
        },

        /**
         * Maps the tracking row returned by createReservationEntry to a dialog kind and text.
         * Status 02 = reservation + TR created (the only "success" of the create step); 11 = reservation created
         * but TR failed (retryable, step LB01); 01 = reservation only; anything else (a replayed request can
         * return a row further along: 03/04/05 or 12/13/90) is described by its status, never as "created".
         */
        describeCreateResult: function (oResult) {
            const strip = function (v) { return String(v || "").replace(/^0+(?=\d)/, ""); };
            const sResNo = strip(oResult.ReservationNo);
            const sStatus = oResult.Status_code;
            const sTR = strip(oResult.TransferRequirement);
            const sErr = oResult.ErrorMessage || "";
            if (sStatus === "02") {
                return { kind: "success", text: "Reservation " + sResNo + " created in SAP. Transfer Requirement " + sTR + " created." };
            }
            if (sStatus === "11") {
                return { kind: "warning", text: "Reservation " + sResNo + " was created in SAP, but the Transfer Requirement was NOT created: " + sErr + " Use Retry on the reservation page (step LB01)." };
            }
            if (sStatus === "01") {
                return { kind: "information", text: "Reservation " + sResNo + " created in SAP. No Transfer Requirement yet" + (sErr ? ": " + sErr : ".") };
            }
            const sText = "Reservation " + sResNo + " is already at status '" + this.formatStatusText(sStatus) + "'" +
                (this.formatStatusRetryable(sStatus) ? " (retryable from the reservation page)" : "") + (sErr ? ": " + sErr : ".");
            return { kind: this.formatStatusRetryable(sStatus) ? "warning" : "information", text: sText };
        },

        /** Reservation number a backend error names (e.g. "Reservation 777077/0001 was created in SAP but ..."), else "". */
        reservationNumberFromError: function (sError) {
            const m = /[Rr]eservation (\d{1,10})(?:\/\d{1,4})?\b/.exec(String(sError || ""));
            return m ? m[1] : "";
        },

        onCancel: function () {
            this.onNavBack();
        },

        onNavToCreate: function () {
            const oRouter = this.getRouter();
            oRouter.navTo("wmReservationEntryCreate");
        },

        onNavBack: function () {
            if (BaseController && BaseController.prototype && typeof BaseController.prototype.onNavBack === "function") {
                BaseController.prototype.onNavBack.call(this, "wmReservationEntryList");
            } else if (BaseController && typeof BaseController.onNavBack === "function") {
                BaseController.onNavBack.call(this, "wmReservationEntryList");
            } else {
                const oRouter = this.getRouter();
                if (oRouter) {
                    oRouter.navTo("wmReservationEntryList");
                }
            }
        },

        formatStatusText: function (sCode) {
            switch (sCode) {
                case "01": return "Reservation Created";
                case "02": return "TR Auto-Created";
                case "03": return "TO Created";
                case "04": return "TO Confirmed";
                case "05": return "Goods Issue Posted";
                case "11": return "TR Creation Error";
                case "12": return "TO Creation Error";
                case "13": return "TO Confirmation Error";
                case "90": return "Goods Issue Error";
                case "99": return "Cancelled / Reversed";
                default: return sCode || "Pending";
            }
        },

        formatStatusState: function (sCode) {
            switch (sCode) {
                case "01": return "Information";
                case "02": return "Warning";
                case "03": return "Warning";
                case "04": return "Warning";
                case "05": return "Success";
                case "11": case "12": case "13": case "90": case "99": return "Error";
                default: return "None";
            }
        },

        formatStatusIcon: function (sCode) {
            switch (sCode) {
                case "01": return "sap-icon://create";
                case "02": return "sap-icon://shipping-status";
                case "03": return "sap-icon://cart";
                case "04": return "sap-icon://accept";
                case "05": return "sap-icon://sys-enter-2";
                case "11": case "12": case "13": case "90": return "sap-icon://error";
                case "99": return "sap-icon://cancel";
                default: return "";
            }
        },

        /** Error statuses the Retry action can resume from (TR, TO, TO confirmation, goods issue). */
        formatStatusRetryable: function (sCode) {
            return ["11", "12", "13", "90"].indexOf(sCode) >= 0;
        },

        formatMovementTypeDesc: function (sMvt) {
            switch (sMvt) {
                case "311": return "Storage Location Transfer (SLoc -> SLoc)";
                case "201": return "Goods Issue to Cost Center";
                case "241": return "Goods Issue to Asset";
                case "301": return "Plant to Plant Transfer";
                case "261": return "Goods Issue to Order";
                default: return sMvt || "";
            }
        }
    });
});
