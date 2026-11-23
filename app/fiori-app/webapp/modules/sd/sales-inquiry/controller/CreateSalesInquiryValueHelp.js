function createCreateSalesInquiryValueHelp(deps) {
    deps = deps || {};
    var SalesInquiryModel = deps.SalesInquiryModel;
    var SalesInquiryService = deps.SalesInquiryService;
    var ValueHelpService = deps.ValueHelpService;
    var Filter = deps.Filter;
    var FilterOperator = deps.FilterOperator;

    return {
        onSuggest: function (oEvent) {
            var sValue = oEvent.getParameter("suggestValue");
            var oInput = oEvent.getSource();
            var oModel = this.getView().getModel("newInquiry");
            var aContextFilters = [];
            var sId = oInput.getId();

            if (sId.indexOf("inDistChannel") !== -1) {
                var sOrg = oModel.getProperty("/header/SalesOrganization");
                if (sOrg && Filter && FilterOperator) {
                    aContextFilters.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrg));
                }
            } else if (sId.indexOf("inDivision") !== -1) {
                var sOrgDiv = oModel.getProperty("/header/SalesOrganization");
                var sChannel = oModel.getProperty("/header/DistributionChannel");
                if (sOrgDiv && Filter && FilterOperator) {
                    aContextFilters.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrgDiv));
                }
                if (sChannel && Filter && FilterOperator) {
                    aContextFilters.push(new Filter("DistributionChannel", FilterOperator.EQ, sChannel));
                }
            } else if (sId.indexOf("inContactPerson") !== -1) {
                var sCustomerCp = oModel.getProperty("/header/SoldToParty");
                if (sCustomerCp && Filter && FilterOperator) {
                    aContextFilters.push(new Filter("Customer", FilterOperator.EQ, sCustomerCp));
                }
            }

            if (ValueHelpService && typeof ValueHelpService.applySuggestionFilter === "function") {
                ValueHelpService.applySuggestionFilter(oInput, sValue, aContextFilters);
            }
        },

        onValueHelpRequest: function (oEvent) {
            var oInput = oEvent.getSource();
            var oView = this.getView();
            var that = this;
            var oModel = oView.getModel("newInquiry");

            var aInitialFilters = [];
            var sId = oInput.getId();

            if (sId.indexOf("inDistChannel") !== -1) {
                var sOrg = oModel.getProperty("/header/SalesOrganization");
                if (sOrg && Filter && FilterOperator) {
                    aInitialFilters.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrg));
                }
            } else if (sId.indexOf("inDivision") !== -1) {
                var sOrgDiv = oModel.getProperty("/header/SalesOrganization");
                var sChannel = oModel.getProperty("/header/DistributionChannel");
                if (sOrgDiv && Filter && FilterOperator) {
                    aInitialFilters.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrgDiv));
                }
                if (sChannel && Filter && FilterOperator) {
                    aInitialFilters.push(new Filter("DistributionChannel", FilterOperator.EQ, sChannel));
                }
            } else if (sId.indexOf("inSoldToParty") !== -1 || sId.indexOf("inShipToParty") !== -1) {
                var sOrgCust = oModel.getProperty("/header/SalesOrganization");
                var sDistCust = oModel.getProperty("/header/DistributionChannel");
                var sDivCust = oModel.getProperty("/header/OrganizationDivision");
                if (sOrgCust && Filter && FilterOperator) {
                    aInitialFilters.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrgCust));
                }
                if (sDistCust && Filter && FilterOperator) {
                    aInitialFilters.push(new Filter("DistributionChannel", FilterOperator.EQ, sDistCust));
                }
                if (sDivCust && Filter && FilterOperator) {
                    aInitialFilters.push(new Filter("Division", FilterOperator.EQ, sDivCust));
                }
            } else if (sId.indexOf("inContactPerson") !== -1) {
                var sCustCp = oModel.getProperty("/header/SoldToParty");
                if (sCustCp && Filter && FilterOperator) {
                    aInitialFilters.push(new Filter("Customer", FilterOperator.EQ, sCustCp));
                }
            }

            if (!ValueHelpService || typeof ValueHelpService.openValueHelp !== "function") {
                return;
            }

            ValueHelpService.openValueHelp(oView, oInput, function (sKey, oSelectedItem, oData) {
                var oRowContext = oInput.getBindingContext("newInquiry");
                if (oRowContext) {
                    var sRowPath = oRowContext.getPath();
                    var sValPath = oInput.getBindingPath("value");

                    if (sValPath === "Material" || sId.indexOf("Material") !== -1) {
                        var oMatData = oData || {
                            Material: sKey,
                            MaterialName: (oSelectedItem && oSelectedItem.getDescription && oSelectedItem.getDescription()) || "",
                            Material_Text: (oSelectedItem && oSelectedItem.getDescription && oSelectedItem.getDescription()) || ""
                        };
                        if (!oMatData.Material_Text && oSelectedItem && oSelectedItem.getCells) {
                            var aCellsVh = oSelectedItem.getCells();
                            oMatData.Material_Text = (aCellsVh[1] && aCellsVh[1].getText && aCellsVh[1].getText()) || "";
                            oMatData.MaterialName = oMatData.Material_Text;
                        }
                        SalesInquiryModel.applyMaterialDefaults(oModel, sRowPath, oMatData, true);
                        if (!oData || !oData.MaterialBaseUnit || !(oData.MaterialName || oData.Material_Text)) {
                            var oSalesInquiryModel = (that.getModel && that.getModel("salesInquiry")) || null;
                            var oVhPromise = oSalesInquiryModel ?
                                SalesInquiryService.getMaterialDetails(oSalesInquiryModel, sKey) :
                                SalesInquiryService.getMaterialDetails(sKey);
                            if (oVhPromise && typeof oVhPromise.then === "function") {
                                oVhPromise.then(function (oMat) {
                                    if (oMat) {
                                        SalesInquiryModel.applyMaterialDefaults(oModel, sRowPath, oMat, true);
                                        SalesInquiryModel.updateStatus(oModel);
                                    }
                                });
                            }
                        }
                        SalesInquiryModel.updateStatus(oModel);
                    } else if (sValPath === "OrderQuantityUnit") {
                        oModel.setProperty(sRowPath + "/OrderQuantityUnit", sKey);
                        oModel.setProperty(sRowPath + "/errors/OrderQuantityUnit", { state: "None", text: "" });
                        SalesInquiryModel.updateStatus(oModel);
                    } else if (sValPath === "Plant" || sId.indexOf("Plant") !== -1) {
                        oModel.setProperty(sRowPath + "/Plant", sKey);
                        oModel.setProperty(sRowPath + "/errors/Plant", { state: "None", text: "" });
                        SalesInquiryModel.updateStatus(oModel);
                    }
                    return;
                }

                // Header fields
                if (sId.indexOf("inInquiryType") !== -1) {
                    if (typeof that.onInquiryTypeChange === "function") that.onInquiryTypeChange();
                } else if (sId.indexOf("inSalesOrg") !== -1) {
                    if (typeof that.onSalesOrgChange === "function") that.onSalesOrgChange();
                } else if (sId.indexOf("inDistChannel") !== -1) {
                    if (typeof that.onDistChannelChange === "function") that.onDistChannelChange();
                } else if (sId.indexOf("inDivision") !== -1) {
                    if (typeof that.onDivisionChange === "function") that.onDivisionChange();
                } else if (sId.indexOf("inSoldToParty") !== -1) {
                    if (oData && (oData.CustomerName || oData.CityName)) {
                        oModel.setProperty("/header/CustomerName", oData.CustomerName || oData.OrganizationBPName1 || "");
                        oModel.setProperty("/header/CustomerCity", oData.CityName || "");
                        oModel.setProperty("/header/CustomerCountry", oData.Country || "");
                    }
                    if (typeof that.onSoldToPartyChange === "function") that.onSoldToPartyChange();
                } else if (sId.indexOf("inShipToParty") !== -1) {
                    if (oData && oData.CustomerName) {
                        oModel.setProperty("/header/ShipToPartyName", oData.CustomerName);
                    }
                    if (typeof that.onHeaderFieldChange === "function") that.onHeaderFieldChange();
                } else if (sId.indexOf("inCurrency") !== -1) {
                    if (typeof that.onCurrencyChange === "function") that.onCurrencyChange();
                } else if (sId.indexOf("inContactPerson") !== -1) {
                    oModel.setProperty("/header/ContactPerson", sKey);
                    SalesInquiryModel.validateSingleField(oModel, "ContactPerson");
                    SalesInquiryModel.updateStatus(oModel);
                }
            }, aInitialFilters);
        }
    };
}

var oExports = {
    createCreateSalesInquiryValueHelp: createCreateSalesInquiryValueHelp
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
