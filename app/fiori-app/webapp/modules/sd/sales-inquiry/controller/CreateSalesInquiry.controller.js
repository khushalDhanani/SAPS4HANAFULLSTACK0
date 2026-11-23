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
    "saps4hana/fiori/modules/sd/sales-inquiry/model/SalesInquiryModel",
    "saps4hana/fiori/service/ValueHelpService",
    "saps4hana/fiori/modules/sd/sales-inquiry/service/SalesInquiryService",
    "saps4hana/fiori/modules/sd/sales-inquiry/controller/CreateSalesInquiryHeaderSync",
    "saps4hana/fiori/modules/sd/sales-inquiry/controller/CreateSalesInquiryCustomerManager",
    "saps4hana/fiori/modules/sd/sales-inquiry/controller/CreateSalesInquiryItemManager",
    "saps4hana/fiori/modules/sd/sales-inquiry/controller/CreateSalesInquiryValueHelp",
    "saps4hana/fiori/modules/sd/sales-inquiry/controller/CreateSalesInquiryMessages"
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
    SalesInquiryModel,
    ValueHelpService,
    SalesInquiryService,
    _HeaderSync,
    _CustomerManager,
    _ItemManager,
    _ValueHelp,
    _Messages
) {
    "use strict";

    var isNode = typeof module !== "undefined" && module.exports;
    function req(mod, path) { return mod || (isNode ? require(path) : {}); }
    var HeaderSync = req(_HeaderSync, "./CreateSalesInquiryHeaderSync");
    var CustomerManager = req(_CustomerManager, "./CreateSalesInquiryCustomerManager");
    var ItemManager = req(_ItemManager, "./CreateSalesInquiryItemManager");
    var ValueHelp = req(_ValueHelp, "./CreateSalesInquiryValueHelp");
    var Messages = req(_Messages, "./CreateSalesInquiryMessages");

    var mHeaderSync = HeaderSync.createCreateSalesInquiryHeaderSync ? HeaderSync.createCreateSalesInquiryHeaderSync({
        SalesInquiryModel: SalesInquiryModel,
        Filter: Filter,
        FilterOperator: FilterOperator
    }) : {};

    var mCustomerManager = CustomerManager.createCreateSalesInquiryCustomerManager ? CustomerManager.createCreateSalesInquiryCustomerManager({
        SalesInquiryModel: SalesInquiryModel,
        SalesInquiryService: SalesInquiryService,
        MessageBox: MessageBox,
        MessageToast: MessageToast
    }) : {};

    var mItemManager = ItemManager.createCreateSalesInquiryItemManager ? ItemManager.createCreateSalesInquiryItemManager({
        SalesInquiryModel: SalesInquiryModel,
        SalesInquiryService: SalesInquiryService
    }) : {};

    var mValueHelp = ValueHelp.createCreateSalesInquiryValueHelp ? ValueHelp.createCreateSalesInquiryValueHelp({
        SalesInquiryModel: SalesInquiryModel,
        SalesInquiryService: SalesInquiryService,
        ValueHelpService: ValueHelpService,
        Filter: Filter,
        FilterOperator: FilterOperator
    }) : {};

    var mMessages = Messages.createCreateSalesInquiryMessages ? Messages.createCreateSalesInquiryMessages({
        JSONModel: JSONModel,
        MessagePopover: MessagePopover,
        MessageItem: MessageItem,
        MessageToast: MessageToast,
        SalesInquiryModel: SalesInquiryModel
    }) : {};

    var oMembers = {
        onInit: function () {
            this._resetModel(false);
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("createSalesInquiry").attachPatternMatched(this._onRouteMatched, this);
        },

        _resetModel: function (bLoadConfig) {
            var sUser = SalesInquiryModel.getCurrentUserName(this.getOwnerComponent());
            var oModel = SalesInquiryModel.createInitialModel(sUser);
            this.getView().setModel(oModel, "newInquiry");
            SalesInquiryModel.updateStatus(oModel);
            if (this._oCapabilities) {
                SalesInquiryModel.applyCapabilities(oModel, this._oCapabilities);
            }

            if (this._oMessagePopover) {
                this._oMessagePopover.close();
            }

            if (bLoadConfig) {
                this._loadConfigurationAndDefaults();
                this._loadCapabilities();
            }
        },

        /**
         * Asks the backend which incompletion extension fields the SAP inquiry service accepts, so the
         * form can require those and warn about the rest (to be maintained directly in SAP).
         */
        _loadCapabilities: function () {
            var that = this;
            if (this._oCapabilities) {
                return Promise.resolve(this._oCapabilities);
            }
            return SalesInquiryService.getInquiryCreationCapabilities().then(function (oCaps) {
                that._oCapabilities = oCaps || {};
                var oModel = that.getView().getModel("newInquiry");
                if (oModel) {
                    SalesInquiryModel.applyCapabilities(oModel, that._oCapabilities);
                }
                return that._oCapabilities;
            }).catch(function (err) {
                console.warn("[CreateSalesInquiry] Error loading creation capabilities:", err);
                return that._oCapabilities || null;
            });
        },

        _loadConfigurationAndDefaults: function (bForce) {
            var that = this;
            var oModel = this.getView().getModel("newInquiry");

            if (this._oConfigData && !bForce) {
                SalesInquiryModel.applyConfigurationDefaults(oModel, this._oConfigData);
                if (typeof this._updateOrganizationalFilters === "function") {
                    this._updateOrganizationalFilters();
                }
            }

            var oSalesInquiryModel = (this.getModel && this.getModel("salesInquiry")) || null;
            var oConfigPromise = oSalesInquiryModel ?
                SalesInquiryService.loadConfiguration(oSalesInquiryModel) :
                SalesInquiryService.loadConfiguration();
            return oConfigPromise.then(function (oConfigData) {
                that._oConfigData = oConfigData;
                var oCurrentModel = that.getView().getModel("newInquiry");
                if (oCurrentModel) {
                    SalesInquiryModel.applyConfigurationDefaults(oCurrentModel, oConfigData);
                    if (typeof that._updateOrganizationalFilters === "function") {
                        that._updateOrganizationalFilters();
                    }
                }
                return oConfigData;
            }).catch(function (err) {
                console.warn("[CreateSalesInquiry] Error loading config data:", err);
                return that._oConfigData || null;
            });
        },

        _onRouteMatched: function () {
            this._resetModel(true);
        },

        onSave: function () {
            var that = this;
            var oModel = this.getView().getModel("newInquiry");
            if (oModel.getProperty("/submitBlocked")) return;
            var bValid = SalesInquiryModel.validateForm(oModel);

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
            var oPayload = SalesInquiryModel.buildPayload(oModel);

            SalesInquiryService.createSalesInquiry(oPayload).then(function (sInquiryId) {
                BusyIndicator.hide();
                MessageBox.success("Sales Inquiry " + sInquiryId + " has been successfully created.", {
                    title: "Sales Inquiry Created",
                    actions: ["Display Inquiry", "Create Another", "Close"],
                    emphasizedAction: "Display Inquiry",
                    onClose: function (sAction) {
                        if (sAction === "Display Inquiry") {
                            that.getOwnerComponent().getRouter().navTo("salesInquiryDetail", {
                                SalesInquiry: sInquiryId
                            });
                        } else if (sAction === "Create Another") {
                            that._resetModel(true);
                        } else {
                            that.getOwnerComponent().getRouter().navTo("salesInquiries");
                        }
                    }
                });
            }).catch(function (error) {
                BusyIndicator.hide();
                var sErrMsg = (error && error.message) ? error.message : "An unexpected error occurred.";
                oModel.setProperty("/errorMessage", sErrMsg);
                oModel.setProperty("/hasError", true);

                var sInquiryMatch = sErrMsg.match(/Sales Inquiry (\d+)/i);
                var sPartialInquiryId = (error && (error.SalesInquiry || error.documentNumber)) || (sInquiryMatch ? sInquiryMatch[1] : null);

                if (sPartialInquiryId) {
                    MessageBox.warning(sErrMsg, {
                        title: "Partial Creation in SAP",
                        actions: ["Display Inquiry " + sPartialInquiryId, "Close"],
                        emphasizedAction: "Display Inquiry " + sPartialInquiryId,
                        onClose: function (sAction) {
                            that._resetModel(true);
                            if (sAction && sAction.indexOf("Display Inquiry") === 0) {
                                that.getOwnerComponent().getRouter().navTo("salesInquiryDetail", {
                                    SalesInquiry: sPartialInquiryId
                                });
                            }
                        }
                    });
                } else {
                    MessageBox.error(that.blockSubmitIfNotConfirmed(oModel, sErrMsg) || ("Failed to create Sales Inquiry: " + sErrMsg));
                }
            });
        },

        onCancel: function () {
            var that = this;
            MessageBox.confirm("Are you sure you want to discard your changes?", {
                title: "Discard Inquiry",
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        that._resetModel();
                        that.onNavBack("salesInquiries");
                    }
                }
            });
        },

        onExit: function () {
            if (this._oMessagePopover) {
                this._oMessagePopover.destroy();
                this._oMessagePopover = null;
            }
        }
    };

    Object.assign(oMembers, mHeaderSync, mCustomerManager, mItemManager, mValueHelp, mMessages);

    var CreateSalesInquiryController = BaseController.extend("saps4hana.fiori.modules.sd.sales-inquiry.controller.CreateSalesInquiry", oMembers);

    var oTargetProto = CreateSalesInquiryController.prototype || CreateSalesInquiryController;
    Object.assign(oTargetProto, mHeaderSync, mCustomerManager, mItemManager, mValueHelp, mMessages);

    return CreateSalesInquiryController;
});
