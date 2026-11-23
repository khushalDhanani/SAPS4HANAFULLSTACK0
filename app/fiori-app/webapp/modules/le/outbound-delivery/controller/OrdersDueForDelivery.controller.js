sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/FilterType",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "saps4hana/fiori/service/AuthService",
    "saps4hana/fiori/modules/le/outbound-delivery/service/OutboundDeliveryService",
    "saps4hana/fiori/modules/le/outbound-delivery/controller/OrdersDueTableManager",
    "saps4hana/fiori/modules/le/outbound-delivery/controller/OrdersDueDeliveryCreator",
    "saps4hana/fiori/modules/le/outbound-delivery/controller/OrdersDueDeliveryNoRef",
    "saps4hana/fiori/modules/le/outbound-delivery/controller/OrdersDueDeliveryFollowUp"
], function (
    BaseController,
    JSONModel,
    Filter,
    FilterOperator,
    FilterType,
    Fragment,
    MessageBox,
    AuthService,
    OutboundDeliveryService,
    OrdersDueTableManager,
    OrdersDueDeliveryCreator,
    OrdersDueDeliveryNoRef,
    OrdersDueDeliveryFollowUp
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

    var modTable = req(OrdersDueTableManager, "./OrdersDueTableManager");
    var modCreator = req(OrdersDueDeliveryCreator, "./OrdersDueDeliveryCreator");
    var modNoRef = req(OrdersDueDeliveryNoRef, "./OrdersDueDeliveryNoRef");
    var modFollowUp = req(OrdersDueDeliveryFollowUp, "./OrdersDueDeliveryFollowUp");

    var fnTable = typeof createOrdersDueTableManager === "function" ? createOrdersDueTableManager : (modTable && modTable.createOrdersDueTableManager);
    var fnCreator = typeof createOrdersDueDeliveryCreator === "function" ? createOrdersDueDeliveryCreator : (modCreator && modCreator.createOrdersDueDeliveryCreator);
    var fnNoRef = typeof createOrdersDueDeliveryNoRef === "function" ? createOrdersDueDeliveryNoRef : (modNoRef && modNoRef.createOrdersDueDeliveryNoRef);
    var fnFollowUp = typeof createOrdersDueDeliveryFollowUp === "function" ? createOrdersDueDeliveryFollowUp : (modFollowUp && modFollowUp.createOrdersDueDeliveryFollowUp);

    var mTable = typeof fnTable === "function" ? fnTable({
        Filter: Filter,
        FilterOperator: FilterOperator,
        FilterType: FilterType,
        AuthService: AuthService,
        OutboundDeliveryService: OutboundDeliveryService
    }) : {};

    var mCreator = typeof fnCreator === "function" ? fnCreator({
        Fragment: Fragment,
        MessageBox: MessageBox,
        OutboundDeliveryService: OutboundDeliveryService
    }) : {};

    var mNoRef = typeof fnNoRef === "function" ? fnNoRef({
        Fragment: Fragment,
        MessageBox: MessageBox,
        OutboundDeliveryService: OutboundDeliveryService
    }) : {};

    var mFollowUp = typeof fnFollowUp === "function" ? fnFollowUp({
        MessageBox: MessageBox,
        OutboundDeliveryService: OutboundDeliveryService
    }) : {};

    var oMembers = {
        onInit: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }

            var bCanCreateDelivery = (AuthService && typeof AuthService.canCreateDelivery === "function") ? AuthService.canCreateDelivery() : true;
            var oViewModel = new JSONModel({
                totalCount: "-",
                readyCount: "-",
                inApprovalCount: "-",
                shippingPointCount: "-",
                distinctOrdersCount: "-",
                readyOrdersCount: "-",
                inApprovalOrdersCount: "-",
                displayCount: "-",
                selectedTab: "ready",
                canCreateDelivery: bCanCreateDelivery,
                plant: "",
                plantValueState: "None",
                plantValueStateText: ""
            });
            this.getView().setModel(oViewModel, "ordersDueView");

            var oDialogModel = new JSONModel({
                salesOrder: "",
                shippingPoint: "",
                shippingPointValueState: "None",
                shippingPointValueStateText: "",
                deliveryDate: this._getTodayDateString()
            });
            this.getView().setModel(oDialogModel, "deliveryDialog");

            var oNoRefDialogModel = new JSONModel({
                shippingPoint: "1104",
                deliveryType: "LO2",
                plant: "1110",
                storageLocation: "FG01",
                salesOrg: "",
                distChannel: "",
                division: "",
                shipToParty: "10135",
                plannedGoodsIssueDate: this._getTodayDateString(),
                busy: false,
                items: [
                    { itemNo: "000010", material: "4000000186", quantity: 1, uom: "KG" }
                ]
            });
            this.getView().setModel(oNoRefDialogModel, "deliveryNoRefDialog");

            // Follow-up on an existing delivery: billing. Types come from SAP per delivery.
            this.getView().setModel(new JSONModel({
                delivery: "",
                billingTypes: [],
                billingType: "",
                billingDate: "",
                busy: false,
                lastResult: "",
                status: null,
                statusText: "",
                canBill: false
            }), "deliveryFollowUp");

            var oRouter = this.getOwnerComponent().getRouter();
            if (oRouter && oRouter.getRoute("ordersDueForDelivery")) {
                oRouter.getRoute("ordersDueForDelivery").attachPatternMatched(this._onRouteMatched, this);
            }

            this._initPlant();
        },

        _getTodayDateString: function () {
            var d = new Date();
            var sMonth = String(d.getMonth() + 1).padStart(2, "0");
            var sDay = String(d.getDate()).padStart(2, "0");
            return d.getFullYear() + "-" + sMonth + "-" + sDay;
        },

        /** i18n text for sKey with {0}, {1}… filled from aArgs; sDefault (same placeholders) when the bundle has no such key. */
        _text: function (sKey, sDefault, aArgs) {
            try {
                var oComp = this.getOwnerComponent();
                var oI18n = oComp && oComp.getModel ? oComp.getModel("i18n") : null;
                var oBundle = oI18n && oI18n.getResourceBundle ? oI18n.getResourceBundle() : null;
                if (oBundle && oBundle.hasText && oBundle.hasText(sKey)) {
                    return oBundle.getText(sKey, aArgs);
                }
            } catch (e) {
                // i18n bundle not available (e.g. unit tests): fall through to the English default.
            }
            return (aArgs || []).reduce(function (s, v, i) { return s.split("{" + i + "}").join(String(v)); }, sDefault);
        }
    };

    Object.assign(oMembers, mTable, mCreator, mNoRef, mFollowUp);

    var Controller = BaseController.extend("saps4hana.fiori.modules.le.outbound-delivery.controller.OrdersDueForDelivery", oMembers);

    var oTargetProto = Controller.prototype || Controller;
    Object.assign(oTargetProto, mTable, mCreator, mNoRef, mFollowUp);

    return Controller;
});
