sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/MessagePopover",
    "sap/m/MessageItem",
    "sap/ui/core/BusyIndicator",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "saps4hana/fiori/modules/sd/sales-inquiry/model/SalesInquiryModel",
    "saps4hana/fiori/service/ValueHelpService",
    "saps4hana/fiori/modules/sd/sales-inquiry/service/SalesInquiryService"
], function (BaseController, MessageBox, MessageToast, MessagePopover, MessageItem, BusyIndicator, Filter, FilterOperator, SalesInquiryModel, ValueHelpService, SalesInquiryService) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.sd.sales-inquiry.controller.CreateSalesInquiry", {
        onInit: function () {
            this._resetModel();
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("createSalesInquiry").attachPatternMatched(this._onRouteMatched, this);
        },

        _resetModel: function () {
            var sUser = SalesInquiryModel.getCurrentUserName(this.getOwnerComponent());
            var oModel = SalesInquiryModel.createInitialModel(sUser);
            this.getView().setModel(oModel, "newInquiry");
            SalesInquiryModel.updateStatus(oModel);

            if (this._oMessagePopover) {
                this._oMessagePopover.close();
            }

            this._loadConfigurationAndDefaults();
        },

        _loadConfigurationAndDefaults: function () {
            var that = this;
            var oModel = this.getView().getModel("newInquiry");

            if (this._oConfigData) {
                SalesInquiryModel.applyConfigurationDefaults(oModel, this._oConfigData);
                return Promise.resolve(this._oConfigData);
            }

            return SalesInquiryService.loadConfiguration().then(function (oConfigData) {
                that._oConfigData = oConfigData;
                var oCurrentModel = that.getView().getModel("newInquiry");
                if (oCurrentModel) {
                    SalesInquiryModel.applyConfigurationDefaults(oCurrentModel, oConfigData);
                    that._updateOrganizationalFilters();
                }
                return oConfigData;
            }).catch(function (err) {
                console.warn("[CreateSalesInquiry] Error loading config data:", err);
            });
        },

        _onRouteMatched: function () {
            this._resetModel();
        },

        onInquiryTypeChange: function (oEvent) {
            var oModel = this.getView().getModel("newInquiry");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : null;
            if (sVal !== null && sVal !== undefined) {
                SalesInquiryModel.markUserModified(oModel, "SalesInquiryType", true);
            }
            SalesInquiryModel.validateSingleField(oModel, "SalesInquiryType");
            SalesInquiryModel.updateStatus(oModel);
        },

        onInquiryTypeSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/SalesInquiryType", sKey);
                this.onInquiryTypeChange();
            }
        },

        onSalesOrgChange: function (oEvent) {
            var oModel = this.getView().getModel("newInquiry");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : null;
            if (sVal !== null && sVal !== undefined) {
                SalesInquiryModel.markUserModified(oModel, "SalesOrganization", true);
            }
            this._updateOrganizationalFilters();
            SalesInquiryModel.validateSingleField(oModel, "SalesOrganization");
            SalesInquiryModel.updateStatus(oModel);
        },

        onSalesOrgSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/SalesOrganization", sKey);
                this.onSalesOrgChange();
            }
        },

        onDistChannelChange: function (oEvent) {
            var oModel = this.getView().getModel("newInquiry");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : null;
            if (sVal !== null && sVal !== undefined) {
                SalesInquiryModel.markUserModified(oModel, "DistributionChannel", true);
            }
            this._updateOrganizationalFilters();
            SalesInquiryModel.validateSingleField(oModel, "DistributionChannel");
            SalesInquiryModel.updateStatus(oModel);
        },

        onDistChannelSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/DistributionChannel", sKey);
                this.onDistChannelChange();
            }
        },

        onDivisionChange: function (oEvent) {
            var oModel = this.getView().getModel("newInquiry");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : null;
            if (sVal !== null && sVal !== undefined) {
                SalesInquiryModel.markUserModified(oModel, "OrganizationDivision", true);
            }
            SalesInquiryModel.validateSingleField(oModel, "OrganizationDivision");
            SalesInquiryModel.updateStatus(oModel);
        },

        onDivisionSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/OrganizationDivision", sKey);
                this.onDivisionChange();
            }
        },

        _updateOrganizationalFilters: function () {
            var oModel = this.getView().getModel("newInquiry");
            if (!oModel) return;
            var sOrg = oModel.getProperty("/header/SalesOrganization");
            var sChannel = oModel.getProperty("/header/DistributionChannel");

            var oDistInput = this.byId("inDistChannel");
            if (oDistInput) {
                var oDistBinding = oDistInput.getBinding("suggestionItems");
                if (oDistBinding) {
                    var aDistFilters = sOrg ? [new Filter("SalesOrganization", FilterOperator.EQ, sOrg)] : [];
                    oDistBinding.filter(aDistFilters);
                }
            }

            var oDivInput = this.byId("inDivision");
            if (oDivInput) {
                var oDivBinding = oDivInput.getBinding("suggestionItems");
                if (oDivBinding) {
                    var aDivFilters = [];
                    if (sOrg) aDivFilters.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrg));
                    if (sChannel) aDivFilters.push(new Filter("DistributionChannel", FilterOperator.EQ, sChannel));
                    oDivBinding.filter(aDivFilters);
                }
            }
        },

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
                this.onHeaderFieldChange();
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
                }
            }).catch(function (err) {
                console.warn("[CreateSalesInquiry] Error fetching customer defaults:", err);
            });
        },

        onValidityDateChange: function () {
            var oModel = this.getView().getModel("newInquiry");
            var dStart = oModel.getProperty("/header/BindingPeriodValidityStartDate");
            var dEnd = oModel.getProperty("/header/BindingPeriodValidityEndDate");

            if (dStart && dEnd && new Date(dEnd) < new Date(dStart)) {
                SalesInquiryModel.setFieldValidation(oModel, "BindingPeriodValidityEndDate", "Error", "End Date must be >= Start Date");
            } else {
                SalesInquiryModel.setFieldValidation(oModel, "BindingPeriodValidityEndDate", "None", "");
            }
            SalesInquiryModel.updateStatus(oModel);
        },

        onCurrencyChange: function (oEvent) {
            var oModel = this.getView().getModel("newInquiry");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : null;
            if (sVal !== null && sVal !== undefined) {
                SalesInquiryModel.markUserModified(oModel, "TransactionCurrency", true);
            }
            SalesInquiryModel.validateSingleField(oModel, "TransactionCurrency");
            SalesInquiryModel.updateStatus(oModel);
        },

        onCurrencySelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/TransactionCurrency", sKey);
                this.onCurrencyChange();
            }
        },

        onHeaderFieldChange: function () {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.updateStatus(oModel);
        },

        onAddItem: function () {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.addItem(oModel);
        },

        onDeleteItem: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            if (oItem) {
                var sPath = oItem.getBindingContext("newInquiry").getPath();
                var oModel = this.getView().getModel("newInquiry");
                SalesInquiryModel.deleteItem(oModel, sPath);
            }
        },

        onItemMaterialChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newInquiry");
            if (!oContext) return;

            var sVal = oSource.getValue();
            var oModel = this.getView().getModel("newInquiry");
            var sPath = oContext.getPath();

            if (!sVal || sVal.trim() === "") {
                oModel.setProperty(sPath + "/errors/Material", { state: "Error", text: "Material is required" });
            } else {
                oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
                // Directly retrieve and set Unit from S/4HANA material configuration on manual input
                SalesInquiryService.getMaterialDetails(sVal).then(function (oMaterial) {
                    if (oMaterial) {
                        SalesInquiryModel.applyMaterialDefaults(oModel, sPath, oMaterial);
                        SalesInquiryModel.updateStatus(oModel);
                    }
                });
            }
            SalesInquiryModel.updateStatus(oModel);
        },

        onItemMaterialSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newInquiry");
            if (!oContext || !oItem) return;

            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newInquiry");
            var sPath = oContext.getPath();

            var oBindingCtx = oItem.getBindingContext("salesInquiry") || oItem.getBindingContext();
            var oMaterialData = oBindingCtx ? oBindingCtx.getObject() : null;

            if (oMaterialData) {
                SalesInquiryModel.applyMaterialDefaults(oModel, sPath, oMaterialData);
            } else {
                oModel.setProperty(sPath + "/Material", sKey);
                var sDesc = oItem.getAdditionalText() || "";
                if (sDesc && !oModel.getProperty(sPath + "/SalesInquiryItemText")) {
                    oModel.setProperty(sPath + "/SalesInquiryItemText", sDesc);
                }
                oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
            }

            // Ensure Unit is derived from S/4HANA if not already present in suggestion context
            var sCurrentUnit = oModel.getProperty(sPath + "/OrderQuantityUnit");
            if (!sCurrentUnit || sCurrentUnit === "PC") {
                SalesInquiryService.getMaterialUnit(sKey).then(function (sUnit) {
                    if (sUnit) {
                        oModel.setProperty(sPath + "/OrderQuantityUnit", sUnit);
                        oModel.setProperty(sPath + "/errors/OrderQuantityUnit", { state: "None", text: "" });
                        SalesInquiryModel.updateStatus(oModel);
                    }
                });
            }

            SalesInquiryModel.updateStatus(oModel);
        },

        onItemCalculationChange: function () {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.calculateTotals(oModel);
            SalesInquiryModel.updateStatus(oModel);
        },

        onItemFieldChange: function () {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.updateStatus(oModel);
        },

        onCheckIncompletion: function () {
            var oModel = this.getView().getModel("newInquiry");
            var bValid = SalesInquiryModel.validateForm(oModel);
            if (bValid) {
                MessageToast.show("Document is complete. No incompletions detected.");
            } else {
                this.onMessageButtonPress();
            }
        },

        onSave: function () {
            var that = this;
            var oModel = this.getView().getModel("newInquiry");
            var bValid = SalesInquiryModel.validateForm(oModel);

            if (!bValid) {
                this.onMessageButtonPress();
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
                            that._resetModel();
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
                MessageBox.error("Failed to create Sales Inquiry: " + sErrMsg);
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

        onItemUnitSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newInquiry");
            if (!oContext || !oItem) return;

            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newInquiry");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/OrderQuantityUnit", sKey);
            oModel.setProperty(sPath + "/errors/OrderQuantityUnit", { state: "None", text: "" });
            this.onItemFieldChange();
        },

        onSuggest: function (oEvent) {
            var sValue = oEvent.getParameter("suggestValue");
            var oInput = oEvent.getSource();
            var oModel = this.getView().getModel("newInquiry");
            var aContextFilters = [];
            var sId = oInput.getId();

            if (sId.indexOf("inDistChannel") !== -1) {
                var sOrg = oModel.getProperty("/header/SalesOrganization");
                if (sOrg) {
                    aContextFilters.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrg));
                }
            } else if (sId.indexOf("inDivision") !== -1) {
                var sOrg = oModel.getProperty("/header/SalesOrganization");
                var sChannel = oModel.getProperty("/header/DistributionChannel");
                if (sOrg) {
                    aContextFilters.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrg));
                }
                if (sChannel) {
                    aContextFilters.push(new Filter("DistributionChannel", FilterOperator.EQ, sChannel));
                }
            }

            ValueHelpService.applySuggestionFilter(oInput, sValue, aContextFilters);
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
                if (sOrg) {
                    aInitialFilters.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrg));
                }
            } else if (sId.indexOf("inDivision") !== -1) {
                var sOrg = oModel.getProperty("/header/SalesOrganization");
                var sChannel = oModel.getProperty("/header/DistributionChannel");
                if (sOrg) {
                    aInitialFilters.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrg));
                }
                if (sChannel) {
                    aInitialFilters.push(new Filter("DistributionChannel", FilterOperator.EQ, sChannel));
                }
            }

            ValueHelpService.openValueHelp(oView, oInput, function (sKey, oSelectedItem, oData) {
                // Check if this input is in the line items table
                var oRowContext = oInput.getBindingContext("newInquiry");
                if (oRowContext) {
                    var sRowPath = oRowContext.getPath();
                    var sValPath = oInput.getBindingPath("value");

                    if (sValPath === "Material" || sId.indexOf("Material") !== -1) {
                        var oMatData = oData || {
                            Material: sKey,
                            Material_Text: (oSelectedItem && oSelectedItem.getDescription && oSelectedItem.getDescription()) || ""
                        };
                        SalesInquiryModel.applyMaterialDefaults(oModel, sRowPath, oMatData);
                        if (!oData || !oData.MaterialBaseUnit) {
                            SalesInquiryService.getMaterialUnit(sKey).then(function (sUnit) {
                                if (sUnit) {
                                    oModel.setProperty(sRowPath + "/OrderQuantityUnit", sUnit);
                                    oModel.setProperty(sRowPath + "/errors/OrderQuantityUnit", { state: "None", text: "" });
                                    SalesInquiryModel.updateStatus(oModel);
                                }
                            });
                        }
                        SalesInquiryModel.updateStatus(oModel);
                    } else if (sValPath === "OrderQuantityUnit") {
                        oModel.setProperty(sRowPath + "/OrderQuantityUnit", sKey);
                        oModel.setProperty(sRowPath + "/errors/OrderQuantityUnit", { state: "None", text: "" });
                        SalesInquiryModel.updateStatus(oModel);
                    }
                    return;
                }

                // Header fields
                if (sId.indexOf("inInquiryType") !== -1) {
                    that.onInquiryTypeChange();
                } else if (sId.indexOf("inSalesOrg") !== -1) {
                    that.onSalesOrgChange();
                } else if (sId.indexOf("inDistChannel") !== -1) {
                    that.onDistChannelChange();
                } else if (sId.indexOf("inDivision") !== -1) {
                    that.onDivisionChange();
                } else if (sId.indexOf("inSoldToParty") !== -1) {
                    if (oData && (oData.CustomerName || oData.CityName)) {
                        oModel.setProperty("/header/CustomerName", oData.CustomerName || oData.OrganizationBPName1 || "");
                        oModel.setProperty("/header/CustomerCity", oData.CityName || "");
                        oModel.setProperty("/header/CustomerCountry", oData.Country || "");
                    }
                    that.onSoldToPartyChange();
                } else if (sId.indexOf("inShipToParty") !== -1) {
                    if (oData && oData.CustomerName) {
                        oModel.setProperty("/header/ShipToPartyName", oData.CustomerName);
                    }
                    that.onHeaderFieldChange();
                } else if (sId.indexOf("inCurrency") !== -1) {
                    that.onCurrencyChange();
                }
            }, aInitialFilters);
        },

        onMessageButtonPress: function () {
            var oModel = this.getView().getModel("newInquiry");
            var oErrors = oModel.getProperty("/errors") || {};
            var aItems = oModel.getProperty("/items") || [];
            var aMessages = [];

            Object.keys(oErrors).forEach(function (field) {
                if (oErrors[field].state === "Error") {
                    aMessages.push({
                        type: "Error",
                        title: oErrors[field].text,
                        subtitle: "Header: " + field
                    });
                }
            });

            aItems.forEach(function (item, idx) {
                if (item.errors) {
                    Object.keys(item.errors).forEach(function (field) {
                        if (item.errors[field].state === "Error") {
                            aMessages.push({
                                type: "Error",
                                title: item.errors[field].text,
                                subtitle: "Item " + (idx + 1) + ": " + field
                            });
                        }
                    });
                }
            });

            if (aMessages.length === 0) {
                MessageToast.show("No issues detected.");
                return;
            }

            if (!this._oMessagePopover) {
                this._oMessagePopover = new MessagePopover({
                    items: {
                        path: "msg>/",
                        template: new MessageItem({
                            type: "{msg>type}",
                            title: "{msg>title}",
                            subtitle: "{msg>subtitle}"
                        })
                    }
                });
            }

            var oMsgModel = new JSONModel(aMessages);
            this._oMessagePopover.setModel(oMsgModel, "msg");
            var oBtn = this.byId("btnInquiryMessages") || this.byId("btnSaveInquiry");
            this._oMessagePopover.openBy(oBtn);
        },

        onDismissError: function () {
            var oModel = this.getView().getModel("newInquiry");
            oModel.setProperty("/hasError", false);
            oModel.setProperty("/errorMessage", "");
        },

        onExit: function () {
            if (this._oMessagePopover) {
                this._oMessagePopover.destroy();
                this._oMessagePopover = null;
            }
        }
    });
});
