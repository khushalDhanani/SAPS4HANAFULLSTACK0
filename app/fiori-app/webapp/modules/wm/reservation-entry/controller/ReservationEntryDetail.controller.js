sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "../service/ReservationEntryService"
], function (BaseController, JSONModel, MessageBox, MessageToast, ReservationEntryService) {
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

        _getDefaultCreateData: function () {
            return {
                MovementType: "311",
                Plant: "1120",
                StorageLocation: "CS01",
                WarehouseNumber: "W01",
                Material: "1000000045",
                MaterialName: "Raw Material 45",
                Quantity: 10,
                Unit: "KG",
                ReceivingStorageLocation: "ST02",
                ReceivingPlant: "",
                CostCenter: "",
                AssetNo: "",
                SubNumber: ""
            };
        },

        _onRouteCreateMatched: function () {
            this._oViewModel.setProperty("/isCreate", true);
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

            this._oService.getEntry(sResNo, sResItem).then(function (oData) {
                that._oDetailModel.setData(oData || {});
                that._oViewModel.setProperty("/busy", false);
            }).catch(function (err) {
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
            if (!this._sCurrentResNo) return;

            this._oViewModel.setProperty("/busy", true);
            this._oViewModel.setProperty("/errorMessage", "");

            this._oService.retryStep(this._sCurrentResNo, this._sCurrentResItem || "0001", "AUTO").then(function (oUpdated) {
                that._oViewModel.setProperty("/busy", false);
                const sStatus = oUpdated.Status_code;
                if (sStatus === "99") {
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
            this._oViewModel.setProperty("/errorMessage", "");

            // Adjust default values per movement type to help the user
            switch (sMvt) {
                case "201":
                    if (!this._oCreateModel.getProperty("/CostCenter")) {
                        this._oCreateModel.setProperty("/CostCenter", "1011201301");
                    }
                    this._oCreateModel.setProperty("/ReceivingStorageLocation", "");
                    this._oCreateModel.setProperty("/ReceivingPlant", "");
                    this._oCreateModel.setProperty("/AssetNo", "");
                    this._oCreateModel.setProperty("/SubNumber", "");
                    break;
                case "241":
                    if (!this._oCreateModel.getProperty("/AssetNo")) {
                        this._oCreateModel.setProperty("/AssetNo", "000000400092");
                        this._oCreateModel.setProperty("/SubNumber", "0000");
                    }
                    this._oCreateModel.setProperty("/ReceivingStorageLocation", "");
                    this._oCreateModel.setProperty("/ReceivingPlant", "");
                    this._oCreateModel.setProperty("/CostCenter", "");
                    break;
                case "311":
                    if (!this._oCreateModel.getProperty("/ReceivingStorageLocation") || this._oCreateModel.getProperty("/ReceivingStorageLocation") === this._oCreateModel.getProperty("/StorageLocation")) {
                        this._oCreateModel.setProperty("/ReceivingStorageLocation", "ST02");
                    }
                    this._oCreateModel.setProperty("/ReceivingPlant", "");
                    this._oCreateModel.setProperty("/CostCenter", "");
                    this._oCreateModel.setProperty("/AssetNo", "");
                    this._oCreateModel.setProperty("/SubNumber", "");
                    break;
                case "301":
                    if (!this._oCreateModel.getProperty("/ReceivingPlant")) {
                        this._oCreateModel.setProperty("/ReceivingPlant", "1130");
                    }
                    this._oCreateModel.setProperty("/ReceivingStorageLocation", "");
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

        onCloseErrorMessage: function () {
            this._oViewModel.setProperty("/errorMessage", "");
        },

        onCloseSuccessMessage: function () {
            this._oViewModel.setProperty("/successMessage", "");
        },

        validateForm: function (oData) {
            if (!oData.MovementType) {
                return "Movement Type is required (201, 241, 311, 301)";
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
                    break;
                default:
                    return "Unsupported Movement Type: " + oData.MovementType;
            }

            return null;
        },

        onSave: function () {
            const that = this;
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
                WarehouseNumber: (oData.WarehouseNumber || "W01").trim(),
                Material: oData.Material.trim(),
                MaterialName: (oData.MaterialName || "").trim(),
                Quantity: Number(oData.Quantity),
                Unit: (oData.Unit || "NOS").trim(),
                ReceivingStorageLocation: (oData.ReceivingStorageLocation || "").trim(),
                ReceivingPlant: (oData.ReceivingPlant || "").trim(),
                CostCenter: (oData.CostCenter || "").trim(),
                AssetNo: (oData.AssetNo || "").trim(),
                SubNumber: (oData.SubNumber || "").trim()
            };

            return this._oService.createReservationEntry(oPayload).then(function (oResult) {
                that._oViewModel.setProperty("/busy", false);

                const sResNo = oResult.ReservationNo;
                const sItem = oResult.ReservationItem || "0001";
                const sTR = oResult.TransferRequirement;

                let sMsg = "Reservation " + sResNo + " created successfully.";
                if (sTR) {
                    sMsg += " Auto-created Transfer Requirement (TR): " + sTR + ".";
                } else if (oResult.ErrorMessage) {
                    sMsg += " Note: " + oResult.ErrorMessage;
                }

                MessageBox.success(sMsg, {
                    onClose: function () {
                        const oRouter = that.getRouter();
                        oRouter.navTo("wmReservationEntryDetail", {
                            ReservationNo: sResNo,
                            ReservationItem: sItem
                        });
                    }
                });
            }).catch(function (err) {
                that._oViewModel.setProperty("/busy", false);
                const sError = err.message || "Failed to create reservation and auto TR";
                that._oViewModel.setProperty("/errorMessage", sError);
                MessageBox.error(sError);
            });
        },

        onCancel: function () {
            this.onNavBack();
        },

        onNavToCreate: function () {
            const oRouter = this.getRouter();
            oRouter.navTo("wmReservationEntryCreate");
        },

        onNavBack: function () {
            const oRouter = this.getRouter();
            oRouter.navTo("wmReservationEntryList");
        },

        formatStatusText: function (sCode) {
            switch (sCode) {
                case "01": return "Reservation Created";
                case "02": return "TR Auto-Created";
                case "03": return "TO Created";
                case "04": return "TO Confirmed";
                case "05": return "Goods Issue Posted";
                case "99": return "Error";
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
                case "99": return "Error";
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
                case "99": return "sap-icon://error";
                default: return "";
            }
        },

        formatMovementTypeDesc: function (sMvt) {
            switch (sMvt) {
                case "311": return "Storage Location Transfer (SLoc -> SLoc)";
                case "201": return "Goods Issue to Cost Center";
                case "241": return "Goods Issue to Asset";
                case "301": return "Plant to Plant Transfer";
                default: return sMvt || "";
            }
        }
    });
});
