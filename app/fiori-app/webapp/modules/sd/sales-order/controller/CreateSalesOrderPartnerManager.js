function createCreateSalesOrderPartnerManager(deps) {
    deps = deps || {};
    var SalesOrderModel = deps.SalesOrderModel;
    var SalesOrderService = deps.SalesOrderService;
    var MessageBox = deps.MessageBox;
    var MessageToast = deps.MessageToast;
    var Filter = deps.Filter;
    var FilterOperator = deps.FilterOperator;

    return {
        onSoldToPartyChange: function () {
            var that = this;
            var oModel = this.getView().getModel("newOrder");
            var sCustomer = oModel.getProperty("/header/SoldToParty");

            SalesOrderModel.validateSingleField(oModel, "SoldToParty");

            if (!sCustomer || sCustomer.trim() === "") {
                oModel.setProperty("/header/CustomerName", "");
                oModel.setProperty("/header/CustomerCity", "");
                oModel.setProperty("/header/CustomerCountry", "");
                oModel.setProperty("/header/ShipToParty", "");
                oModel.setProperty("/header/ShipToPartyName", "");
                SalesOrderModel.updateStatus(oModel);
                return;
            }

            var sOrg = oModel.getProperty("/header/SalesOrganization");
            var sDist = oModel.getProperty("/header/DistributionChannel");
            var sDiv = oModel.getProperty("/header/OrganizationDivision");

            SalesOrderService.getCustomerDefaults(sCustomer, sOrg, sDist, sDiv).then(function (oDefaults) {
                if (oDefaults) {
                    SalesOrderModel.applyCustomerDefaults(oModel, oDefaults);
                    if (oDefaults.validForSalesArea === false) {
                        var sErrText = oDefaults.salesAreaError || ("Customer " + sCustomer + " is not maintained for sales area " + sOrg + " " + sDist + " " + sDiv);
                        oModel.setProperty("/errors/SoldToParty", {
                            state: "Error",
                            text: sErrText
                        });
                        MessageBox.warning(
                            "Sold-to party " + sCustomer + (oDefaults.CustomerName ? " (" + oDefaults.CustomerName + ")" : "") +
                            " is not maintained for sales area " + (sOrg || "-") + " " + (sDist || "-") + " " + (sDiv || "-") + ".\n\n" +
                            "Maintained in SAP S/4HANA for: " + (oDefaults.maintainedSalesAreasSummary || "another sales area") + ".\n\n" +
                            "Please select a customer maintained for " + (sOrg || "-") + " / " + (sDist || "-") + " / " + (sDiv || "-") + " (e.g. 10135 Divi's Laboratories, 10000 3A Chemie) or extend Customer " + sCustomer + " to Sales Area " + (sOrg || "-") + " " + (sDist || "-") + " " + (sDiv || "-") + " in SAP GUI (transaction BP / XD01).",
                            { title: "Customer Sales Area Mismatch" }
                        );
                    } else {
                        oModel.setProperty("/errors/SoldToParty", { state: "None", text: "" });
                    }
                    if (oDefaults.derived) {
                        MessageToast.show((typeof that.getText === "function" && that.getText("msgCustomerDefaultsFromHistory")) || "Currency, sales office and sales group were taken from this customer's previous sales documents. Verify before submitting.");
                    }
                }
                SalesOrderModel.updateStatus(oModel);
            }).catch(function () {
                MessageToast.show((typeof that.getText === "function" && that.getText("msgCustomerDefaultsUnavailable")) || "Customer data could not be loaded from SAP.");
                SalesOrderModel.updateStatus(oModel);
            });
        },

        // Live-change handlers only clear error states. They must not write the bound value into the model:
        // two-way binding would call setValue(), UI5 would record it as the committed value, and the
        // `change` event (customer defaults, material details, validation) would never fire on blur.
        onSoldToPartyLiveChange: function (oEvent) {
            var sVal = oEvent.getParameter("value");
            var oModel = this.getView().getModel("newOrder");
            if (sVal && sVal.trim() !== "") {
                oModel.setProperty("/errors/SoldToParty", { state: "None", text: "" });
            }
        },

        onSoldToPartySelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;

            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            oModel.setProperty("/header/SoldToParty", sKey);

            var sName = oItem.getAdditionalText && oItem.getAdditionalText();
            if (sName) {
                oModel.setProperty("/header/CustomerName", sName);
            }

            this.onSoldToPartyChange();
        },

        onShipToPartySelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            oModel.setProperty("/header/ShipToParty", sKey);
            var sName = oItem.getAdditionalText && oItem.getAdditionalText();
            if (sName) {
                oModel.setProperty("/header/ShipToPartyName", sName);
            }
            if (typeof this.onHeaderFieldChange === "function") {
                this.onHeaderFieldChange();
            }
        },

        onContactPersonSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            oModel.setProperty("/header/ContactPerson", sKey);
            oModel.setProperty("/modifiedFields/ContactPerson", true);
            oModel.setProperty("/isModified", true);
            this.onContactPersonChange();
        },

        onContactPersonLiveChange: function (oEvent) {
            var sVal = oEvent.getParameter("value");
            var oModel = this.getView().getModel("newOrder");
            if (!sVal || String(sVal).trim() === "") {
                oModel.setProperty("/errors/ContactPerson", { state: "None", text: "" });
            }
        },

        onContactPersonChange: function () {
            var oModel = this.getView().getModel("newOrder");
            oModel.setProperty("/modifiedFields/ContactPerson", true);
            oModel.setProperty("/isModified", true);
            SalesOrderModel.validateSingleField(oModel, "ContactPerson");
            SalesOrderModel.updateStatus(oModel);
        },

        _updateOrganizationalFilters: function () {
            var oModel = this.getView().getModel("newOrder");
            if (!oModel) return;

            var sOrg = oModel.getProperty("/header/SalesOrganization");
            var sChannel = oModel.getProperty("/header/DistributionChannel");

            var inDist = typeof this.byId === "function" ? this.byId("inDistChannel") : null;
            if (inDist) {
                var oBindingDist = inDist.getBinding("suggestionItems");
                if (oBindingDist) {
                    var aFiltersDist = [];
                    if (sOrg && Filter && FilterOperator) {
                        aFiltersDist.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrg));
                    }
                    oBindingDist.filter(aFiltersDist);
                }
            }

            var inDiv = typeof this.byId === "function" ? this.byId("inDivision") : null;
            if (inDiv) {
                var oBindingDiv = inDiv.getBinding("suggestionItems");
                if (oBindingDiv) {
                    var aFiltersDiv = [];
                    if (sOrg && Filter && FilterOperator) {
                        aFiltersDiv.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrg));
                    }
                    if (sChannel && Filter && FilterOperator) {
                        aFiltersDiv.push(new Filter("DistributionChannel", FilterOperator.EQ, sChannel));
                    }
                    oBindingDiv.filter(aFiltersDiv);
                }
            }
        }
    };
}

var oExports = {
    createCreateSalesOrderPartnerManager: createCreateSalesOrderPartnerManager
};

var isNode = typeof module !== "undefined" && module.exports;
if (isNode) {
    module.exports = oExports;
}
if (!isNode && typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function") {
    sap.ui.define([], function () {
        return oExports;
    });
}
