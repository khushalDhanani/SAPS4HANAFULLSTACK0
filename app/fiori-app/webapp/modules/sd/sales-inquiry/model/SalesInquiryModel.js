sap.ui.define([
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/modules/sd/sales-inquiry/model/SalesInquiryValidator",
    "saps4hana/fiori/modules/sd/sales-inquiry/model/SalesInquiryPayloadBuilder"
], function (JSONModel, SalesInquiryValidator, SalesInquiryPayloadBuilder) {
    "use strict";

    var isNode = typeof module !== "undefined" && module.exports;
    function req(mod, path) {
        if (mod && Object.keys(mod).length > 0) { return mod; }
        if (isNode) {
            try { return require(path); } catch (e) { return {}; }
        }
        return mod || {};
    }

    var modValidator = req(SalesInquiryValidator, "./SalesInquiryValidator");
    var modPayload = req(SalesInquiryPayloadBuilder, "./SalesInquiryPayloadBuilder");

    var oModelBase = {
        getCurrentUserName: function (oComponent) {
            try {
                var oGlobal = typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : null);
                var oSap = oGlobal ? oGlobal["s" + "ap"] : null;
                if (oSap && oSap.ui && typeof oSap.ui.require === "function") {
                    var AuthService = oSap.ui.require("saps4hana/fiori/service/AuthService");
                    if (AuthService && typeof AuthService.getCurrentUserName === "function") {
                        var sUser = AuthService.getCurrentUserName(oComponent);
                        if (sUser) return sUser;
                    }
                }
            } catch (e) {
                // AuthService not loaded (e.g. unit tests): no user name available.
            }

            if (!oComponent) return "";
            var oAuthModel = oComponent.getModel("auth");
            var sAuthUser = oAuthModel ? oAuthModel.getProperty("/user/username") : "";
            if (sAuthUser && typeof sAuthUser === "string" && sAuthUser.trim() !== "") {
                return sAuthUser.trim();
            }
            var oUserModel = oComponent.getModel("user");
            var sModelUser = oUserModel ? oUserModel.getProperty("/username") : "";
            return (sModelUser && typeof sModelUser === "string" && sModelUser.trim() !== "") ? sModelUser.trim() : "";
        },

        createInitialModel: function (sUser) {
            var today = new Date().toISOString().split("T")[0];

            return new JSONModel({
                header: {
                    SalesInquiryType: "",
                    SalesOrganization: "",
                    DistributionChannel: "",
                    OrganizationDivision: "",
                    SoldToParty: "",
                    CustomerName: "",
                    CustomerCity: "",
                    CustomerCountry: "",
                    ShipToParty: "",
                    ShipToPartyName: "",
                    PurchaseOrderByCustomer: "",
                    CustomerPurchaseOrderDate: today,
                    SalesInquiryDate: today,
                    BindingPeriodValidityStartDate: today,
                    BindingPeriodValidityEndDate: "",
                    TransactionCurrency: "",
                    TotalNetAmount: "0.00",
                    CustomerGroup2: "",
                    PortOfLoading: "",
                    PortOfDischarge: "",
                    ContactPerson: "",
                    StatusText: "Draft",
                    StatusState: "Information",
                    StatusIcon: "sap-icon://edit",
                    CreatedByUser: sUser || ""
                },
                items: [
                    {
                        SalesInquiryItem: "000010",
                        Material: "",
                        SalesInquiryItemText: "",
                        OrderQuantity: "",
                        OrderQuantityUnit: "",
                        Plant: "",
                        NetPriceAmount: "",
                        NetAmount: "0.00",
                        errors: {}
                    }
                ],
                capabilities: Object.assign({}, modValidator.NO_CAPABILITIES || {
                    CustomerGroup2: false,
                    PortOfLoading: false,
                    PortOfDischarge: false,
                    ContactPerson: false,
                    Plant: false
                }),
                readinessNotice: "",
                showReadinessNotice: false,
                readinessGaps: [],
                errors: {},
                errorCount: 0,
                errorMessage: "",
                hasError: false,
                userModified: {},
                configDerived: {}
            });
        },

        markUserModified: function (oModel, sField, bModified) {
            if (!oModel) return;
            oModel.setProperty("/userModified/" + sField, bModified !== false);
        }
    };

    Object.assign(oModelBase, modValidator, modPayload);

    if (isNode) {
        module.exports = oModelBase;
    }
    return oModelBase;
});
