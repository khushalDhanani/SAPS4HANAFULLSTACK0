sap.ui.define([
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/modules/sd/sales-order/model/SalesOrderValidator",
    "saps4hana/fiori/modules/sd/sales-order/model/SalesOrderPayloadBuilder"
], function (JSONModel, SalesOrderValidator, SalesOrderPayloadBuilder) {
    "use strict";

    var isNode = typeof module !== "undefined" && module.exports;
    function req(mod, path) {
        if (mod && Object.keys(mod).length > 0) { return mod; }
        if (isNode) {
            try { return require(path); } catch (e) { return {}; }
        }
        return mod || {};
    }

    var modValidator = req(SalesOrderValidator, "./SalesOrderValidator");
    var modPayload = req(SalesOrderPayloadBuilder, "./SalesOrderPayloadBuilder");

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
                    SalesOrderType: "",
                    SalesOrganization: "",
                    DistributionChannel: "",
                    OrganizationDivision: "",
                    SalesOffice: "",
                    SalesGroup: "",
                    SoldToParty: "",
                    CustomerName: "",
                    CustomerCity: "",
                    CustomerCountry: "",
                    ShipToParty: "",
                    ShipToPartyName: "",
                    PurchaseOrderNumber: "",
                    PurchaseOrderByCustomer: "",
                    CustomerPurchaseOrderDate: "",
                    SalesOrderDate: today,
                    RequestedDeliveryDate: "",
                    TransactionCurrency: "",
                    TotalNetAmount: "0.00",
                    CustomerGroup2: "",
                    PortOfLoading: "",
                    PortOfDischarge: "",
                    Incoterms: "",
                    IncotermsLocation1: "",
                    INCO1: "",
                    INCO2: "",
                    INCO2_L: "",
                    ContactPerson: "",
                    PaymentTerms: "",
                    PaymentTermCode: "",
                    CreatedByUser: sUser || "",
                    StatusText: "In Progress",
                    StatusState: "Warning",
                    StatusIcon: "sap-icon://in-progress"
                },
                items: [
                    {
                        SalesOrderItem: "10",
                        Material: "",
                        SalesOrderItemText: "",
                        OrderQuantity: "",
                        OrderQuantityUnit: "",
                        Plant: "",
                        RequestedDeliveryDate: "",
                        NetPriceAmount: "0.00",
                        NetAmount: "0.00",
                        errors: {}
                    }
                ],
                errors: {
                    ContactPerson: { state: "None", text: "" },
                    PaymentTerms: { state: "None", text: "" }
                },
                errorList: [],
                errorCount: 0,
                errorMessage: "",
                hasError: false,
                isModified: false,
                modifiedFields: {}
            });
        },

        createEmptyItem: function (iIndex, sPlant, sReqDlvDate) {
            var sItemNum = String(((iIndex || 0) + 1) * 10);
            return {
                SalesOrderItem: sItemNum,
                Material: "",
                SalesOrderItemText: "",
                OrderQuantity: "",
                OrderQuantityUnit: "",
                Plant: sPlant || "",
                RequestedDeliveryDate: sReqDlvDate || "",
                NetPriceAmount: "0.00",
                NetAmount: "0.00",
                errors: {}
            };
        }
    };

    Object.assign(oModelBase, modValidator, modPayload);

    if (isNode) {
        module.exports = oModelBase;
    }
    return oModelBase;
});
