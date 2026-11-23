function createCreateSalesInquiryCustomerManager(deps) {
    deps = deps || {};
    var SalesInquiryModel = deps.SalesInquiryModel;
    var SalesInquiryService = deps.SalesInquiryService;
    var MessageBox = deps.MessageBox;
    var MessageToast = deps.MessageToast;

    return {
        onSoldToPartyChange: function (oEvent) {
            var oModel = this.getView().getModel("newInquiry");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : oModel.getProperty("/header/SoldToParty");
            SalesInquiryModel.markUserModified(oModel, "SoldToParty", true);
            this._deriveCustomerData(sVal);
            SalesInquiryModel.validateSingleField(oModel, "SoldToParty");
            SalesInquiryModel.updateStatus(oModel);
        },

        onSoldToPartyLiveChange: function (oEvent) {
            var sVal = oEvent.getParameter("value");
            var oModel = this.getView().getModel("newInquiry");
            oModel.setProperty("/header/SoldToParty", sVal);
            SalesInquiryModel.markUserModified(oModel, "SoldToParty", true);
            if (sVal && sVal.length >= 4) {
                this._deriveCustomerData(sVal);
            }
            SalesInquiryModel.validateSingleField(oModel, "SoldToParty");
            SalesInquiryModel.updateStatus(oModel);
        },

        onSoldToPartySelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var sDesc = oItem.getAdditionalText() || "";
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/SoldToParty", sKey);
                if (sDesc) {
                    oModel.setProperty("/header/CustomerName", sDesc);
                }
                SalesInquiryModel.markUserModified(oModel, "SoldToParty", true);
                this._deriveCustomerData(sKey);
                SalesInquiryModel.validateSingleField(oModel, "SoldToParty");
                SalesInquiryModel.updateStatus(oModel);
            }
        },

        onShipToPartySelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var sDesc = oItem.getAdditionalText() || "";
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/ShipToParty", sKey);
                if (sDesc) {
                    oModel.setProperty("/header/ShipToPartyName", sDesc);
                }
                if (typeof this.onHeaderFieldChange === "function") {
                    this.onHeaderFieldChange();
                }
            }
        },

        _deriveCustomerData: function (sCustomer) {
            var that = this;
            var oModel = this.getView().getModel("newInquiry");
            if (!sCustomer || String(sCustomer).trim() === "") {
                SalesInquiryModel.deriveCustomerDefaults(oModel, "", null);
                return;
            }

            var sOrg = oModel.getProperty("/header/SalesOrganization");
            var sChannel = oModel.getProperty("/header/DistributionChannel");
            var sDivision = oModel.getProperty("/header/OrganizationDivision");

            SalesInquiryService.getCustomerDefaults(sCustomer, sOrg, sChannel, sDivision).then(function (oDefaults) {
                var oCurrentModel = that.getView().getModel("newInquiry");
                if (oCurrentModel && oCurrentModel.getProperty("/header/SoldToParty") === sCustomer) {
                    SalesInquiryModel.deriveCustomerDefaults(oCurrentModel, sCustomer, oDefaults);
                    if (oDefaults && oDefaults.validForSalesArea === false) {
                        var sErrText = oDefaults.salesAreaError || ("Customer " + sCustomer + " is not maintained for sales area " + sOrg + " " + sChannel + " " + sDivision);
                        oCurrentModel.setProperty("/errors/SoldToParty", {
                            state: "Error",
                            text: sErrText
                        });
                        MessageBox.warning(
                            "Sold-to party " + sCustomer + (oDefaults.CustomerName ? " (" + oDefaults.CustomerName + ")" : "") +
                            " is not maintained for sales area " + (sOrg || "-") + " " + (sChannel || "-") + " " + (sDivision || "-") + ".\n\n" +
                            "Maintained in SAP S/4HANA for: " + (oDefaults.maintainedSalesAreasSummary || "another sales area") + ".\n\n" +
                            "Please select a customer maintained for " + (sOrg || "-") + " / " + (sChannel || "-") + " / " + (sDivision || "-") + " (e.g. 10135 Divi's Laboratories, 10000 3A Chemie) or extend Customer " + sCustomer + " to Sales Area " + (sOrg || "-") + " " + (sChannel || "-") + " " + (sDivision || "-") + " in SAP GUI (transaction BP / XD01).",
                            { title: "Customer Sales Area Mismatch" }
                        );
                    }
                    if (oDefaults && oDefaults.derived) {
                        MessageToast.show((typeof that.getText === "function" && that.getText("msgCustomerDefaultsFromHistory")) || "Currency, sales office and sales group were taken from this customer's previous sales documents. Verify before submitting.");
                    }
                }
            }).catch(function (err) {
                console.warn("[CreateSalesInquiry] Error fetching customer defaults:", err);
                MessageToast.show((typeof that.getText === "function" && that.getText("msgCustomerDefaultsUnavailable")) || "Customer data could not be loaded from SAP.");
            });
        },

        onContactPersonSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newInquiry");
            oModel.setProperty("/header/ContactPerson", sKey);
            SalesInquiryModel.validateSingleField(oModel, "ContactPerson");
            SalesInquiryModel.updateStatus(oModel);
        }
    };
}

var oExports = {
    createCreateSalesInquiryCustomerManager: createCreateSalesInquiryCustomerManager
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
