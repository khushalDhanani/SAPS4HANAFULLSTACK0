sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/MessagePopover",
    "sap/m/MessageItem",
    "sap/ui/core/BusyIndicator",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "saps4hana/fiori/modules/sd/sales-order/model/SalesOrderModel",
    "saps4hana/fiori/service/ValueHelpService",
    "saps4hana/fiori/modules/sd/sales-order/service/SalesOrderService",
    "saps4hana/fiori/service/AuthService",
    "saps4hana/fiori/modules/sd/sales-order/controller/CreateSalesOrderHeaderSync",
    "saps4hana/fiori/modules/sd/sales-order/controller/CreateSalesOrderPartnerManager",
    "saps4hana/fiori/modules/sd/sales-order/controller/CreateSalesOrderItemManager",
    "saps4hana/fiori/modules/sd/sales-order/controller/CreateSalesOrderValueHelp",
    "saps4hana/fiori/modules/sd/sales-order/controller/CreateSalesOrderMessages"
], function (
    BaseController,
    JSONModel,
    MessageBox,
    MessageToast,
    MessagePopover,
    MessageItem,
    BusyIndicator,
    Filter,
    FilterOperator,
    SalesOrderModel,
    ValueHelpService,
    SalesOrderService,
    AuthService,
    _HeaderSync,
    _PartnerManager,
    _ItemManager,
    _ValueHelp,
    _Messages
) {
    "use strict";

    var isNode = typeof module !== "undefined" && module.exports;
    function req(mod, path) { return mod || (isNode ? require(path) : {}); }
    var HeaderSync = req(_HeaderSync, "./CreateSalesOrderHeaderSync");
    var PartnerManager = req(_PartnerManager, "./CreateSalesOrderPartnerManager");
    var ItemManager = req(_ItemManager, "./CreateSalesOrderItemManager");
    var ValueHelp = req(_ValueHelp, "./CreateSalesOrderValueHelp");
    var Messages = req(_Messages, "./CreateSalesOrderMessages");

    var mHeaderSync = HeaderSync.createCreateSalesOrderHeaderSync ? HeaderSync.createCreateSalesOrderHeaderSync({
        SalesOrderModel: SalesOrderModel
    }) : {};

    var mPartnerManager = PartnerManager.createCreateSalesOrderPartnerManager ? PartnerManager.createCreateSalesOrderPartnerManager({
        SalesOrderModel: SalesOrderModel,
        SalesOrderService: SalesOrderService,
        MessageBox: MessageBox,
        MessageToast: MessageToast,
        Filter: Filter,
        FilterOperator: FilterOperator
    }) : {};

    var mItemManager = ItemManager.createCreateSalesOrderItemManager ? ItemManager.createCreateSalesOrderItemManager({
        SalesOrderModel: SalesOrderModel,
        SalesOrderService: SalesOrderService,
        MessageToast: MessageToast
    }) : {};

    var mValueHelp = ValueHelp.createCreateSalesOrderValueHelp ? ValueHelp.createCreateSalesOrderValueHelp({
        SalesOrderModel: SalesOrderModel,
        SalesOrderService: SalesOrderService,
        ValueHelpService: ValueHelpService,
        Filter: Filter,
        FilterOperator: FilterOperator
    }) : {};

    var mMessages = Messages.createCreateSalesOrderMessages ? Messages.createCreateSalesOrderMessages({
        JSONModel: JSONModel,
        MessagePopover: MessagePopover,
        MessageItem: MessageItem,
        MessageToast: MessageToast,
        SalesOrderModel: SalesOrderModel
    }) : {};

    var oMembers = {
        onInit: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }
            this._resetModel(false);
            var oRouter = this.getOwnerComponent().getRouter();
            if (oRouter && oRouter.getRoute("createSalesOrder")) {
                oRouter.getRoute("createSalesOrder").attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _resetModel: function (bLoadConfig) {
            var sUser = SalesOrderModel.getCurrentUserName(this.getOwnerComponent());
            var oModel = SalesOrderModel.createInitialModel(sUser);
            this.getView().setModel(oModel, "newOrder");
            SalesOrderModel.updateStatus(oModel);

            if (this._oMessagePopover) {
                this._oMessagePopover.close();
            }

            if (bLoadConfig) {
                this._loadConfigurationAndDefaults();
            }
        },

        _loadConfigurationAndDefaults: function (bForce) {
            var that = this;

            var pDefaults = SalesOrderService.getSalesOrderDefaults().then(function (oDefaults) {
                var oCurrentModel = that.getView().getModel("newOrder");
                if (oCurrentModel && oDefaults) {
                    SalesOrderModel.applyServerDefaults(oCurrentModel, oDefaults);
                    SalesOrderModel.updateStatus(oCurrentModel);
                }
            }).catch(function (err) {
                console.warn("[CreateSalesOrder] Error loading server defaults:", err);
                MessageToast.show((typeof that.getText === "function" && that.getText("msgOrderDefaultsUnavailable")) || "Order defaults could not be loaded from SAP. Enter the organisational data manually.");
            });

            if (this._oConfigData && !bForce) {
                if (typeof this._updateOrganizationalFilters === "function") {
                    this._updateOrganizationalFilters();
                }
            }

            var oSalesOrderModel = (this.getModel && this.getModel("salesOrder")) || null;
            var oConfigPromise = oSalesOrderModel ?
                SalesOrderService.loadConfiguration(oSalesOrderModel) :
                SalesOrderService.loadConfiguration();

            return Promise.all([pDefaults, oConfigPromise.then(function (oConfigData) {
                that._oConfigData = oConfigData;
                var oCurrentModel = that.getView().getModel("newOrder");
                if (oCurrentModel) {
                    if (typeof that._updateOrganizationalFilters === "function") {
                        that._updateOrganizationalFilters();
                    }
                    if (oConfigData && oConfigData.defaults && oConfigData.defaults.Plant) {
                        var sDefPlant = oConfigData.defaults.Plant;
                        var aItems = oCurrentModel.getProperty("/items") || [];
                        aItems.forEach(function (itm) {
                            if (!itm.Plant) {
                                itm.Plant = sDefPlant;
                            }
                        });
                        oCurrentModel.setProperty("/items", aItems);
                    }
                }
                return oConfigData;
            }).catch(function (err) {
                console.warn("[CreateSalesOrder] Error loading config data:", err);
                return that._oConfigData || null;
            })]);
        },

        _onRouteMatched: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }
            this._resetModel(true);
        },

        onSave: function () {
            var that = this;
            var oModel = this.getView().getModel("newOrder");
            if (oModel.getProperty("/submitBlocked")) return;
            var bValid = SalesOrderModel.validateForm(oModel);

            var aItems = oModel.getProperty("/items") || [];
            var bItemsPlantValid = true;
            aItems.forEach(function (itm) {
                if (!itm.Plant || String(itm.Plant).trim() === "") {
                    itm.errors = itm.errors || {};
                    itm.errors.Plant = { state: "Error", text: "Plant is required for each line item" };
                    bItemsPlantValid = false;
                }
            });
            if (!bItemsPlantValid) {
                oModel.setProperty("/items", aItems);
                bValid = false;
            }

            if (!bValid) {
                if (typeof this.onMessageButtonPress === "function") {
                    this.onMessageButtonPress();
                }
                return;
            }

            BusyIndicator.show(0);
            var oPayload = SalesOrderModel.buildPayload(oModel);

            SalesOrderService.createSalesOrder(oPayload).then(function (sOrderId) {
                BusyIndicator.hide();
                var sSuccessMsg = (typeof that.getText === "function" && that.getText("msgOrderCreatedInApproval", [sOrderId])) ||
                    ("Sales Order " + sOrderId + " has been successfully created in SAP S/4HANA (Approval Status: In Approval via SAP Flexible Workflow WS02000006). An authorized approver must release the order before an outbound delivery can be created.");
                MessageBox.success(sSuccessMsg, {
                    title: "Sales Order Created",
                    actions: ["Create Another", "Worklist", "Close"],
                    emphasizedAction: "Worklist",
                    onClose: function (sAction) {
                        if (sAction === "Create Another") {
                            that._resetModel(true);
                        } else {
                            that.getOwnerComponent().getRouter().navTo("salesOrders");
                        }
                    }
                });
            }).catch(function (error) {
                BusyIndicator.hide();
                var sRaw = (error && error.message) ? error.message : "An unexpected error occurred.";
                var PREFIX = "Failed to create Sales Order: ";
                var sErrMsg = sRaw.startsWith(PREFIX) ? sRaw.slice(PREFIX.length) : sRaw;

                var aCreated = (error && error.code === "SALES_ORDER_CREATED_VERIFICATION_FAILED") ? sErrMsg.match(/Sales Order (\d+)/) : null;
                if (aCreated) {
                    var sCreatedMsg = (typeof that.getText === "function" && that.getText("msgOrderCreatedVerificationFailed", [aCreated[1], sErrMsg])) ||
                        ("Sales Order " + aCreated[1] + " was created in SAP S/4HANA, but the read-back check failed: " + sErrMsg +
                            " Do not create it again; check the order in SAP (VA03).");
                    MessageBox.warning(sCreatedMsg, {
                        title: "Sales Order Created with Warnings",
                        actions: ["Worklist", "Close"],
                        emphasizedAction: "Worklist",
                        onClose: function (sAction) {
                            that._resetModel(true);
                            if (sAction === "Worklist") {
                                that.getOwnerComponent().getRouter().navTo("salesOrders");
                            }
                        }
                    });
                    return;
                }

                oModel.setProperty("/errorMessage", sErrMsg);
                oModel.setProperty("/hasError", true);

                if (sErrMsg.indexOf("not maintained for sales area") !== -1 || sErrMsg.indexOf("Sold-to party") !== -1) {
                    oModel.setProperty("/errors/SoldToParty", { state: "Error", text: sErrMsg });
                    sErrMsg += "\n\nPlease select a customer maintained for this sales area or extend the customer in SAP GUI (transaction BP / XD01).";
                } else if (sErrMsg.indexOf("is not listed") !== -1 || sErrMsg.indexOf("not allowed") !== -1) {
                    sErrMsg += "\n\nThis is a SAP Material Listing restriction (condition type A001).\n" +
                        "To resolve:\n" +
                        "\u2022 Ask your SAP SD consultant to add this material to the customer's listing (transaction VB01 / VB02).\n" +
                        "\u2022 Or select a material already listed for this sold-to party.";
                }

                MessageBox.error(that.blockSubmitIfNotConfirmed(oModel, sErrMsg) || (PREFIX + sErrMsg));
                SalesOrderModel.updateStatus(oModel);
            });
        },

        onCancel: function () {
            var that = this;
            MessageBox.confirm("Are you sure you want to discard your changes?", {
                title: "Discard Sales Order",
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        that._resetModel();
                        that.onNavBack("salesOrders");
                    }
                }
            });
        }
    };

    Object.assign(oMembers, mHeaderSync, mPartnerManager, mItemManager, mValueHelp, mMessages);

    var CreateSalesOrderController = BaseController.extend("saps4hana.fiori.modules.sd.sales-order.controller.CreateSalesOrder", oMembers);

    var oTargetProto = CreateSalesOrderController.prototype || CreateSalesOrderController;
    Object.assign(oTargetProto, mHeaderSync, mPartnerManager, mItemManager, mValueHelp, mMessages);

    return CreateSalesOrderController;
});
