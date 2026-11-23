sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/MessagePopover",
    "sap/m/MessageItem",
    "sap/ui/core/BusyIndicator",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "saps4hana/fiori/modules/mm/purchase-order/model/PurchaseOrderModel",
    "saps4hana/fiori/service/ValueHelpService",
    "saps4hana/fiori/modules/mm/purchase-order/service/PurchaseOrderService",
    "saps4hana/fiori/modules/mm/purchase-order/controller/CreatePurchaseOrderContextFilter",
    "saps4hana/fiori/modules/mm/purchase-order/controller/CreatePurchaseOrderValueHelp",
    "saps4hana/fiori/modules/mm/purchase-order/controller/CreatePurchaseOrderMessages",
    "saps4hana/fiori/modules/mm/purchase-order/controller/CreatePurchaseOrderItemManager",
    "saps4hana/fiori/modules/mm/purchase-order/controller/CreatePurchaseOrderHeaderSync"
], function (
    BaseController,
    MessageBox,
    MessageToast,
    MessagePopover,
    MessageItem,
    BusyIndicator,
    Filter,
    FilterOperator,
    PurchaseOrderModel,
    ValueHelpService,
    PurchaseOrderService,
    _CreatePurchaseOrderContextFilter,
    _CreatePurchaseOrderValueHelp,
    _CreatePurchaseOrderMessages,
    _CreatePurchaseOrderItemManager,
    _CreatePurchaseOrderHeaderSync
) {
    "use strict";

    var isNode = typeof module !== "undefined" && module.exports;
    function req(mod, path) { return mod || (isNode ? require(path) : {}); }
    var CreatePurchaseOrderContextFilter = req(_CreatePurchaseOrderContextFilter, "./CreatePurchaseOrderContextFilter");
    var CreatePurchaseOrderValueHelp = req(_CreatePurchaseOrderValueHelp, "./CreatePurchaseOrderValueHelp");
    var CreatePurchaseOrderMessages = req(_CreatePurchaseOrderMessages, "./CreatePurchaseOrderMessages");
    var CreatePurchaseOrderItemManager = req(_CreatePurchaseOrderItemManager, "./CreatePurchaseOrderItemManager");
    var CreatePurchaseOrderHeaderSync = req(_CreatePurchaseOrderHeaderSync, "./CreatePurchaseOrderHeaderSync");

    var PurchaseOrderRules = (PurchaseOrderModel && PurchaseOrderModel.rules) || null;
    if (!PurchaseOrderRules && typeof require === "function") {
        try {
            PurchaseOrderRules = require("../model/PurchaseOrderRules");
        } catch (e) {}
    }

    var CreatePurchaseOrderController = BaseController.extend("saps4hana.fiori.modules.mm.purchase-order.controller.CreatePurchaseOrder", {
        onInit: function () {
            PurchaseOrderModel.setTextResolver(this.getText.bind(this));
            this._resetModel(false);
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("createPurchaseOrder").attachPatternMatched(this._onRouteMatched, this);
        },

        _resetModel: function (bLoadConfig) {
            var oOwnerComponent = typeof this.getOwnerComponent === "function" ? this.getOwnerComponent() : null;
            var sUser = PurchaseOrderModel.getCurrentUserName(oOwnerComponent);
            var oModel = PurchaseOrderModel.createInitialModel(sUser);
            this.getView().setModel(oModel, "newPO");
            PurchaseOrderModel.updateStatus(oModel);
            if (this._oMessagePopover) {
                this._oMessagePopover.close();
            }
            if (bLoadConfig) {
                this._loadConfigurationAndDefaults();
            }
        },

        _loadConfigurationAndDefaults: function (bForce) {
            var that = this;
            var oModel = this.getView().getModel("newPO");

            if (this._oConfigData && !bForce) {
                PurchaseOrderModel.applyConfigurationDefaults(oModel, this._oConfigData);
                PurchaseOrderModel.updateStatus(oModel);
            }

            var oPoModel = this.getModel();
            return PurchaseOrderService.loadConfiguration(oPoModel).then(function (oConfigData) {
                that._oConfigData = oConfigData;
                var oCurrentModel = that.getView().getModel("newPO");
                if (oCurrentModel) {
                    PurchaseOrderModel.applyConfigurationDefaults(oCurrentModel, oConfigData);
                    PurchaseOrderModel.updateStatus(oCurrentModel);
                    that._refreshSupplierBinding();
                    that._refreshCompanyCodeBinding();
                    that._refreshPurchOrgBinding();
                    that._refreshPurchGrpBinding();
                }
                return oConfigData;
            }).catch(function (err) {
                console.warn("[CreatePurchaseOrder] Error loading config data:", err);
                return that._oConfigData || null;
            });
        },

        _onRouteMatched: function () {
            this._resetModel(true);
        },

        onNavBack: function () {
            BaseController.prototype.onNavBack.call(this, "purchaseOrders");
        },

        onCancelPress: function () {
            this.onNavBack();
        },

        onCreatePress: function () {
            var oModel = this.getView().getModel("newPO");
            if (oModel.getProperty("/submitBlocked")) return;
            var oData = oModel.getData();
            var that = this;

            var oValidationResult = PurchaseOrderModel.validateForm(oModel);
            if (!oValidationResult.isValid) {
                that._openMessagePopover();
                if (oValidationResult.errorList && oValidationResult.errorList.length > 0) {
                    that._navigateToErrorTarget(oValidationResult.errorList[0]);
                }
                return;
            }

            BusyIndicator.show(0);

            var oCleanHeader = Object.assign({}, oData.header);
            delete oCleanHeader.PurchaseOrderTypeText;
            delete oCleanHeader.StatusText;
            delete oCleanHeader.StatusState;
            delete oCleanHeader.StatusIcon;
            delete oCleanHeader.PurchasingCompletenessStatus;

            var aCleanItems = (oData.items || []).map(function(item) {
                var oCleanItem = Object.assign({}, item);
                delete oCleanItem.errors;
                delete oCleanItem.NetAmountIsEstimate;
                return oCleanItem;
            });

            PurchaseOrderService.createPurchaseOrder({
                header: oCleanHeader,
                items: aCleanItems
            })
                .then(function (sNewPO) {
                    BusyIndicator.hide();
                    MessageToast.show(that.getText("poMsgCreatedSuccess", [sNewPO], "Purchase Order Created: " + sNewPO));
                    that.onNavBack();
                })
                .catch(function (oError) {
                    BusyIndicator.hide();
                    var sNotConfirmed = that.blockSubmitIfNotConfirmed(oModel, oError && oError.message);
                    if (sNotConfirmed) {
                        MessageBox.error(sNotConfirmed);
                        return;
                    }
                    var oErrResult = PurchaseOrderModel.applyBackendErrors(oModel, oError);
                    that._openMessagePopover();
                    if (oErrResult.errorList && oErrResult.errorList.length > 0) {
                        that._navigateToErrorTarget(oErrResult.errorList[0]);
                    }

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
            PurchaseOrderModel.setTextResolver(null);
            this._oConfigData = null;
            if (this._oMessagePopover) {
                this._oMessagePopover.destroy();
                this._oMessagePopover = null;
            }
        }
    });

    var mContextFilter = CreatePurchaseOrderContextFilter.createCreatePurchaseOrderContextFilter ? CreatePurchaseOrderContextFilter.createCreatePurchaseOrderContextFilter({
        Filter: Filter,
        FilterOperator: FilterOperator,
        PurchaseOrderRules: PurchaseOrderRules,
        PurchaseOrderModel: PurchaseOrderModel
    }) : {};

    var mValueHelp = CreatePurchaseOrderValueHelp.createCreatePurchaseOrderValueHelp ? CreatePurchaseOrderValueHelp.createCreatePurchaseOrderValueHelp({
        PurchaseOrderModel: PurchaseOrderModel,
        PurchaseOrderService: PurchaseOrderService,
        ValueHelpService: ValueHelpService
    }) : {};

    var mMessages = CreatePurchaseOrderMessages.createCreatePurchaseOrderMessages ? CreatePurchaseOrderMessages.createCreatePurchaseOrderMessages({
        MessagePopover: MessagePopover,
        MessageItem: MessageItem
    }) : {};

    var mItems = CreatePurchaseOrderItemManager.createCreatePurchaseOrderItemManager ? CreatePurchaseOrderItemManager.createCreatePurchaseOrderItemManager({
        PurchaseOrderModel: PurchaseOrderModel,
        PurchaseOrderService: PurchaseOrderService
    }) : {};

    var mHeaderSync = CreatePurchaseOrderHeaderSync.createCreatePurchaseOrderHeaderSync ? CreatePurchaseOrderHeaderSync.createCreatePurchaseOrderHeaderSync({
        PurchaseOrderModel: PurchaseOrderModel,
        PurchaseOrderService: PurchaseOrderService,
        PurchaseOrderRules: PurchaseOrderRules,
        MessageToast: MessageToast
    }) : {};

    var oTarget = CreatePurchaseOrderController.prototype || CreatePurchaseOrderController;
    Object.assign(oTarget, mContextFilter, mValueHelp, mMessages, mItems, mHeaderSync);

    return CreatePurchaseOrderController;
});
