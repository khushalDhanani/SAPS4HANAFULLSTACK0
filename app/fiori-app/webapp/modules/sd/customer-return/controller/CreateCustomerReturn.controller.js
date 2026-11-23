sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
    "sap/ui/core/CustomData",
    "sap/ui/core/BusyIndicator",
    "sap/ui/core/Messaging",
    "saps4hana/fiori/modules/sd/customer-return/service/CustomerReturnService",
    "saps4hana/fiori/service/AuthService",
    "saps4hana/fiori/modules/sd/customer-return/controller/CreateCustomerReturnReferenceDoc",
    "saps4hana/fiori/modules/sd/customer-return/controller/CreateCustomerReturnValueHelp",
    "saps4hana/fiori/modules/sd/customer-return/controller/CreateCustomerReturnItemManager",
    "saps4hana/fiori/modules/sd/customer-return/controller/CreateCustomerReturnSubmitter"
], function (
    BaseController,
    JSONModel,
    MessageBox,
    MessageToast,
    SelectDialog,
    StandardListItem,
    CustomData,
    BusyIndicator,
    Messaging,
    CustomerReturnService,
    AuthService,
    CreateCustomerReturnReferenceDoc,
    CreateCustomerReturnValueHelp,
    CreateCustomerReturnItemManager,
    CreateCustomerReturnSubmitter
) {
    "use strict";

    var isNode = typeof module !== "undefined" && module.exports;
    function req(mod, path) {
        if (mod && Object.keys(mod).length > 0) { return mod; }
        if (isNode) {
            try { return require(path); } catch (e) { return {}; }
        }
        return mod || {};
    }

    var modRefDoc = req(CreateCustomerReturnReferenceDoc, "./CreateCustomerReturnReferenceDoc");
    var modValHelp = req(CreateCustomerReturnValueHelp, "./CreateCustomerReturnValueHelp");
    var modItemMgr = req(CreateCustomerReturnItemManager, "./CreateCustomerReturnItemManager");
    var modSubmit = req(CreateCustomerReturnSubmitter, "./CreateCustomerReturnSubmitter");

    var fnRefDoc = typeof createCreateCustomerReturnReferenceDoc === "function" ? createCreateCustomerReturnReferenceDoc : (modRefDoc && modRefDoc.createCreateCustomerReturnReferenceDoc);
    var fnValHelp = typeof createCreateCustomerReturnValueHelp === "function" ? createCreateCustomerReturnValueHelp : (modValHelp && modValHelp.createCreateCustomerReturnValueHelp);
    var fnItemMgr = typeof createCreateCustomerReturnItemManager === "function" ? createCreateCustomerReturnItemManager : (modItemMgr && modItemMgr.createCreateCustomerReturnItemManager);
    var fnSubmit = typeof createCreateCustomerReturnSubmitter === "function" ? createCreateCustomerReturnSubmitter : (modSubmit && modSubmit.createCreateCustomerReturnSubmitter);

    var mRefDoc = typeof fnRefDoc === "function" ? fnRefDoc({
        SelectDialog: SelectDialog,
        StandardListItem: StandardListItem,
        CustomData: CustomData,
        JSONModel: JSONModel,
        CustomerReturnService: CustomerReturnService
    }) : {};

    var mValHelp = typeof fnValHelp === "function" ? fnValHelp({
        SelectDialog: SelectDialog,
        StandardListItem: StandardListItem,
        JSONModel: JSONModel,
        CustomerReturnService: CustomerReturnService
    }) : {};

    var mItemMgr = typeof fnItemMgr === "function" ? fnItemMgr({
        CustomerReturnService: CustomerReturnService,
        MessageToast: MessageToast
    }) : {};

    var mSubmit = typeof fnSubmit === "function" ? fnSubmit({
        MessageBox: MessageBox,
        BusyIndicator: BusyIndicator,
        Messaging: Messaging,
        CustomerReturnService: CustomerReturnService
    }) : {};

    var oMembers = {
        onInit: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }

            // 1. Initial Return Model
            var oCreateReturnModel = new JSONModel(this._createInitialData());
            this.getView().setModel(oCreateReturnModel, "createReturnModel");

            // 2. Return Reasons Model with fallback data
            var oReturnReasonsModel = new JSONModel([
                { ReasonCode: "101", ReasonText: "Poor quality" },
                { ReasonCode: "102", ReasonText: "Damaged in transit" },
                { ReasonCode: "004", ReasonText: "Customer recommendation" },
                { ReasonCode: "103", ReasonText: "Defective item" }
            ]);
            this.getView().setModel(oReturnReasonsModel, "returnReasons");

            // 3. Document Types Model with fallback data
            var oDocTypesModel = new JSONModel([
                { CustomerReturnType: "ZRET", CustomerReturnType_Text: "Sales Return Order" }
            ]);
            this.getView().setModel(oDocTypesModel, "documentTypes");

            // 4. Plants Model with fallback data
            var oPlantsModel = new JSONModel([
                { Plant: "1110", PlantName: "Ascend Plant" },
                { Plant: "1130", PlantName: "Ascend Plant 2" }
            ]);
            this.getView().setModel(oPlantsModel, "plants");

            // Router hook
            var oRouter = this.getRouter();
            if (oRouter && oRouter.getRoute("createCustomerReturn")) {
                oRouter.getRoute("createCustomerReturn").attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _onRouteMatched: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }
            this._resetModel();
            this._loadConfigData();
        },

        _resetModel: function () {
            var oModel = this.getView().getModel("createReturnModel");
            if (oModel) {
                oModel.setData(this._createInitialData());
            }
        },

        _createInitialData: function () {
            var sToday = new Date().toISOString().slice(0, 10);
            return {
                CustomerReturnType: "ZRET",
                SoldToParty: "",
                SoldToPartyName: "",
                ReturnsOrderReason: "101",
                ReferenceSDDocument: "",
                ReferenceSDDocumentCategory: "M",
                SalesOrganization: "1000",
                DistributionChannel: "10",
                OrganizationDivision: "52",
                CustomerReturnDate: sToday,
                PurchaseOrderByCustomer: "",
                Items: [
                    {
                        ItemIndex: 1,
                        Material: "",
                        OrderQuantity: "1.000",
                        OrderQuantityUnit: "KG",
                        ProductionPlant: "1120",
                        StorageLocation: "FG01",
                        ReturnReason: "101",
                        ReferenceSDDocument: "",
                        ReferenceSDDocumentItem: "000010"
                    }
                ]
            };
        },

        _loadConfigData: function () {
            var that = this;
            var oReturnModel = this.getView().getModel("customerReturn");

            // 1. Reasons
            CustomerReturnService.getReturnReasons(oReturnModel).then(function (aReasons) {
                var oModel = that.getView().getModel("returnReasons");
                if (oModel && Array.isArray(aReasons) && aReasons.length > 0) {
                    oModel.setData(aReasons);
                }
            }).catch(function (err) {
                console.warn("[CreateCustomerReturn] Error loading reasons:", err);
            });

            // 2. Document Types
            CustomerReturnService.getDocumentTypes().then(function (aTypes) {
                var oModel = that.getView().getModel("documentTypes");
                if (oModel && Array.isArray(aTypes) && aTypes.length > 0) {
                    oModel.setData(aTypes);
                }
            }).catch(function (err) {
                console.warn("[CreateCustomerReturn] Error loading doc types:", err);
            });

            // 3. Plants
            CustomerReturnService.getPlants().then(function (aPlants) {
                var oModel = that.getView().getModel("plants");
                if (oModel && Array.isArray(aPlants) && aPlants.length > 0) {
                    oModel.setData(aPlants);
                }
            }).catch(function (err) {
                console.warn("[CreateCustomerReturn] Error loading plants:", err);
            });
        },

        onNavBack: function () {
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.navTo("customerReturns", {}, true);
            } else {
                window.history.go(-1);
            }
        }
    };

    Object.assign(oMembers, mRefDoc, mValHelp, mItemMgr, mSubmit);

    var Controller = BaseController.extend("saps4hana.fiori.modules.sd.customer-return.controller.CreateCustomerReturn", oMembers);

    var oTargetProto = Controller.prototype || Controller;
    Object.assign(oTargetProto, mRefDoc, mValHelp, mItemMgr, mSubmit);

    return Controller;
});
