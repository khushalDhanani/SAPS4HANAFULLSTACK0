sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/MessagePopover",
    "sap/m/MessageItem",
    "sap/ui/core/BusyIndicator",
    "saps4hana/fiori/modules/mm/purchase-order/model/PurchaseOrderModel",
    "saps4hana/fiori/service/ValueHelpService",
    "saps4hana/fiori/modules/mm/purchase-order/service/PurchaseOrderService"
], function (BaseController, MessageBox, MessageToast, MessagePopover, MessageItem, BusyIndicator, PurchaseOrderModel, ValueHelpService, PurchaseOrderService) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.mm.purchase-order.controller.CreatePurchaseOrder", {
        onInit: function () {
            this._resetModel();
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("createPurchaseOrder").attachPatternMatched(this._onRouteMatched, this);
        },

        _resetModel: function () {
            var sUser = PurchaseOrderModel.getCurrentUserName(this.getOwnerComponent());
            var oModel = PurchaseOrderModel.createInitialModel(sUser);
            this.getView().setModel(oModel, "newPO");
            PurchaseOrderModel.updateStatus(oModel);
            if (this._oMessagePopover) {
                this._oMessagePopover.close();
            }
        },

        _onRouteMatched: function () {
            this._resetModel();
        },

        onHeaderChange: function () {
            var oModel = this.getView().getModel("newPO");
            PurchaseOrderModel.updateStatus(oModel);
            if (oModel.getProperty("/hasError")) {
                PurchaseOrderModel.validateForm(oModel);
            }
        },

        onItemFieldChange: function () {
            var oModel = this.getView().getModel("newPO");
            PurchaseOrderModel.updateStatus(oModel);
            if (oModel.getProperty("/hasError")) {
                PurchaseOrderModel.validateForm(oModel);
            }
        },

        onDismissError: function () {
            var oModel = this.getView().getModel("newPO");
            if (oModel) {
                oModel.setProperty("/hasError", false);
                oModel.setProperty("/errorMessage", "");
            }
        },

        _initMessagePopover: function () {
            var that = this;
            var oMessageTemplate = new MessageItem({
                type: "{newPO>type}",
                title: "{newPO>title}",
                subtitle: "{newPO>field}",
                description: "{newPO>description}",
                activeTitle: true
            });

            this._oMessagePopover = new MessagePopover({
                items: {
                    path: "newPO>/errorList",
                    template: oMessageTemplate
                },
                itemSelect: function (oEvent) {
                    var oItem = oEvent.getParameter("item");
                    if (oItem) {
                        var oContext = oItem.getBindingContext("newPO");
                        if (oContext) {
                            that._navigateToErrorTarget(oContext.getObject());
                        }
                    }
                }
            });
            this.getView().addDependent(this._oMessagePopover);
        },

        _openMessagePopover: function () {
            var oBtn = this.byId("btnMessages");
            if (!oBtn) return;
            if (!this._oMessagePopover) {
                this._initMessagePopover();
            }
            var that = this;
            setTimeout(function () {
                if (!that._oMessagePopover.isOpen() && oBtn.getDomRef()) {
                    that._oMessagePopover.openBy(oBtn);
                }
            }, 100);
        },

        _navigateToErrorTarget: function (oError) {
            if (!oError) return;

            var that = this;
            setTimeout(function () {
                // 1. Header input targeting by control ID
                if (typeof oError.controlId === "string" && oError.controlId !== "poItemsTable") {
                    var oControl = that.byId(oError.controlId);
                    if (oControl) {
                        if (typeof oControl.focus === "function") {
                            oControl.focus();
                        }
                        var oDomRef = oControl.getDomRef();
                        if (oDomRef && typeof oDomRef.scrollIntoView === "function") {
                            oDomRef.scrollIntoView({ behavior: "smooth", block: "center" });
                        }
                        return;
                    }
                }

                // 2. Line Item Table cell targeting
                var oTable = that.byId("poItemsTable");
                if (oTable) {
                    var iItemIndex = oError.itemIndex !== undefined ? oError.itemIndex : 0;
                    var aTableItems = oTable.getItems();
                    if (aTableItems && aTableItems[iItemIndex]) {
                        var oRow = aTableItems[iItemIndex];
                        var aCells = oRow.getCells();
                        var iCellIndex = oError.cellIndex !== undefined ? oError.cellIndex : 1;
                        var oTargetCell = aCells[iCellIndex] || oRow;
                        if (typeof oTargetCell.focus === "function") {
                            oTargetCell.focus();
                        }
                        var oCellDom = oTargetCell.getDomRef();
                        if (oCellDom && typeof oCellDom.scrollIntoView === "function") {
                            oCellDom.scrollIntoView({ behavior: "smooth", block: "center" });
                        }
                    }
                }
            }, 100);
        },

        onMessageButtonPress: function (oEvent) {
            var oSource = oEvent ? oEvent.getSource() : this.byId("btnMessages");
            if (!this._oMessagePopover) {
                this._initMessagePopover();
            }
            this._oMessagePopover.toggle(oSource);
        },

        onValueHelpRequest: function (oEvent) {
            ValueHelpService.openValueHelp(this.getView(), oEvent.getSource());
        },

        onSuggest: function (oEvent) {
            var sValue = oEvent.getParameter("suggestValue");
            ValueHelpService.applySuggestionFilter(oEvent.getSource(), sValue);
        },

        onNavBack: function () {
            BaseController.prototype.onNavBack.call(this, "purchaseOrders");
        },

        onCancelPress: function () {
            this.onNavBack();
        },

        onAddItem: function () {
            var oModel = this.getView().getModel("newPO");
            var sUser = PurchaseOrderModel.getCurrentUserName(this.getOwnerComponent());
            PurchaseOrderModel.addItem(oModel, sUser);
            PurchaseOrderModel.updateStatus(oModel);
            if (oModel.getProperty("/hasError")) {
                PurchaseOrderModel.validateForm(oModel);
            }
        },

        onDeleteItem: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            var sPath = oItem.getBindingContext("newPO").getPath();
            var iIndex = parseInt(sPath.split("/")[2], 10);
            var oModel = this.getView().getModel("newPO");
            PurchaseOrderModel.deleteItem(oModel, iIndex);
            PurchaseOrderModel.updateStatus(oModel);
            if (oModel.getProperty("/hasError")) {
                PurchaseOrderModel.validateForm(oModel);
            }
        },

        onCalculateNetAmount: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("newPO");
            if (!oContext) return;

            var sPath = oContext.getPath();
            var oModel = this.getView().getModel("newPO");

            PurchaseOrderModel.calculateItemNetAmount(oModel, sPath);
            PurchaseOrderModel.updateStatus(oModel);
            if (oModel.getProperty("/hasError")) {
                PurchaseOrderModel.validateForm(oModel);
            }
        },

        _getErrorMessageConfig: function (oError) {
            var iStatus = (oError && oError.status) || 500;
            var sMessage = (oError && oError.message) || "An unexpected error occurred.";

            if (oError && oError.responseText) {
                try {
                    var oParsed = JSON.parse(oError.responseText);
                    if (oParsed.error && oParsed.error.message) {
                        sMessage = typeof oParsed.error.message === "object" ? (oParsed.error.message.value || sMessage) : oParsed.error.message;
                    }
                } catch (e) {
                    // responseText is not JSON
                }
            } else if (oError && oError.error && oError.error.message) {
                sMessage = typeof oError.error.message === "object" ? (oError.error.message.value || sMessage) : oError.error.message;
            }

            switch (iStatus) {
                case 400:
                    return {
                        title: "Invalid Input",
                        message: sMessage
                    };
                case 401:
                    return {
                        title: "Authentication Failed",
                        message: "Your session is unauthenticated or has expired. Please log in again."
                    };
                case 403:
                    return {
                        title: "Authorization Denied",
                        message: sMessage || "You do not have permission to create Purchase Orders in this Purchasing Organization or Group."
                    };
                case 404:
                    return {
                        title: "Resource Not Found",
                        message: sMessage || "One or more referenced master data records (Supplier, Material, Plant) were not found in SAP."
                    };
                case 409:
                    return {
                        title: "Document Locked / Conflict",
                        message: sMessage || "The purchasing record or supplier is currently locked in SAP S/4HANA by another process. Please retry shortly."
                    };
                case 422:
                    return {
                        title: "Business Validation Error",
                        message: sMessage
                    };
                case 502:
                case 503:
                    return {
                        title: "S/4HANA Backend Unavailable",
                        message: "The SAP S/4HANA backend system is currently unreachable. Please check connectivity or destination configuration."
                    };
                case 500:
                default:
                    return {
                        title: "Application Error",
                        message: sMessage
                    };
            }
        },

        onCreatePress: function () {
            var oModel = this.getView().getModel("newPO");
            var oData = oModel.getData();
            var that = this;

            // 1. Immediate Fiori Client-Side Validation UX
            var oValidationResult = PurchaseOrderModel.validateForm(oModel);
            if (!oValidationResult.isValid) {
                // Open MessagePopover attached to footer alert button
                that._openMessagePopover();

                // Focus first invalid field
                if (oValidationResult.errorList && oValidationResult.errorList.length > 0) {
                    that._navigateToErrorTarget(oValidationResult.errorList[0]);
                }
                return;
            }

            // 2. Submit to Backend
            BusyIndicator.show(0);

            // Clean UI-only fields from payload before submitting to backend
            var oCleanHeader = Object.assign({}, oData.header);
            delete oCleanHeader.StatusText;
            delete oCleanHeader.StatusState;
            delete oCleanHeader.StatusIcon;
            delete oCleanHeader.PurchasingCompletenessStatus;

            var aCleanItems = (oData.items || []).map(function(item) {
                var oCleanItem = Object.assign({}, item);
                delete oCleanItem.errors;
                return oCleanItem;
            });

            PurchaseOrderService.createPurchaseOrder({
                header: oCleanHeader,
                items: aCleanItems
            })
                .then(function (sNewPO) {
                    BusyIndicator.hide();
                    MessageToast.show("Purchase Order Created: " + sNewPO);
                    that.onNavBack();
                })
                .catch(function (oError) {
                    BusyIndicator.hide();
                    var oErrResult = PurchaseOrderModel.applyBackendErrors(oModel, oError);

                    // Open MessagePopover with all backend error details
                    that._openMessagePopover();

                    // Auto-focus first affected field
                    if (oErrResult.errorList && oErrResult.errorList.length > 0) {
                        that._navigateToErrorTarget(oErrResult.errorList[0]);
                    }

                    // For critical infrastructure / network error (502, 503, 401), also show diagnostic dialog
                    var iStatus = (oError && oError.status) || 500;
                    if (iStatus === 502 || iStatus === 503 || iStatus === 401) {
                        var oErrConfig = that._getErrorMessageConfig(oError);
                        MessageBox.error(oErrConfig.message, {
                            title: oErrConfig.title,
                            details: (oError && (oError.rawResponse || oError.message)) || ""
                        });
                    }
                });
        },

        onExit: function () {
            if (this._oMessagePopover) {
                this._oMessagePopover.destroy();
                this._oMessagePopover = null;
            }
        }
    });
});
